"""Limpeza de itens: junta variações de um mesmo item e guarda o detalhe na observação.

Modelo: categoria -> item (o tipo de gasto: "Refeições Fora") -> observação (o
detalhe daquela vez: "Mamma Jamma"). A limpeza leva os itens antigos, um por
descrição, para esse formato.

Lê um plano em texto (fica em dados/, fora do git, porque tem os nomes reais)
e gera dois arquivos SQL ao lado dele:

  previa.sql   uma consulta que mostra, item a item, o que vai acontecer
  aplicar.sql  um bloco único que aplica tudo ou nada

Formato do plano:

  ## Categoria
  > Item que fica | prefixos a tirar (opcional, separados por vírgula)
  item atual                      observação calculada: o nome sem o prefixo
  item atual => texto             observação escolhida
  item atual =>                   sem observação (grafia diferente do mesmo item)

As linhas rodam na ordem do arquivo, então um grupo mais abaixo pode juntar
itens que um grupo de cima acabou de formar (a observação nova vem antes da
que o lançamento já tinha: "Uber · aeroporto"). A prévia só enxerga o banco
como ele está: itens que ainda vão ser formados aparecem como "não achado".

Regras que o SQL garante:
  * só junta itens da MESMA categoria, então os totais do mês por categoria não mudam
    (o bloco confere e desfaz tudo se algum total mudar);
  * a busca do item é por normalizar(), a mesma definição de "mesmo nome" do banco;
  * o nome antigo vira regra (mesclar_item), para continuar sendo reconhecido;
  * a observação calculada usa resto_do_nome() do banco.

Uso:
  .venv/bin/python scripts/limpar_itens.py dados/limpeza/plano.txt
  psql "$DB" --csv -f dados/limpeza/previa.sql -o dados/limpeza/previa.csv
  psql "$DB" -f dados/limpeza/aplicar.sql            # banco local
  supabase db query --remote --yes -f dados/limpeza/aplicar.sql   # produção, com o ok
"""

import sys
from pathlib import Path


def sql_texto(valor):
    if valor is None:
        return "null"
    return "'" + valor.replace("'", "''") + "'"


def sql_lista(valores):
    return "array[" + ", ".join(sql_texto(v) for v in valores) + "]::text[]"


def ler_plano(caminho):
    linhas = []  # (ordem, categoria, destino, origem, obs, auto, tirar)
    categoria = destino = None
    tirar = []
    ordem = 0
    for n, bruta in enumerate(Path(caminho).read_text(encoding="utf-8").splitlines(), 1):
        linha = bruta.rstrip()
        if not linha.strip() or linha.lstrip().startswith("#") and not linha.startswith("## "):
            continue
        if linha.startswith("## "):
            categoria = linha[3:].strip()
            destino = None
            continue
        if linha.startswith("> "):
            if categoria is None:
                sys.exit(f"linha {n}: item antes de categoria")
            partes = [p.strip() for p in linha[2:].split("|")]
            destino = partes[0]
            extras = [t.strip() for t in partes[1].split(",")] if len(partes) > 1 and partes[1] else []
            tirar = [destino] + [t for t in extras if t]
            ordem += 1
            # Linha do próprio item que fica: garante que exista e acerta a grafia do nome.
            linhas.append((ordem, categoria, destino, None, None, False, tirar))
            continue
        if destino is None:
            sys.exit(f"linha {n}: item atual sem um '> item que fica' antes")
        if " =>" in linha or linha.endswith("=>"):
            origem, _, obs = linha.partition("=>")
            origem, obs, auto = origem.strip(), obs.strip(), False
        else:
            origem, obs, auto = linha.strip(), None, True
        ordem += 1
        linhas.append((ordem, categoria, destino, origem, obs, auto, tirar))
    return linhas


def valores(linhas):
    return ",\n".join(
        f"  ({o}, {sql_texto(c)}, {sql_texto(d)}, {sql_texto(orig)}, "
        f"{sql_texto(obs)}, {'true' if auto else 'false'}, {sql_lista(t)})"
        for o, c, d, orig, obs, auto, t in linhas
    )


# Observação de uma linha do plano: a escolhida, ou o nome sem o primeiro prefixo que sair.
OBS = """case
      when not {p}.auto then nullif({p}.obs, '')
      when normalizar({nome}) = normalizar({p}.destino) then null
      else nullif(coalesce(
        (select coalesce(resto_do_nome({nome}, t.pref), '')
           from unnest({p}.tirar) with ordinality as t(pref, k)
          where resto_do_nome({nome}, t.pref) is distinct from btrim({nome})
          order by t.k limit 1),
        btrim({nome})), '')
    end"""


def previa(linhas):
    return f"""-- Prévia da limpeza de itens (gerado por scripts/limpar_itens.py). Só lê.
with plano (ordem, categoria, destino, origem, obs, auto, tirar) as (values
{valores(linhas)}
),
p as (
  select p.*, c.id as categoria_id
    from plano p
    left join categoria c on c.nome = p.categoria and c.pai_id is not null
),
o as (
  select p.*, i.id as item_id, i.nome as item_nome,
         (select count(*) from lancamento l where l.item_id = i.id) as lancamentos
    from p
    left join item i on i.categoria_id = p.categoria_id and i.nome_norm = normalizar(p.origem)
   where p.origem is not null
)
select o.categoria,
       coalesce(o.item_nome, '!! NÃO ACHADO: ' || o.origem) as item_atual,
       o.lancamentos,
       o.destino as vira,
       {OBS.format(p="o", nome="o.item_nome")} as observacao
  from o
 order by o.ordem;
"""


def aplicar(linhas):
    return f"""-- Limpeza de itens (gerado por scripts/limpar_itens.py). Tudo ou nada.
do $$
declare
  r          record;
  v_cat      bigint;
  v_dest     bigint;
  v_orig     item%rowtype;
  v_obs      text;
  v_antes    jsonb;
  v_depois   jsonb;
  v_n_antes  bigint;
  v_faltam   text[] := '{{}}';
  v_juntados int := 0;
  v_criados  int := 0;
  v_com_obs  bigint := 0;
  v_linhas   bigint;
begin
  select jsonb_object_agg(categoria_id || '|' || competencia, total), sum(n)
    into v_antes, v_n_antes
    from (select categoria_id, competencia, sum(valor) as total, count(*) as n
            from lancamento group by 1, 2) t;

  for r in
    select * from (values
{valores(linhas)}
    ) as p (ordem, categoria, destino, origem, obs, auto, tirar)
    order by ordem
  loop
    select id into v_cat from categoria where nome = r.categoria and pai_id is not null;
    if v_cat is null then
      raise exception 'Categoria não encontrada: %', r.categoria;
    end if;

    -- O item que fica: existe (acerta a grafia) ou é criado.
    select id into v_dest from item where categoria_id = v_cat and nome_norm = normalizar(r.destino);
    if v_dest is null then
      insert into item (categoria_id, nome, usos) values (v_cat, r.destino, 0) returning id into v_dest;
      v_criados := v_criados + 1;
    else
      update item set nome = r.destino, ativo = true where id = v_dest and nome is distinct from r.destino;
    end if;

    continue when r.origem is null;

    select * into v_orig from item where categoria_id = v_cat and nome_norm = normalizar(r.origem);
    if v_orig.id is null then
      v_faltam := v_faltam || (r.categoria || ': ' || r.origem);
      continue;
    end if;
    continue when v_orig.id = v_dest;

    v_obs := {OBS.format(p="r", nome="v_orig.nome")};
    if v_obs is not null then
      update lancamento
         set observacao = concat_ws(' · ', v_obs, nullif(btrim(observacao), ''))
       where item_id = v_orig.id;
      get diagnostics v_linhas = row_count;
      v_com_obs := v_com_obs + v_linhas;
    end if;

    perform mesclar_item(v_orig.id, v_dest, false);
    v_juntados := v_juntados + 1;
  end loop;

  if cardinality(v_faltam) > 0 then
    raise exception 'Itens do plano que não existem no banco (nada foi alterado): %', array_to_string(v_faltam, '; ');
  end if;

  select jsonb_object_agg(categoria_id || '|' || competencia, total)
    into v_depois
    from (select categoria_id, competencia, sum(valor) as total from lancamento group by 1, 2) t;
  if v_depois is distinct from v_antes or (select count(*) from lancamento) <> v_n_antes then
    raise exception 'Os totais por categoria e mês mudariam; nada foi alterado.';
  end if;

  raise notice 'Itens juntados: %; itens novos: %; lançamentos com observação: %', v_juntados, v_criados, v_com_obs;
end;
$$;

select (select count(*) from item) as itens,
       (select count(*) from lancamento where observacao is not null) as lancamentos_com_observacao;
"""


def main():
    if len(sys.argv) != 2:
        sys.exit("uso: limpar_itens.py <plano.txt>")
    plano = Path(sys.argv[1])
    linhas = ler_plano(plano)
    (plano.parent / "previa.sql").write_text(previa(linhas), encoding="utf-8")
    (plano.parent / "aplicar.sql").write_text(aplicar(linhas), encoding="utf-8")
    grupos = sum(1 for l in linhas if l[3] is None)
    print(f"{grupos} itens que ficam, {len(linhas) - grupos} itens atuais no plano.")


if __name__ == "__main__":
    main()

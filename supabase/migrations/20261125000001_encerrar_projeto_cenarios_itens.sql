-- Encerrar o saldo de um projeto, criar cenários e criar itens pelo app.

-- 1. Saldo de um projeto que acabou ------------------------------------------------
-- Quando um projeto é realizado ou cancelado com dinheiro no bolso, o app pergunta o
-- que foi feito com ele:
--   liquidar  -> o dinheiro foi resgatado e já gasto: vira um gasto em Projetos
--                Realizados pago com o projeto (baixa o saldo e não entra no mês, como
--                qualquer gasto pago com o dinheiro do projeto);
--   destino   -> passou para o bolso de outro projeto (ou da reserva): resgate deste e
--                aporte no outro, no mesmo dia.
-- O valor é o saldo estimado do projeto no dia escolhido. Desfazer é apagar o
-- lançamento (ou as duas transferências) na aba Lançamentos.
create function public.liquidar_projeto(
  p_id            bigint,
  p_data          date default current_date,
  p_bolso_destino bigint default null
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proj      record;
  v_valor     numeric;
  v_conta     bigint;
  v_categoria bigint;
  v_destino   text;
  v_saida     bigint;
  v_entrada   bigint;
begin
  if p_data > current_date then
    raise exception 'A data não pode ser futura';
  end if;

  select s.nome, s.bolso_id, s.saldo_inicial_em, round(s.saldo, 2) as saldo
    into v_proj
    from projetos_situacao(p_data) s
   where s.projeto_id = p_id;
  if not found then
    raise exception 'Projeto % não encontrado', p_id;
  end if;
  -- Antes do saldo de partida, a operação não entraria na conta do saldo.
  if p_data < v_proj.saldo_inicial_em then
    raise exception 'A data precisa ser a partir de %', to_char(v_proj.saldo_inicial_em, 'DD/MM/YYYY');
  end if;
  v_valor := v_proj.saldo;
  if v_valor <= 0 then
    raise exception 'O projeto não tem saldo nessa data';
  end if;

  select id into v_conta from conta where tipo = 'corrente' and ativa order by id limit 1;

  if p_bolso_destino is null then
    select c.id into v_categoria
      from categoria c
     where c.destino = 'metas' and c.pai_id is not null
     order by (normalizar(c.nome) = normalizar('Projetos Realizados')) desc, c.id
     limit 1;
    perform lancar(v_valor, v_categoria, v_proj.nome, v_conta, p_data, null,
                   'Liquidação: saldo resgatado e já gasto', p_id, true);
  else
    select s.nome into v_destino
      from projetos_situacao(p_data) s
     where s.bolso_id = p_bolso_destino and s.status = 'ativo' and s.projeto_id <> p_id;
    if v_destino is null then
      raise exception 'Escolha o bolso de um projeto ativo';
    end if;
    v_saida   := guardar(v_valor, v_proj.bolso_id, 'resgate', p_data);
    v_entrada := guardar(v_valor, p_bolso_destino, 'aporte', p_data);
    update transferencia set descricao = 'Saldo passado para ' || v_destino where id = v_saida;
    update transferencia set descricao = 'Saldo vindo de ' || v_proj.nome where id = v_entrada;
  end if;

  return v_valor;
end;
$$;

-- 2. Cenários ------------------------------------------------------------------------
-- Novo cenário, em branco ou como cópia de outro. Renomear e apagar são direto na
-- tabela (apagar leva junto os valores do cenário).
create function public.criar_cenario(p_nome text, p_copiar_de bigint default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
begin
  if nullif(trim(p_nome), '') is null then
    raise exception 'Dê um nome ao cenário';
  end if;
  insert into cenario (nome, ordem)
  values (trim(p_nome), coalesce((select max(ordem) from cenario), 0) + 1)
  returning id into v_id;

  if p_copiar_de is not null then
    insert into orcamento (cenario_id, categoria_id, item_id, bolso_id, valor)
    select v_id, o.categoria_id, o.item_id, o.bolso_id, o.valor
      from orcamento o
     where o.cenario_id = p_copiar_de;
  end if;
  return v_id;
end;
$$;

-- 3. Itens ---------------------------------------------------------------------------
-- Novo item numa categoria (não num grupo). Se já existe um com o mesmo nome
-- (pela normalizar), reativa e devolve esse.
create function public.criar_item(p_categoria_id bigint, p_nome text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
begin
  if nullif(trim(p_nome), '') is null then
    raise exception 'Dê um nome ao item';
  end if;
  if not exists (select 1 from categoria where id = p_categoria_id and pai_id is not null) then
    raise exception 'Itens ficam numa categoria, não num grupo';
  end if;
  insert into item (categoria_id, nome)
  values (p_categoria_id, trim(p_nome))
  on conflict (categoria_id, nome_norm) do update set ativo = true
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.liquidar_projeto(bigint, date, bigint) from public, anon;
revoke execute on function public.criar_cenario(text, bigint)           from public, anon;
revoke execute on function public.criar_item(bigint, text)              from public, anon;
grant execute on function public.liquidar_projeto(bigint, date, bigint) to authenticated;
grant execute on function public.criar_cenario(text, bigint)           to authenticated;
grant execute on function public.criar_item(bigint, text)              to authenticated;

-- Modelo categoria -> item -> observação (13/11/2026).
--
-- O item passa a ser o tipo de gasto ("Refeições Fora", "Compras de Mercado")
-- e a observação guarda o detalhe ("Mamma Jamma", "Pão de Açúcar"). Por isso:
--   1. o que chega do Apple Pay entra com o nome do comerciante na observação;
--   2. a tela de lançamento sugere as observações mais usadas de cada item;
--   3. mesclar itens não rouba a regra de outro item.

-- 1. Atalho: o comerciante vai também para a observação --------------------------
-- Igual à versão da migration 20261112000005, mais a coluna observacao.
create or replace function public.registrar_atalho(
  p_token       text,
  p_comerciante text,
  p_valor       text,
  p_cartao      text default null,
  p_quando      timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id  bigint;
  v_txt       text;
  v_valor     numeric(14,2);
  v_local     timestamp := p_quando at time zone 'America/Sao_Paulo';
  v_data      date := v_local::date;
  v_conta_id  bigint;
  v_descricao text := nullif(trim(p_comerciante), '');
  v_item_id   bigint;
  v_cat_id    bigint;
  v_comp      date;
begin
  select id into v_token_id
    from token_atalho
   where hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex') and ativo;
  if v_token_id is null then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;
  update token_atalho set ultimo_uso = now() where id = v_token_id;

  -- "R$ 1.234,56" -> 1234.56
  v_txt := regexp_replace(coalesce(p_valor, ''), '[^0-9,.-]', '', 'g');
  if position(',' in v_txt) > 0 then
    v_txt := replace(replace(v_txt, '.', ''), ',', '.');
  end if;
  begin
    v_valor := v_txt::numeric;
  exception when others then
    raise exception 'Valor inválido';
  end;
  if v_valor is null or v_valor = 0 then
    raise exception 'Valor inválido';
  end if;

  -- Conta: pelo apelido da Carteira; se não casar, o primeiro cartão ativo.
  select id into v_conta_id
    from conta
   where ativa and tipo = 'cartao'
   order by (lower(apelido_carteira) = lower(trim(coalesce(p_cartao, '')))) desc nulls last, id
   limit 1;
  if v_conta_id is null then
    raise exception 'Nenhum cartão ativo';
  end if;

  select s.item_id, s.categoria_id into v_item_id, v_cat_id from sugerir(v_descricao) s;
  v_comp := competencia_de(v_conta_id, v_data);

  -- A chave evita lançamento em dobro se o atalho disparar duas vezes no mesmo minuto.
  insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id, item_id,
                          descricao_original, observacao, origem_input, status, chave_dedup)
  values (v_data, v_comp, v_valor, v_conta_id, fatura_de(v_conta_id, v_comp), v_cat_id, v_item_id,
          v_descricao, v_descricao, 'atalho', 'pendente',
          'atalho:' || md5(concat_ws('|', v_conta_id, to_char(v_local, 'YYYY-MM-DD HH24:MI'),
                                     v_valor, normalizar(v_descricao))))
  on conflict (chave_dedup) where chave_dedup is not null do nothing;

  return 'ok';
end;
$$;

-- 2. Observações mais usadas de cada item, para a tela de lançamento ---------------
create view public.v_observacao
with (security_invoker = true)
as
select
  l.item_id,
  l.observacao,
  count(*)    as usos,
  max(l.data) as ultima
from public.lancamento l
where l.item_id is not null and l.observacao is not null
group by l.item_id, l.observacao;

revoke all on public.v_observacao from anon;
grant select on public.v_observacao to authenticated;

-- 3. Mesclar não rouba regra ---------------------------------------------------
-- Antes: o nome do item que some virava regra mesmo que esse texto já levasse
-- a outro item. Juntando o "Pão de Açúcar" de Lazer depois do de Mercado, a
-- regra "pao de acucar" ia parar em Lazer. Agora a regra existente fica.
create or replace function public.mesclar_item(p_origem bigint, p_destino bigint, p_guardar_nome boolean default false)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  o       item%rowtype;
  d       item%rowtype;
  v_resto text;
begin
  if p_origem = p_destino then
    raise exception 'Escolha dois itens diferentes';
  end if;
  select * into o from item where id = p_origem;
  select * into d from item where id = p_destino;
  if o.id is null or d.id is null then
    raise exception 'Item não encontrado';
  end if;
  if (select natureza from categoria where id = o.categoria_id)
     <> (select natureza from categoria where id = d.categoria_id) then
    raise exception 'Não é possível juntar um item de despesa com um de receita';
  end if;

  if p_guardar_nome then
    v_resto := resto_do_nome(o.nome, d.nome);
    if v_resto is not null then
      update lancamento
         set observacao = concat_ws(' · ', v_resto, nullif(btrim(observacao), ''))
       where item_id = o.id;
    end if;
  end if;

  update lancamento       set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update compra_parcelada set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update recorrencia      set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update regra_categorizacao set item_id = d.id where item_id = o.id;

  if o.nome_norm <> '' and o.nome_norm <> d.nome_norm then
    insert into regra_categorizacao (padrao, tipo_match, item_id, prioridade, origem)
    values (o.nome_norm, 'exato', d.id, 1000, 'manual')
    on conflict (padrao, tipo_match) do nothing;
  end if;

  update item set usos = usos + o.usos where id = d.id;
  delete from item where id = o.id;
end;
$$;

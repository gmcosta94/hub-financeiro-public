-- Observação por lançamento.
--
-- O item agrupa ("Estacionamento", "Pão de Açúcar"); a observação guarda o
-- detalhe daquele lançamento ("Shopping Centro", "lanche da viagem") sem criar um
-- item novo a cada descrição. A coluna lancamento.observacao já existia
-- (migration 3) e já sai na v_lancamento; aqui as funções passam a gravá-la.
--
-- As assinaturas antigas são removidas para não ficarem duas versões da mesma
-- função na API (o PostgREST não saberia qual chamar).

drop function public.lancar(numeric, bigint, text, bigint, date, date);
drop function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date);
drop function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date);
drop function public.mesclar_item(bigint, bigint);

-- Lançar ----------------------------------------------------------------------
create function public.lancar(
  p_valor        numeric,
  p_categoria_id bigint,
  p_descricao    text,
  p_conta_id     bigint,
  p_data         date default current_date,
  p_competencia  date default null,
  p_observacao   text default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_competencia date;
  v_id          bigint;
begin
  if not exists (select 1 from conta where id = p_conta_id) then
    raise exception 'Conta % não encontrada', p_conta_id;
  end if;

  v_competencia := coalesce(date_trunc('month', p_competencia)::date,
                            competencia_de(p_conta_id, p_data));

  insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id,
                          item_id, descricao_original, origem_input, status, observacao)
  values (p_data, v_competencia, p_valor, p_conta_id, fatura_de(p_conta_id, v_competencia),
          p_categoria_id, item_de(p_categoria_id, p_descricao),
          nullif(trim(p_descricao), ''), 'manual', 'confirmado',
          nullif(trim(p_observacao), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- Compra parcelada: a observação vai para todas as parcelas.
create function public.lancar_parcelado(
  p_valor_total          numeric,
  p_n_parcelas           int,
  p_categoria_id         bigint,
  p_descricao            text,
  p_conta_id             bigint,
  p_data                 date default current_date,
  p_primeira_competencia date default null,
  p_observacao           text default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_descricao  text := nullif(trim(p_descricao), '');
  v_observacao text := nullif(trim(p_observacao), '');
  v_primeira   date;
  v_item_id    bigint;
  v_compra_id  bigint;
  v_parcela    numeric(14,2);
  v_comp       date;
begin
  if p_n_parcelas < 2 or p_n_parcelas > 48 then
    raise exception 'Número de parcelas inválido: %', p_n_parcelas;
  end if;

  v_primeira := coalesce(date_trunc('month', p_primeira_competencia)::date,
                         competencia_de(p_conta_id, p_data));
  v_item_id  := item_de(p_categoria_id, v_descricao);
  v_parcela  := round(p_valor_total / p_n_parcelas, 2);

  insert into compra_parcelada (descricao, item_id, categoria_id, conta_id, valor_total,
                                n_parcelas, data_compra, primeira_competencia)
  values (coalesce(v_descricao, 'Compra parcelada'), v_item_id, p_categoria_id, p_conta_id,
          p_valor_total, p_n_parcelas, p_data, v_primeira)
  returning id into v_compra_id;

  for k in 1 .. p_n_parcelas loop
    v_comp := (v_primeira + (k - 1) * interval '1 month')::date;

    insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id, item_id,
                            descricao_original, origem_input, status,
                            compra_parcelada_id, parcela_numero, observacao)
    values (case when k = 1 then p_data else v_comp end,
            v_comp,
            case when k = p_n_parcelas
                 then p_valor_total - v_parcela * (p_n_parcelas - 1)
                 else v_parcela end,
            p_conta_id, fatura_de(p_conta_id, v_comp), p_categoria_id, v_item_id,
            v_descricao, 'parcela', 'confirmado', v_compra_id, k, v_observacao);
  end loop;

  return v_compra_id;
end;
$$;

-- Editar ----------------------------------------------------------------------
-- Igual à versão anterior, mais a observação:
--   * p_observacao null  -> mantém a observação atual (quem chama sem o campo não apaga nada);
--   * p_observacao ''    -> apaga a observação.
create function public.editar_lancamento(
  p_id           bigint,
  p_valor        numeric,
  p_categoria_id bigint,
  p_descricao    text,
  p_conta_id     bigint,
  p_data         date,
  p_competencia  date default null,
  p_observacao   text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_atual       lancamento%rowtype;
  v_descricao   text := nullif(trim(p_descricao), '');
  v_item_id     bigint;
  v_competencia date;
  v_padrao      text;
begin
  select * into v_atual from lancamento where id = p_id;
  if not found then
    raise exception 'Lançamento % não encontrado', p_id;
  end if;

  -- Item: mantém o atual se categoria e nome não mudaram; senão acha ou cria outro.
  if v_descricao is null then
    v_item_id := null;
  elsif v_atual.item_id is not null
        and v_atual.categoria_id = p_categoria_id
        and normalizar(v_descricao) = (select nome_norm from item where id = v_atual.item_id) then
    v_item_id := v_atual.item_id;
  else
    v_item_id := item_de(p_categoria_id, v_descricao);
  end if;

  if v_atual.item_id is not null and v_atual.item_id is distinct from v_item_id then
    update item set usos = greatest(usos - 1, 0) where id = v_atual.item_id;
  end if;

  v_competencia := coalesce(date_trunc('month', p_competencia)::date,
                            competencia_de(p_conta_id, p_data));

  update lancamento
     set valor              = p_valor,
         categoria_id       = p_categoria_id,
         item_id            = v_item_id,
         conta_id           = p_conta_id,
         data               = p_data,
         competencia        = v_competencia,
         fatura_id          = fatura_de(p_conta_id, v_competencia),
         descricao_original = case when v_atual.origem_input = 'manual'
                                   then v_descricao else v_atual.descricao_original end,
         observacao         = case when p_observacao is null
                                   then v_atual.observacao else nullif(trim(p_observacao), '') end,
         status             = 'confirmado'
   where id = p_id;

  -- Aprendizado: texto de origem -> item escolhido.
  v_padrao := normalizar(v_atual.descricao_original);
  if v_atual.origem_input in ('atalho', 'fatura_pdf') and v_item_id is not null and v_padrao <> '' then
    insert into regra_categorizacao as r (padrao, tipo_match, item_id, prioridade, origem, acertos)
    values (v_padrao, 'exato', v_item_id, 1000, 'correcao', 1)
    on conflict (padrao, tipo_match) do update
      set acertos = case when r.item_id = excluded.item_id then r.acertos + 1 else 1 end,
          erros   = case when r.item_id = excluded.item_id then r.erros else r.erros + 1 end,
          origem  = case when r.item_id = excluded.item_id then r.origem else 'correcao' end,
          item_id = excluded.item_id;
  end if;
end;
$$;

-- Mesclar itens guardando o detalhe ---------------------------------------------
-- O que sobra de um nome depois de tirar outro do começo, comparando do jeito
-- de normalizar() (sem acento, sem diferença de maiúsculas):
--   resto_do_nome('Estacionamento Shopping Centro', 'Estacionamento') -> 'Shopping Centro'
--   resto_do_nome('Lanche no Pão de Açúcar', 'Pão de Açúcar') -> o nome inteiro
--   resto_do_nome('Uber', 'Uber') -> null
create function public.resto_do_nome(p_nome text, p_base text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select nullif(
    case
      when length(p_base) > 0
           and normalizar(left(p_nome, length(p_base))) = normalizar(p_base)
           and substr(p_nome, length(p_base) + 1, 1) !~ '[[:alnum:]]'
        then btrim(substr(p_nome, length(p_base) + 1), ' -–—:,.;/')
      else btrim(p_nome)
    end,
    '');
$$;

-- Junta dois itens (como antes). Com p_guardar_nome, o nome do item que some
-- vira observação nos lançamentos dele, sem o pedaço repetido do item que fica:
-- juntar "Estacionamento Shopping Centro" em "Estacionamento" deixa a observação "Shopping Centro".
-- Observação que já existia é mantida, depois do nome.
create function public.mesclar_item(p_origem bigint, p_destino bigint, p_guardar_nome boolean default false)
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
    on conflict (padrao, tipo_match) do update set item_id = excluded.item_id;
  end if;

  update item set usos = usos + o.usos where id = d.id;
  delete from item where id = o.id;
end;
$$;

revoke execute on function public.lancar(numeric, bigint, text, bigint, date, date, text)                       from public, anon;
revoke execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date, text)        from public, anon;
revoke execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date, text)    from public, anon;
revoke execute on function public.resto_do_nome(text, text)                                                     from public, anon;
revoke execute on function public.mesclar_item(bigint, bigint, boolean)                                         from public, anon;
grant execute on function public.lancar(numeric, bigint, text, bigint, date, date, text)                       to authenticated;
grant execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date, text)        to authenticated;
grant execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date, text)    to authenticated;
grant execute on function public.resto_do_nome(text, text)                                                     to authenticated;
grant execute on function public.mesclar_item(bigint, bigint, boolean)                                         to authenticated;

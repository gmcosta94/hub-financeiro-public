-- Sugestão de categoria por regras (fase 1.3) e compra parcelada (fase 1.4).

-- Dado um texto (digitado, do Apple Pay ou da fatura), devolve o item e a
-- categoria mais prováveis, ou nenhuma linha se não reconhecer.
-- Ordem de tentativa:
--   1. regra exata para o texto normalizado;
--   2. regra do tipo "prefixo" ou "contém";
--   3. item com exatamente esse nome;
--   4. texto que CONTÉM o padrão de uma regra exata (ex.: "pao de acucar 1234"
--      contém "pao de acucar"). Só padrões de 5 letras ou mais; vence o mais longo.
create function public.sugerir(p_texto text)
returns table (item_id bigint, item text, categoria_id bigint, categoria text, como text)
language sql
stable
security invoker
set search_path = public
as $$
  with alvo as (
    select normalizar(p_texto) as t
  ),
  candidato as (
    select r.item_id, 1 as ordem, r.prioridade as peso, 'regra exata' as como
      from regra_categorizacao r, alvo
     where r.tipo_match = 'exato' and r.padrao = alvo.t
    union all
    select r.item_id, 2, length(r.padrao), 'regra por trecho'
      from regra_categorizacao r, alvo
     where (r.tipo_match = 'contem'  and position(r.padrao in alvo.t) > 0)
        or (r.tipo_match = 'prefixo' and left(alvo.t, length(r.padrao)) = r.padrao)
    union all
    select i.id, 3, i.usos, 'item de mesmo nome'
      from item i, alvo
     where i.nome_norm = alvo.t and i.ativo
    union all
    select r.item_id, 4, length(r.padrao), 'texto contém uma regra'
      from regra_categorizacao r, alvo
     where r.tipo_match = 'exato' and length(r.padrao) >= 5 and position(r.padrao in alvo.t) > 0
  )
  select i.id, i.nome, c.id, c.nome, k.como
    from candidato k
    join item i      on i.id = k.item_id
    join categoria c on c.id = i.categoria_id
    cross join alvo
   where alvo.t <> ''
   order by k.ordem, k.peso desc, i.id
   limit 1;
$$;

-- Lança uma compra parcelada de uma vez. Devolve o id da compra.
--   * gera N lançamentos, um por mês a partir da primeira competência;
--   * a última parcela absorve a diferença de centavos;
--   * a primeira parcela leva a data da compra; as demais, o dia 1 do mês delas.
create function public.lancar_parcelado(
  p_valor_total          numeric,
  p_n_parcelas           int,
  p_categoria_id         bigint,
  p_descricao            text,
  p_conta_id             bigint,
  p_data                 date default current_date,
  p_primeira_competencia date default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_descricao text := nullif(trim(p_descricao), '');
  v_primeira  date;
  v_item_id   bigint;
  v_compra_id bigint;
  v_parcela   numeric(14,2);
  v_comp      date;
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
                            compra_parcelada_id, parcela_numero)
    values (case when k = 1 then p_data else v_comp end,
            v_comp,
            case when k = p_n_parcelas
                 then p_valor_total - v_parcela * (p_n_parcelas - 1)
                 else v_parcela end,
            p_conta_id, fatura_de(p_conta_id, v_comp), p_categoria_id, v_item_id,
            v_descricao, 'parcela', 'confirmado', v_compra_id, k);
  end loop;

  return v_compra_id;
end;
$$;

-- Apaga a compra e todas as suas parcelas (inclusive as de meses passados).
create function public.apagar_compra_parcelada(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_id bigint;
begin
  delete from compra_parcelada where id = p_id returning item_id into v_item_id;  -- parcelas vão junto
  if v_item_id is not null then
    update item set usos = greatest(usos - 1, 0) where id = v_item_id;
  end if;
end;
$$;

revoke execute on function public.sugerir(text)                                                      from public, anon;
revoke execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date)   from public, anon;
revoke execute on function public.apagar_compra_parcelada(bigint)                                    from public, anon;
grant execute on function public.sugerir(text)                                                      to authenticated;
grant execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date)   to authenticated;
grant execute on function public.apagar_compra_parcelada(bigint)                                    to authenticated;

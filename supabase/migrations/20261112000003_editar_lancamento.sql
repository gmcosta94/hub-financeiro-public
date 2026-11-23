-- Editar e apagar lançamentos, e ver as transferências do mês.

-- Peças reaproveitadas por todas as funções que gravam lançamento ----------

-- Acha ou cria o item de uma categoria pela descrição normalizada e soma 1 no uso.
-- Devolve null se a descrição vier vazia.
create function public.item_de(p_categoria_id bigint, p_descricao text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_descricao text := nullif(trim(p_descricao), '');
  v_id        bigint;
begin
  if v_descricao is null then
    return null;
  end if;

  insert into item (categoria_id, nome, usos)
  values (p_categoria_id, v_descricao, 1)
  on conflict (categoria_id, nome_norm)
    do update set usos = item.usos + 1, ativo = true
  returning id into v_id;

  return v_id;
end;
$$;

-- Acha ou cria a fatura de um cartão em um mês. Devolve null para conta que não é cartão.
create function public.fatura_de(p_conta_id bigint, p_competencia date)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
begin
  if (select tipo from conta where id = p_conta_id) is distinct from 'cartao' then
    return null;
  end if;

  insert into fatura (conta_id, competencia)
  values (p_conta_id, p_competencia)
  on conflict (conta_id, competencia) do nothing;

  select id into v_id from fatura where conta_id = p_conta_id and competencia = p_competencia;
  return v_id;
end;
$$;

-- lancar passa a usar as duas peças acima (mesmo comportamento de antes).
create or replace function public.lancar(
  p_valor        numeric,
  p_categoria_id bigint,
  p_descricao    text,
  p_conta_id     bigint,
  p_data         date default current_date,
  p_competencia  date default null
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
                          item_id, descricao_original, origem_input, status)
  values (p_data, v_competencia, p_valor, p_conta_id, fatura_de(p_conta_id, v_competencia),
          p_categoria_id, item_de(p_categoria_id, p_descricao),
          nullif(trim(p_descricao), ''), 'manual', 'confirmado')
  returning id into v_id;

  return v_id;
end;
$$;

-- Editar ---------------------------------------------------------------------
-- Regrava um lançamento com o que veio da tela e o deixa confirmado.
--   * descricao_original só muda em lançamento manual; no que veio do atalho,
--     da fatura ou da planilha, o texto de origem é preservado.
--   * corrigir um lançamento vindo do atalho ou da fatura ensina uma regra:
--     da próxima vez, o mesmo texto já chega com este item e esta categoria.
create function public.editar_lancamento(
  p_id           bigint,
  p_valor        numeric,
  p_categoria_id bigint,
  p_descricao    text,
  p_conta_id     bigint,
  p_data         date,
  p_competencia  date default null
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

-- Apagar ---------------------------------------------------------------------
create function public.apagar_lancamento(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_id bigint;
begin
  delete from lancamento where id = p_id returning item_id into v_item_id;
  if v_item_id is not null then
    update item set usos = greatest(usos - 1, 0) where id = v_item_id;
  end if;
end;
$$;

-- Transferências com o nome do bolso, para a tela do mês.
create view public.v_transferencia
with (security_invoker = true)
as
select
  t.id,
  t.data,
  t.competencia,
  t.valor,
  t.tipo,
  t.bolso_id,
  b.nome as bolso,
  t.descricao,
  t.origem_input
from public.transferencia t
left join public.bolso b on b.id = t.bolso_id;

revoke all on public.v_transferencia from anon;
grant select on public.v_transferencia to authenticated;

revoke execute on function public.item_de(bigint, text)                                          from public, anon;
revoke execute on function public.fatura_de(bigint, date)                                        from public, anon;
revoke execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date) from public, anon;
revoke execute on function public.apagar_lancamento(bigint)                                      from public, anon;
grant execute on function public.item_de(bigint, text)                                          to authenticated;
grant execute on function public.fatura_de(bigint, date)                                        to authenticated;
grant execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date) to authenticated;
grant execute on function public.apagar_lancamento(bigint)                                      to authenticated;

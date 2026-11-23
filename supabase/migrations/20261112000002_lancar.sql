-- Lançamento rápido (fase 1.2): as regras de gravação ficam no banco.
-- O app só chama lancar() ou guardar() com o que a pessoa digitou.

-- Em que mês do orçamento uma data cai, para uma conta.
--   * conta corrente: o mês da própria data;
--   * cartão: o mês em que a fatura fecha. Compra ANTES do dia do fechamento
--     fica no mês; no próprio dia do fechamento (o "melhor dia de compra")
--     ou depois dele, vai para o mês seguinte.
-- O fechamento vem da fatura, se já foi informado; senão, do dia padrão do cartão.
create function public.competencia_de(p_conta_id bigint, p_data date)
returns date
language sql
stable
set search_path = public
as $$
  select case
    when c.tipo <> 'cartao' or c.dia_fechamento_padrao is null then mes.inicio
    when p_data < coalesce(
           f.data_fechamento,
           mes.inicio + (least(c.dia_fechamento_padrao, mes.ultimo_dia) - 1)
         ) then mes.inicio
    else (mes.inicio + interval '1 month')::date
  end
  from conta c
  cross join lateral (
    select date_trunc('month', p_data)::date as inicio,
           extract(day from date_trunc('month', p_data) + interval '1 month - 1 day')::int as ultimo_dia
  ) mes
  left join fatura f on f.conta_id = c.id and f.competencia = mes.inicio
  where c.id = p_conta_id;
$$;

-- Grava um gasto ou uma renda digitados no app. Devolve o id do lançamento.
--   * acha ou cria o item pela descrição normalizada e soma 1 no uso;
--   * usa a competência informada (p_competencia) ou, se vier vazia, calcula;
--   * em cartão, acha ou cria a fatura do mês.
-- security invoker: valem as políticas de quem chama (só editor grava).
create function public.lancar(
  p_valor        numeric,
  p_categoria_id bigint,
  p_descricao    text,
  p_conta_id     bigint,
  p_data         date default current_date,
  p_competencia  date default null   -- a tela sugere a calculada e deixa trocar
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_descricao   text := nullif(trim(p_descricao), '');
  v_conta_tipo  text;
  v_competencia date;
  v_fatura_id   bigint;
  v_item_id     bigint;
  v_id          bigint;
begin
  select tipo into v_conta_tipo from conta where id = p_conta_id;
  if v_conta_tipo is null then
    raise exception 'Conta % não encontrada', p_conta_id;
  end if;

  v_competencia := coalesce(date_trunc('month', p_competencia)::date,
                            competencia_de(p_conta_id, p_data));

  if v_conta_tipo = 'cartao' then
    insert into fatura (conta_id, competencia)
    values (p_conta_id, v_competencia)
    on conflict (conta_id, competencia) do nothing;

    select id into v_fatura_id
    from fatura where conta_id = p_conta_id and competencia = v_competencia;
  end if;

  if v_descricao is not null then
    insert into item (categoria_id, nome, usos)
    values (p_categoria_id, v_descricao, 1)
    on conflict (categoria_id, nome_norm)
      do update set usos = item.usos + 1, ativo = true
    returning id into v_item_id;
  end if;

  insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id,
                          item_id, descricao_original, origem_input, status)
  values (p_data, v_competencia, p_valor, p_conta_id, v_fatura_id, p_categoria_id,
          v_item_id, v_descricao, 'manual', 'confirmado')
  returning id into v_id;

  return v_id;
end;
$$;

-- Grava um aporte ou resgate em um bolso (reserva, carteira, projeto).
-- O dinheiro sai da conta corrente no aporte e volta para ela no resgate.
create function public.guardar(
  p_valor    numeric,
  p_bolso_id bigint,
  p_tipo     text default 'aporte',
  p_data     date default current_date
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conta_id bigint;
  v_id       bigint;
begin
  if p_tipo not in ('aporte', 'resgate') then
    raise exception 'Tipo inválido: % (use aporte ou resgate)', p_tipo;
  end if;

  select id into v_conta_id
  from conta where tipo = 'corrente' and ativa order by id limit 1;

  insert into transferencia (data, competencia, valor, tipo, conta_origem_id, conta_destino_id, bolso_id)
  values (p_data, date_trunc('month', p_data)::date, p_valor, p_tipo,
          case when p_tipo = 'aporte'  then v_conta_id end,
          case when p_tipo = 'resgate' then v_conta_id end,
          p_bolso_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- Categorias para a tela de lançamento, com o uso recente para ordenar.
create view public.v_categoria
with (security_invoker = true)
as
select
  c.id,
  c.nome,
  g.nome   as grupo,
  c.natureza,
  c.destino,
  g.ordem  as grupo_ordem,
  c.ordem,
  (select count(*) from public.lancamento l
    where l.categoria_id = c.id and l.data >= current_date - 90) as usos_recentes
from public.categoria c
join public.categoria g on g.id = c.pai_id
where c.ativa;

revoke all on public.v_categoria from anon;
grant select on public.v_categoria to authenticated;

revoke execute on function public.competencia_de(bigint, date)               from public, anon;
revoke execute on function public.lancar(numeric, bigint, text, bigint, date, date) from public, anon;
revoke execute on function public.guardar(numeric, bigint, text, date)        from public, anon;
grant execute on function public.competencia_de(bigint, date)               to authenticated;
grant execute on function public.lancar(numeric, bigint, text, bigint, date, date) to authenticated;
grant execute on function public.guardar(numeric, bigint, text, date)        to authenticated;

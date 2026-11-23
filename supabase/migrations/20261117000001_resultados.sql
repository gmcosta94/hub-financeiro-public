-- Aba Resultados: o relatório mês a mês do ano, como a aba de mesmo nome da planilha,
-- com o que cada comparação precisa: orçado, realizado do período anterior (análise
-- horizontal) e ganhos do período (base da análise vertical).

-- Uma linha por linha do relatório e por mês do ano, mais o total do ano (competencia
-- nula). Linhas do relatório:
--   tipo 'linha': uma linha do orçamento (categoria, ou o bolso de Investimentos/Metas);
--   tipo 'bloco': o subtotal do bloco (Ganhos, Descontos, ...);
--   tipo 'total': Renda líquida (ganhos − descontos), Investido + gasto e Saldo.
-- sentido: 1 quando mais é melhor (ganhos, investimentos, metas, renda líquida, saldo),
-- -1 quando menos é melhor (descontos, gastos) e 0 quando não há juízo (investido + gasto).
-- Meses sem nenhum lançamento (antes do histórico, ou ainda por vir) têm realizado nulo.
-- No total do ano, orçado e realizado somam só os meses com realizado, e o anterior é a
-- soma dos mesmos meses do ano anterior (nulo se algum deles não tem dados).
create function public.resultados_ano(p_ano int)
returns table (
  competencia date,
  tipo        text,
  chave       text,
  bloco       text,
  posicao     int,
  nome        text,
  ordem       int,
  sentido     int,
  orcado      numeric,
  realizado   numeric,
  anterior    numeric,
  ganhos      numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with meses as (
    select g::date as mes,
           g::date <= date_trunc('month', current_date)::date
             and exists (select 1 from lancamento l where l.competencia = g::date) as tem_dados
      from generate_series(make_date(p_ano - 1, 1, 1), make_date(p_ano, 12, 1), interval '1 month') as g
  ),
  base as (
    select m.mes, r.bloco, r.bloco_ordem, r.linha_id, r.nome, r.destino, r.ordem, r.orcado,
           case when m.tem_dados then r.realizado end as realizado
      from meses m
     cross join lateral resultado_mes(m.mes) r
  ),
  mensal as (
    select b.mes, 'linha' as tipo, 'l' || b.linha_id as chave, b.bloco, b.bloco_ordem * 10 as posicao,
           b.nome, b.ordem, b.destino, b.orcado, b.realizado
      from base b
    union all
    select b.mes, 'bloco', 'b' || b.bloco_ordem, b.bloco, b.bloco_ordem * 10,
           b.bloco, -1, min(b.destino), sum(b.orcado), sum(b.realizado)
      from base b
     group by b.mes, b.bloco, b.bloco_ordem
    union all
    select b.mes, 'total', 'renda_liquida', null, 25, 'Renda líquida', 0, 'renda_liquida',
           sum(case b.destino when 'receita' then b.orcado else -b.orcado end),
           sum(case b.destino when 'receita' then b.realizado else -b.realizado end)
      from base b
     where b.destino in ('receita', 'desconto')
     group by b.mes
    union all
    select b.mes, 'total', 'investido_gasto', null, 70, 'Investido + gasto', 0, 'investido_gasto',
           sum(b.orcado), sum(b.realizado)
      from base b
     where b.destino not in ('receita', 'desconto')
     group by b.mes
    union all
    select b.mes, 'total', 'saldo', null, 80, 'Saldo', 0, 'saldo',
           sum(case b.destino when 'receita' then b.orcado else -b.orcado end),
           sum(case b.destino when 'receita' then b.realizado else -b.realizado end)
      from base b
     group by b.mes
  ),
  ganhos as (
    select b.mes, sum(b.realizado) as ganhos
      from base b
     where b.destino = 'receita'
     group by b.mes
  ),
  do_ano as (
    select m.*, a.realizado as anterior, g.ganhos
      from mensal m
      left join mensal a on a.chave = m.chave and a.mes = (m.mes - interval '1 month')::date
      left join ganhos g on g.mes = m.mes
     where m.mes >= make_date(p_ano, 1, 1)
  ),
  -- Meses do ano com realizado: definem o período do total e o mesmo período do ano anterior.
  periodo as (
    select mes from meses where tem_dados and mes >= make_date(p_ano, 1, 1)
  ),
  total as (
    select m.chave,
           sum(m.orcado) filter (where m.mes in (select mes from periodo)) as orcado,
           sum(m.realizado) filter (where m.mes in (select mes from periodo)) as realizado,
           case when (select count(*) from periodo) > 0
                 and (select bool_and(mm.tem_dados) from meses mm
                       where mm.mes in (select (p.mes - interval '1 year')::date from periodo p))
                then sum(m.realizado) filter (where m.mes in (select (p.mes - interval '1 year')::date from periodo p))
           end as anterior
      from mensal m
     group by m.chave
  )
  select d.mes, d.tipo, d.chave, d.bloco, d.posicao, d.nome, d.ordem,
         case d.destino
           when 'receita' then 1 when 'investimentos' then 1 when 'metas' then 1
           when 'renda_liquida' then 1 when 'saldo' then 1
           when 'desconto' then -1 when 'gasto_do_mes' then -1
           else 0
         end,
         d.orcado, d.realizado, d.anterior, d.ganhos
    from do_ano d
  union all
  select null, d.tipo, d.chave, d.bloco, d.posicao, d.nome, d.ordem,
         case d.destino
           when 'receita' then 1 when 'investimentos' then 1 when 'metas' then 1
           when 'renda_liquida' then 1 when 'saldo' then 1
           when 'desconto' then -1 when 'gasto_do_mes' then -1
           else 0
         end,
         t.orcado, t.realizado, t.anterior,
         (select sum(g.ganhos) from ganhos g where g.mes in (select mes from periodo))
    from (select distinct on (chave) * from do_ano order by chave, mes desc) d
    join total t on t.chave = d.chave
   order by 1 nulls last, 5, 7, 6;
$$;

revoke execute on function public.resultados_ano(int) from public, anon;
grant execute on function public.resultados_ano(int) to authenticated;

-- Resultados por meio de pagamento, como o filtro da planilha: o demonstrativo só com
-- o que passou por uma conta (o cartão, para bater a fatura; a conta corrente, para
-- bater o saldo). resultado_mes e resultados_ano ganham p_conta_id opcional; sem ele,
-- tudo fica como antes.
--
-- Com a conta: lançamentos dessa conta; aportes que saíram dela e resgates que
-- entraram nela; descontos ficam zerados (não passam por conta). O orçado some no
-- demonstrativo filtrado, porque o orçamento não é por conta.

drop function public.resultado_mes(date, bigint);
drop function public.resultados_ano(int);

create function public.resultado_mes(
  p_competencia date default null,
  p_cenario_id  bigint default null,
  p_conta_id    bigint default null
)
returns table (
  bloco       text,
  bloco_ordem int,
  linha_id    bigint,
  nome        text,
  destino     text,
  ordem       int,
  orcado      numeric,
  realizado   numeric,
  detalhado   boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with linhas as (
    select c.id as linha_id, c.nome, c.destino, c.ordem, c.ativa, c.custo_de_vida
      from categoria c
     where (c.pai_id is not null and c.destino not in ('investimentos', 'metas'))
        or (c.pai_id is null and c.destino in ('investimentos', 'metas'))
  ),
  orc as (
    select x.linha_id, sum(x.valor) as orcado, bool_or(x.categoria_id is distinct from x.linha_id) as detalhado
      from (
        select coalesce(lc.linha_id, li.linha_id, lb.linha_id) as linha_id, o.categoria_id, o.valor
          from orcamento o
          left join v_linha_categoria lc on lc.categoria_id = o.categoria_id
          left join item i               on i.id = o.item_id
          left join v_linha_categoria li on li.categoria_id = i.categoria_id
          left join v_linha_bolso lb     on lb.bolso_id = o.bolso_id
         where (p_competencia is not null and o.competencia = p_competencia)
            or (p_cenario_id is not null and o.cenario_id = p_cenario_id)
      ) x
     group by x.linha_id
  ),
  rea as (
    select x.linha_id, sum(x.valor) as realizado
      from (
        select lc.linha_id, l.valor
          from lancamento l
          join v_linha_categoria lc on lc.categoria_id = l.categoria_id
         where l.competencia = p_competencia and l.status = 'confirmado' and not l.pago_com_projeto
           and (p_conta_id is null or l.conta_id = p_conta_id)
        union all
        select lb.linha_id, case t.tipo when 'resgate' then -t.valor else t.valor end
          from transferencia t
          join v_linha_bolso lb on lb.bolso_id = t.bolso_id
         where t.competencia = p_competencia and t.tipo in ('aporte', 'resgate', 'amortizacao')
           and (p_conta_id is null or p_conta_id in (t.conta_origem_id, t.conta_destino_id))
      ) x
     group by x.linha_id
  )
  select
    case l.destino
      when 'receita'       then 'Ganhos'
      when 'desconto'      then 'Descontos'
      when 'investimentos' then 'Poupança e Investimentos'
      when 'metas'         then 'Metas'
      else case when l.custo_de_vida then 'Custo de Vida' else 'Fora do Custo de Vida' end
    end,
    case l.destino
      when 'receita'       then 1
      when 'desconto'      then 2
      when 'investimentos' then 3
      when 'metas'         then 4
      else case when l.custo_de_vida then 5 else 6 end
    end,
    l.linha_id,
    l.nome,
    l.destino,
    l.ordem,
    coalesce(o.orcado, 0),
    case when p_competencia is null then null
         when l.destino = 'desconto' then case when p_conta_id is null then coalesce(o.orcado, 0) else 0 end
         else coalesce(r.realizado, 0) end,
    coalesce(o.detalhado, false)
  from linhas l
  left join orc o on o.linha_id = l.linha_id
  left join rea r on r.linha_id = l.linha_id
  where l.ativa or o.orcado is not null or r.realizado is not null
  order by 2, l.ordem, l.nome;
$$;

create function public.resultados_ano(p_ano int, p_conta_id bigint default null)
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
    -- Filtrado por meio de pagamento, não há orçado (o orçamento não é por conta).
    select m.mes, r.bloco, r.bloco_ordem, r.linha_id, r.nome, r.destino, r.ordem,
           case when p_conta_id is null then r.orcado end as orcado,
           case when m.tem_dados then r.realizado end as realizado
      from meses m
     cross join lateral resultado_mes(m.mes, null, p_conta_id) r
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
  -- Base da análise vertical: os ganhos do mês de todas as contas, mesmo com filtro
  -- (o que passou por um cartão, como fatia da renda).
  ganhos as (
    select m.mes, sum(r.realizado) filter (where m.tem_dados) as ganhos
      from meses m
     cross join lateral resultado_mes(m.mes) r
     where r.destino = 'receita'
     group by m.mes
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

revoke execute on function public.resultado_mes(date, bigint, bigint) from public, anon;
revoke execute on function public.resultados_ano(int, bigint)        from public, anon;
grant execute on function public.resultado_mes(date, bigint, bigint) to authenticated;
grant execute on function public.resultados_ano(int, bigint)        to authenticated;

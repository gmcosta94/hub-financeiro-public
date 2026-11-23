-- Fase 5: painéis.
-- Bens e dívidas (apartamento, carro, saldo devedor) com valor atualizado à mão,
-- patrimônio de hoje e uma foto por mês, e as séries do ano para os painéis:
-- realizado × orçado por linha, taxa de poupança e gastos por item.

-- 1. Bens e dívidas -----------------------------------------------------------------
create table public.bem (
  id            bigint generated always as identity primary key,
  nome          text not null unique,
  natureza      text not null check (natureza in ('bem', 'divida')),
  ativo         boolean not null default true,
  ordem         int not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
select public.aplicar_acesso_padrao('bem');

-- Cada atualização de valor é uma linha; vale a mais recente até a data.
create table public.bem_valor (
  id            bigint generated always as identity primary key,
  bem_id        bigint not null references public.bem (id) on delete cascade,
  em            date not null,
  valor         numeric(14,2) not null check (valor >= 0),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (bem_id, em)
);
select public.aplicar_acesso_padrao('bem_valor');

-- 2. Foto mensal do patrimônio -------------------------------------------------------
-- Uma linha por bolso ou bem em cada mês. O mês corrente é refeito sempre que o app
-- abre os painéis (por quem edita); os meses passados ficam como estavam.
create table public.patrimonio_mes (
  id            bigint generated always as identity primary key,
  competencia   date not null check (competencia = date_trunc('month', competencia)::date),
  bolso_id      bigint references public.bolso (id) on delete cascade,
  bem_id        bigint references public.bem (id) on delete cascade,
  grupo         text not null,
  nome          text not null,
  valor         numeric(14,2) not null,       -- dívida entra negativa
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (num_nonnulls(bolso_id, bem_id) = 1),
  constraint patrimonio_mes_unico unique nulls not distinct (competencia, bolso_id, bem_id)
);
select public.aplicar_acesso_padrao('patrimonio_mes');

-- 3. Patrimônio numa data ---------------------------------------------------------------
-- Investimentos: valor de mercado de cada bolso (posicao_carteira). Reserva e
-- projetos: saldo estimado (projetos_situacao). Bens e dívidas: último valor até a data.
create function public.patrimonio_atual(p_em date default current_date)
returns table (grupo text, grupo_ordem int, bolso_id bigint, bem_id bigint, nome text, valor numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select 'Investimentos', 1, p.bolso_id, null::bigint, p.bolso, round(sum(p.valor_brl), 2)
    from posicao_carteira(p_em) p
   group by p.bolso_id, p.bolso
  having sum(p.valor_brl) <> 0
  union all
  select 'Reserva e projetos', 2, s.bolso_id, null, s.nome, round(s.saldo, 2)
    from projetos_situacao(p_em) s
   where s.status <> 'cancelado' and s.saldo <> 0
  union all
  select case b.natureza when 'bem' then 'Bens' else 'Dívidas' end,
         case b.natureza when 'bem' then 3 else 4 end,
         null, b.id, b.nome,
         case b.natureza when 'bem' then v.valor else -v.valor end
    from bem b
    join lateral (
      select bv.valor from bem_valor bv
       where bv.bem_id = b.id and bv.em <= p_em
       order by bv.em desc limit 1
    ) v on true
   where b.ativo
  order by 2, 6 desc;
$$;

-- Refaz a foto do mês corrente. Devolve quantas linhas gravou.
create function public.fotografar_patrimonio()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mes date := date_trunc('month', current_date)::date;
  v_n   int;
begin
  delete from patrimonio_mes where competencia = v_mes;
  insert into patrimonio_mes (competencia, bolso_id, bem_id, grupo, nome, valor)
  select v_mes, a.bolso_id, a.bem_id, a.grupo, a.nome, a.valor
    from patrimonio_atual(current_date) a;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Evolução mês a mês: o patrimônio das fotos (total e só investimentos) e, desde o
-- primeiro aporte, o dinheiro posto em investimentos (compras − vendas, acumulado).
-- Antes da posição de partida vale o histórico do MyProfit; depois, as movimentações.
create function public.patrimonio_evolucao()
returns table (competencia date, patrimonio numeric, investimentos numeric, aportado numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with fluxo as (
    select date_trunc('month', h.data)::date as mes,
           case h.tipo when 'compra' then h.valor_brl when 'venda' then -h.valor_brl else 0 end as v
      from historico_investimento h
    union all
    select date_trunc('month', m.data)::date,
           case m.tipo when 'compra' then m.valor_brl when 'venda' then -m.valor_brl else 0 end
      from movimentacao m
     where m.tipo in ('compra', 'venda')
  ),
  meses as (
    select generate_series(
             coalesce((select min(mes) from fluxo), (select min(competencia) from patrimonio_mes),
                      date_trunc('month', current_date)::date),
             greatest(date_trunc('month', current_date)::date, coalesce((select max(competencia) from patrimonio_mes), '-infinity')),
             interval '1 month')::date as mes
  ),
  por_mes as (
    select mes, sum(v) as v from fluxo group by mes
  ),
  fotos as (
    select p.competencia, sum(p.valor) as patrimonio,
           sum(p.valor) filter (where p.grupo = 'Investimentos') as investimentos
      from patrimonio_mes p group by p.competencia
  )
  select m.mes, f.patrimonio, f.investimentos,
         round(sum(coalesce(pm.v, 0)) over (order by m.mes), 2)
    from meses m
    left join por_mes pm on pm.mes = m.mes
    left join fotos f on f.competencia = m.mes
   order by m.mes;
$$;

-- 4. Séries do ano ------------------------------------------------------------------------
-- Realizado × orçado de cada linha do orçamento em cada mês do ano. Meses depois do
-- atual têm realizado nulo (só o orçado).
create function public.resultado_ano(p_ano int)
returns table (
  competencia date,
  bloco       text,
  bloco_ordem int,
  linha_id    bigint,
  nome        text,
  destino     text,
  ordem       int,
  orcado      numeric,
  realizado   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.mes, r.bloco, r.bloco_ordem, r.linha_id, r.nome, r.destino, r.ordem, r.orcado,
         case when m.mes > date_trunc('month', current_date)::date then null else r.realizado end
    from generate_series(make_date(p_ano, 1, 1), make_date(p_ano, 12, 1), interval '1 month') as g(d)
   cross join lateral (select g.d::date as mes) m
   cross join lateral resultado_mes(m.mes) r
   order by m.mes, r.bloco_ordem, r.ordem, r.nome;
$$;

-- Taxa de poupança de cada mês: poupança (aportes líquidos nos bolsos que contam na
-- poupança) ÷ ganhos, orçada e realizada, e o acumulado do ano até o mês.
create function public.poupanca_ano(p_ano int)
returns table (
  competencia          date,
  ganhos_orcado        numeric,
  ganhos_realizado     numeric,
  poupanca_orcado      numeric,
  poupanca_realizado   numeric,
  taxa_orcada          numeric,
  taxa_realizada       numeric,
  taxa_acumulada       numeric,     -- realizada, de janeiro até o mês
  taxa_orcada_acumulada numeric     -- orçada, de janeiro até o mês
)
language sql
stable
security invoker
set search_path = public
as $$
  with meses as (
    select g.d::date as mes, g.d::date <= date_trunc('month', current_date)::date as passado
      from generate_series(make_date(p_ano, 1, 1), make_date(p_ano, 12, 1), interval '1 month') as g(d)
  ),
  base as (
    select m.mes, m.passado,
           (select coalesce(sum(r.orcado), 0) from resultado_mes(m.mes) r where r.destino = 'receita') as go,
           (select coalesce(sum(r.realizado), 0) from resultado_mes(m.mes) r where r.destino = 'receita') as gr,
           p.orcado as po, p.realizado as pr
      from meses m
     cross join lateral poupanca_mes(m.mes) p
  )
  select b.mes,
         b.go,
         case when b.passado then b.gr end,
         b.po,
         case when b.passado then b.pr end,
         case when b.go <> 0 then round(b.po / b.go, 4) end,
         case when b.passado and b.gr <> 0 then round(b.pr / b.gr, 4) end,
         case when b.passado then
           round(sum(b.pr) filter (where b.passado) over w / nullif(sum(b.gr) filter (where b.passado) over w, 0), 4)
         end,
         round(sum(b.po) over w / nullif(sum(b.go) over w, 0), 4)
    from base b
  window w as (order by b.mes)
   order by b.mes;
$$;

-- Itens de uma linha (categoria) em cada mês do ano: realizado × orçado, com
-- "Outros gastos" para o que não tem item orçado. Mesma regra do pop-up do orçamento.
create function public.itens_ano(p_ano int, p_linha_id bigint)
returns table (competencia date, tipo text, ref_id bigint, nome text, ordem int, orcado numeric, realizado numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select m.mes, d.tipo, d.ref_id, d.nome, d.ordem, coalesce(d.orcado, 0),
         case when m.mes > date_trunc('month', current_date)::date then null else coalesce(d.realizado, 0) end
    from generate_series(make_date(p_ano, 1, 1), make_date(p_ano, 12, 1), interval '1 month') as g(d)
   cross join lateral (select g.d::date as mes) m
   cross join lateral orcamento_detalhe(p_linha_id, m.mes) d
   order by m.mes, d.ordem, d.nome;
$$;

-- 5. Permissões ---------------------------------------------------------------------------
revoke execute on function public.patrimonio_atual(date)       from public, anon;
revoke execute on function public.fotografar_patrimonio()      from public, anon;
revoke execute on function public.patrimonio_evolucao()        from public, anon;
revoke execute on function public.resultado_ano(int)           from public, anon;
revoke execute on function public.poupanca_ano(int)            from public, anon;
revoke execute on function public.itens_ano(int, bigint)       from public, anon;
grant execute on function public.patrimonio_atual(date)       to authenticated;
grant execute on function public.fotografar_patrimonio()      to authenticated;
grant execute on function public.patrimonio_evolucao()        to authenticated;
grant execute on function public.resultado_ano(int)           to authenticated;
grant execute on function public.poupanca_ano(int)            to authenticated;
grant execute on function public.itens_ano(int, bigint)       to authenticated;

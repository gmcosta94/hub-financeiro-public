-- Rentabilidade e objetivo aposentadoria (fase 4, segunda entrega).
--
-- Rentabilidade pelo fluxo de caixa (taxa interna de retorno): cada compra é
-- dinheiro que entra no investimento, cada venda e cada provento é dinheiro que
-- sai, e no fim sai o valor de hoje. A taxa real usa os fluxos corrigidos pelo
-- IPCA até hoje (série SGS 433 do Banco Central, buscada pelo app).
-- O histórico vem do MyProfit (negociações e proventos até a posição de partida);
-- daí em diante, das movimentações lançadas no app.

-- 1. Histórico de negociações e proventos antes da posição de partida ---------------
create table public.historico_investimento (
  id            bigint generated always as identity primary key,
  data          date not null,
  ticker        text not null,
  bolso_id      bigint not null references public.bolso (id),
  tipo          text not null check (tipo in ('compra', 'venda', 'provento')),
  quantidade    numeric(20,8) not null default 0,
  valor_brl     numeric(14,2) not null check (valor_brl >= 0),
  moeda         text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  valor_moeda   numeric(14,4),
  fonte         text not null default 'myprofit',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index historico_investimento_bolso_idx on public.historico_investimento (bolso_id, data);
select public.aplicar_acesso_padrao('historico_investimento');

-- 2. Objetivo: alvo de patrimônio para um conjunto de bolsos -------------------------
create table public.objetivo (
  id                   bigint generated always as identity primary key,
  nome                 text not null unique,
  renda_mensal_alvo    numeric(14,2) not null check (renda_mensal_alvo > 0),   -- em reais de hoje
  taxa_retirada_anual  numeric(6,4) not null check (taxa_retirada_anual > 0),
  taxa_real_anual      numeric(6,4) not null,                                  -- premissa do plano
  data_alvo            date not null,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
select public.aplicar_acesso_padrao('objetivo');

create table public.objetivo_bolso (
  objetivo_id   bigint not null references public.objetivo (id) on delete cascade,
  bolso_id      bigint not null references public.bolso (id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (objetivo_id, bolso_id)
);
select public.aplicar_acesso_padrao('objetivo_bolso');

-- Premissas iniciais (editáveis na tela): renda de R$ 10 mil por mês em reais de
-- hoje, retirada de 4% ao ano, 6% ao ano real
-- (os 0,85% a.m. nominais da planilha menos a inflação), até dez/2050.
insert into public.objetivo (nome, renda_mensal_alvo, taxa_retirada_anual, taxa_real_anual, data_alvo)
values ('Aposentadoria', 10000, 0.04, 0.06, '2050-12-01');
insert into public.objetivo_bolso (objetivo_id, bolso_id)
select o.id, b.id from public.objetivo o, public.bolso b
 where o.nome = 'Aposentadoria' and b.tipo in ('carteira_principal', 'carteira_satelite');

-- 3. Fluxos e taxa interna de retorno -------------------------------------------------
-- Quanto R$ 1 de uma data vale hoje pela inflação (IPCA dos meses fechados).
create function public.fator_ipca(p_de date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(exp(sum(ln(1 + valor / 100))), 1)
    from indice
   where nome = 'IPCA' and competencia >= date_trunc('month', p_de) and competencia < date_trunc('month', current_date);
$$;

-- Fluxos de caixa do ponto de vista de quem investe (negativo = dinheiro posto,
-- positivo = dinheiro tirado), dos bolsos pedidos (todos, se vazio), mais o valor
-- de hoje como último fluxo.
create function public.fluxos_investimento(p_bolsos bigint[] default null)
returns table (data date, valor numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with partida as (
    select coalesce(min(m.data), current_date) as d from movimentacao m where m.tipo = 'posicao_inicial'
  ),
  hist as (
    select h.data, case h.tipo when 'compra' then -h.valor_brl else h.valor_brl end as valor
      from historico_investimento h, partida
     where (p_bolsos is null or h.bolso_id = any (p_bolsos)) and h.data < partida.d
  ),
  depois as (
    select m.data, case m.tipo when 'compra' then -m.valor_brl else m.valor_brl end
      from movimentacao m
      join ativo a on a.id = m.ativo_id, partida
     where m.tipo in ('compra', 'venda', 'provento') and m.data >= partida.d
       and (p_bolsos is null or a.bolso_id = any (p_bolsos))
  ),
  hoje as (
    select current_date, sum(coalesce(p.valor_brl, 0))
      from posicao_carteira() p
     where p_bolsos is null or p.bolso_id = any (p_bolsos)
  )
  select * from hist
  union all select * from depois
  union all select * from hoje;
$$;

-- Taxa interna de retorno anual de uma série de fluxos (por bisseção).
create function public.taxa_interna(p_datas date[], p_valores numeric[])
returns numeric
language plpgsql
immutable
as $$
declare
  v_lo  float8 := -0.99;
  v_hi  float8 := 10;
  v_mid float8;
  v_d0  date := (select min(d) from unnest(p_datas) d);
  function_val float8;
  i     int;
begin
  if array_length(p_datas, 1) is null or array_length(p_datas, 1) < 2 then
    return null;
  end if;
  for k in 1 .. 200 loop
    v_mid := (v_lo + v_hi) / 2;
    function_val := 0;
    for i in 1 .. array_length(p_datas, 1) loop
      function_val := function_val + p_valores[i]::float8 / power(1 + v_mid, (p_datas[i] - v_d0) / 365.0);
    end loop;
    -- O valor presente cai com a taxa quando os aportes vêm antes dos resgates.
    if function_val > 0 then v_lo := v_mid; else v_hi := v_mid; end if;
    exit when v_hi - v_lo < 1e-9;
  end loop;
  return round(v_mid::numeric, 6);
end;
$$;

-- Rentabilidade desde o primeiro aporte, nominal e real (IPCA), dos bolsos pedidos.
create function public.rentabilidade_investimentos(p_bolsos bigint[] default null)
returns table (
  inicio          date,
  aportado        numeric,
  retirado        numeric,
  proventos       numeric,
  valor_atual     numeric,
  ganho           numeric,
  taxa_nominal    numeric,
  taxa_real       numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with f as (select * from fluxos_investimento(p_bolsos)),
  prov as (
    select coalesce(sum(h.valor_brl), 0) as v
      from historico_investimento h
     where h.tipo = 'provento' and (p_bolsos is null or h.bolso_id = any (p_bolsos))
       and h.data < (select coalesce(min(m.data), current_date) from movimentacao m where m.tipo = 'posicao_inicial')
  ),
  provd as (
    select coalesce(sum(m.valor_brl), 0) as v
      from movimentacao m join ativo a on a.id = m.ativo_id
     where m.tipo = 'provento' and (p_bolsos is null or a.bolso_id = any (p_bolsos))
  ),
  hoje as (select valor from f where data = current_date order by valor desc limit 1)
  select
    (select min(data) from f where valor < 0),
    (select -sum(valor) from f where valor < 0),
    (select sum(valor) from f where valor > 0 and data < current_date) - (select v from prov) - (select v from provd),
    (select v from prov) + (select v from provd),
    (select valor from hoje),
    (select sum(valor) from f),
    taxa_interna((select array_agg(data order by data) from f), (select array_agg(valor order by data) from f)),
    taxa_interna((select array_agg(data order by data) from f),
                 (select array_agg(valor * fator_ipca(data) order by data) from f));
$$;

-- 4. Objetivo: quanto falta e quanto aportar por mês ----------------------------------
-- Alvo = renda mensal × 12 ÷ taxa de retirada, em reais de hoje. Aporte necessário
-- (reais de hoje, no início de cada mês) até a data alvo, pela taxa real premissa
-- e, como checagem, pela taxa real realizada.
create function public.objetivo_situacao()
returns table (
  objetivo_id          bigint,
  nome                 text,
  renda_mensal_alvo    numeric,
  taxa_retirada_anual  numeric,
  taxa_real_anual      numeric,
  data_alvo            date,
  bolsos               text,
  alvo                 numeric,
  valor_atual          numeric,
  progresso            numeric,
  meses                int,
  aporte_premissa      numeric,
  taxa_real_realizada  numeric,
  aporte_realizada     numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  o       record;
  v_ids   bigint[];
  v_valor numeric;
  v_alvo  numeric;
  v_n     int;
  v_real  numeric;
begin
  for o in select * from objetivo order by id loop
    select array_agg(ob.bolso_id), string_agg(b.nome, ', ' order by b.id)
      into v_ids, bolsos
      from objetivo_bolso ob join bolso b on b.id = ob.bolso_id where ob.objetivo_id = o.id;
    select coalesce(sum(p.valor_brl), 0) into v_valor from posicao_carteira() p where p.bolso_id = any (v_ids);
    v_alvo := o.renda_mensal_alvo * 12 / o.taxa_retirada_anual;
    v_n := greatest((extract(year from age(date_trunc('month', o.data_alvo), date_trunc('month', current_date))) * 12
                   + extract(month from age(date_trunc('month', o.data_alvo), date_trunc('month', current_date))))::int, 0);
    select r.taxa_real into v_real from rentabilidade_investimentos(v_ids) r;

    objetivo_id := o.id; nome := o.nome; renda_mensal_alvo := o.renda_mensal_alvo;
    taxa_retirada_anual := o.taxa_retirada_anual; taxa_real_anual := o.taxa_real_anual; data_alvo := o.data_alvo;
    alvo := round(v_alvo, 2); valor_atual := v_valor; progresso := round(v_valor / v_alvo, 6); meses := v_n;
    aporte_premissa := round(aporte_mensal(v_alvo, v_valor, v_n, power(1 + o.taxa_real_anual, 1.0 / 12) - 1), 2);
    taxa_real_realizada := v_real;
    aporte_realizada := case when v_real is null then null
                             else round(aporte_mensal(v_alvo, v_valor, v_n, power(1 + v_real, 1.0 / 12) - 1), 2) end;
    return next;
  end loop;
end;
$$;

-- PMT com pagamento no início do mês (como nos projetos).
create function public.aporte_mensal(p_alvo numeric, p_atual numeric, p_meses int, p_taxa numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_meses <= 0 then greatest(p_alvo - p_atual, 0)
    when p_taxa = 0 then greatest((p_alvo - p_atual) / p_meses, 0)
    else greatest((p_alvo - p_atual * power(1 + p_taxa, p_meses)) * p_taxa
                  / ((power(1 + p_taxa, p_meses) - 1) * (1 + p_taxa)), 0)
  end;
$$;

-- Liga e desliga bolsos de um objetivo de uma vez.
create function public.definir_bolsos_objetivo(p_objetivo_id bigint, p_bolsos bigint[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from objetivo_bolso where objetivo_id = p_objetivo_id;
  insert into objetivo_bolso (objetivo_id, bolso_id) select p_objetivo_id, unnest(p_bolsos);
end;
$$;

revoke execute on function public.fator_ipca(date)                              from public, anon;
revoke execute on function public.fluxos_investimento(bigint[])                 from public, anon;
revoke execute on function public.taxa_interna(date[], numeric[])               from public, anon;
revoke execute on function public.rentabilidade_investimentos(bigint[])         from public, anon;
revoke execute on function public.objetivo_situacao()                           from public, anon;
revoke execute on function public.aporte_mensal(numeric, numeric, int, numeric) from public, anon;
revoke execute on function public.definir_bolsos_objetivo(bigint, bigint[])     from public, anon;
grant execute on function public.fator_ipca(date)                              to authenticated;
grant execute on function public.fluxos_investimento(bigint[])                 to authenticated;
grant execute on function public.taxa_interna(date[], numeric[])               to authenticated;
grant execute on function public.rentabilidade_investimentos(bigint[])         to authenticated;
grant execute on function public.objetivo_situacao()                           to authenticated;
grant execute on function public.aporte_mensal(numeric, numeric, int, numeric) to authenticated;
grant execute on function public.definir_bolsos_objetivo(bigint, bigint[])     to authenticated;

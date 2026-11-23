-- Carteira (fase 4, primeira entrega). Plano em docs/06-fases-2-a-5.md.
--
-- Peso real × meta e sugestão de aporte. A carteira parte da posição de
-- 13/11/2026 do MyProfit (movimentação "posicao_inicial", com o custo total);
-- daí em diante, compras, vendas, proventos e ajustes são lançados no app.
-- Preço por ativo (na moeda dele) e câmbio USD/BRL: o preço é atualizado à mão,
-- o câmbio vem do Banco Central (série SGS 1).
--
-- Metas (briefing, seção 6): peso de cada bloco na carteira principal e peso de
-- cada ativo dentro do bloco; peso na carteira = peso do bloco × peso no bloco,
-- normalizado dentro do bloco.

-- Previdência é um bolso à parte (13/11/2026): nem carteira principal nem satélite,
-- mas conta na poupança. As contribuições de 2026 que tinham ido para a carteira
-- principal (descrição com "prev") passam para ele.
alter table public.bolso drop constraint bolso_tipo_check;
alter table public.bolso add constraint bolso_tipo_check
  check (tipo in ('carteira_principal', 'carteira_satelite', 'reserva', 'projeto', 'amortizacao', 'previdencia'));
insert into public.bolso (nome, tipo, conta_na_poupanca) values ('Previdência', 'previdencia', true);
update public.transferencia t
   set bolso_id = (select id from public.bolso where tipo = 'previdencia')
 where t.bolso_id = (select id from public.bolso where tipo = 'carteira_principal' order by id limit 1)
   and public.normalizar(t.descricao) like '%prev%';

create table public.bloco (
  id            bigint generated always as identity primary key,
  nome          text not null unique,
  classe        text not null check (classe in ('rf', 'rv', 'reserva_valor')),
  regiao        text not null check (regiao in ('br', 'eua', 'global')),
  peso_meta     numeric(6,4) not null default 0 check (peso_meta between 0 and 1),
  ordem         int not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
select public.aplicar_acesso_padrao('bloco');

-- Pesos da carteira principal com x (RF Brasil) = 35%, como no briefing.
insert into public.bloco (nome, classe, regiao, peso_meta, ordem) values
  ('RF Brasil',        'rf',            'br',     0.35, 1),
  ('RV Brasil',        'rv',            'br',     0.10, 2),
  ('RF EUA',           'rf',            'eua',    0.10, 3),
  ('RV EUA',           'rv',            'eua',    0.40, 4),
  ('Reserva de valor', 'reserva_valor', 'global', 0.05, 5);

create table public.ativo (
  id             bigint generated always as identity primary key,
  ticker         text not null unique,
  nome           text,
  grupo          text,                                    -- como no MyProfit (Ações, ETF USA, Tesouro Direto…)
  moeda          text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  bolso_id       bigint not null references public.bolso (id),
  bloco_id       bigint references public.bloco (id),      -- só na carteira principal
  peso_no_bloco  numeric(6,4) check (peso_no_bloco is null or peso_no_bloco >= 0),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
select public.aplicar_acesso_padrao('ativo');

-- Uma operação com um ativo. Quantidade sempre positiva; o sentido vem do tipo.
--   posicao_inicial  quantidade e custo total no ponto de partida
--   compra / venda   quantidade e valor total em reais (com taxas)
--   provento         valor recebido em reais (quantidade 0)
--   ajuste           desdobramento, bonificação, agrupamento: quantidade com sinal, valor 0
create table public.movimentacao (
  id            bigint generated always as identity primary key,
  data          date not null,
  ativo_id      bigint not null references public.ativo (id),
  tipo          text not null check (tipo in ('posicao_inicial', 'compra', 'venda', 'provento', 'ajuste')),
  quantidade    numeric(20,8) not null default 0,
  valor_brl     numeric(14,2) not null default 0,
  origem        text not null default 'manual' check (origem in ('manual', 'myprofit')),
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (tipo = 'ajuste' or quantidade >= 0),
  check (valor_brl >= 0)
);
create index movimentacao_ativo_idx on public.movimentacao (ativo_id, data);
select public.aplicar_acesso_padrao('movimentacao');

create table public.cotacao (
  ativo_id      bigint not null references public.ativo (id) on delete cascade,
  data          date not null,
  preco         numeric(20,8) not null check (preco > 0),   -- na moeda do ativo
  fonte         text not null default 'manual',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (ativo_id, data)
);
select public.aplicar_acesso_padrao('cotacao');

create table public.cambio (
  data          date primary key,
  usd_brl       numeric(12,6) not null check (usd_brl > 0),
  fonte         text not null default 'bcb',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
select public.aplicar_acesso_padrao('cambio');

-- Posição de cada ativo numa data: quantidade, custo (preço médio), preço, valor.
-- O custo segue o preço médio: compra soma; venda tira a parte proporcional.
create function public.posicao_carteira(p_em date default current_date)
returns table (
  ativo_id        bigint,
  ticker          text,
  nome            text,
  grupo           text,
  moeda           text,
  bolso_id        bigint,
  bolso           text,
  bloco_id        bigint,
  bloco           text,
  peso_no_bloco   numeric,
  quantidade      numeric,
  custo_brl       numeric,
  proventos_brl   numeric,
  preco           numeric,
  preco_em        date,
  cambio          numeric,
  valor_brl       numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  a      record;
  m      record;
  v_q    numeric;
  v_c    numeric;
  v_prov numeric;
  v_usd  numeric := (select c.usd_brl from cambio c where c.data <= p_em order by c.data desc limit 1);
begin
  for a in
    select x.*, b.nome as bolso_nome, k.nome as bloco_nome
      from ativo x
      join bolso b on b.id = x.bolso_id
      left join bloco k on k.id = x.bloco_id
     order by b.id, k.ordem nulls last, x.ticker
  loop
    v_q := 0; v_c := 0; v_prov := 0;
    for m in select * from movimentacao mv where mv.ativo_id = a.id and mv.data <= p_em order by mv.data, mv.id loop
      case m.tipo
        when 'posicao_inicial', 'compra' then
          v_q := v_q + m.quantidade; v_c := v_c + m.valor_brl;
        when 'venda' then
          if v_q > 0 then v_c := v_c - v_c * least(m.quantidade / v_q, 1); end if;
          v_q := v_q - m.quantidade;
        when 'ajuste' then
          v_q := v_q + m.quantidade;
        when 'provento' then
          v_prov := v_prov + m.valor_brl;
      end case;
    end loop;

    ativo_id := a.id; ticker := a.ticker; nome := a.nome; grupo := a.grupo; moeda := a.moeda;
    bolso_id := a.bolso_id; bolso := a.bolso_nome; bloco_id := a.bloco_id; bloco := a.bloco_nome;
    peso_no_bloco := a.peso_no_bloco;
    quantidade := round(v_q, 8); custo_brl := round(v_c, 2); proventos_brl := round(v_prov, 2);
    select c.preco, c.data into preco, preco_em
      from cotacao c where c.ativo_id = a.id and c.data <= p_em order by c.data desc limit 1;
    cambio := case when a.moeda = 'USD' then v_usd end;
    valor_brl := round(v_q * preco * case when a.moeda = 'USD' then v_usd else 1 end, 2);
    continue when not a.ativo and v_q = 0;
    return next;
  end loop;
end;
$$;

-- Peso real × meta numa carteira (por padrão, a principal). A meta de cada ativo é
-- o peso do bloco × o peso dele no bloco, dividido pela soma dos pesos do bloco.
create function public.alocacao_carteira(p_bolso_id bigint default null)
returns table (
  ativo_id    bigint,
  ticker      text,
  nome        text,
  moeda       text,
  bloco_id    bigint,
  bloco       text,
  bloco_ordem int,
  quantidade  numeric,
  preco       numeric,
  preco_em    date,
  valor_brl   numeric,
  custo_brl   numeric,
  peso_real   numeric,
  peso_meta   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with alvo as (
    select coalesce(p_bolso_id, (select id from bolso where tipo = 'carteira_principal' order by id limit 1)) as id
  ),
  pos as (
    select p.* from posicao_carteira() p, alvo where p.bolso_id = alvo.id
  ),
  soma_bloco as (
    select bloco_id, sum(coalesce(peso_no_bloco, 0)) as s from pos where bloco_id is not null group by bloco_id
  ),
  total as (select nullif(sum(coalesce(valor_brl, 0)), 0) as t from pos)
  select p.ativo_id, p.ticker, p.nome, p.moeda, p.bloco_id, p.bloco, k.ordem,
         p.quantidade, p.preco, p.preco_em, p.valor_brl, p.custo_brl,
         round(coalesce(p.valor_brl, 0) / (select t from total), 6),
         round(case when sb.s > 0 then k.peso_meta * coalesce(p.peso_no_bloco, 0) / sb.s else 0 end, 6)
    from pos p
    left join bloco k on k.id = p.bloco_id
    left join soma_bloco sb on sb.bloco_id = p.bloco_id
   order by k.ordem nulls last, p.ticker;
$$;

-- Onde pôr um aporte sem vender nada: cada ativo recebe na proporção do que falta
-- para ele chegar à meta depois do aporte (total novo = atual + aporte).
create function public.sugestao_aporte(p_valor numeric, p_bolso_id bigint default null)
returns table (ativo_id bigint, ticker text, bloco text, moeda text, valor_atual numeric, alvo_brl numeric,
               sugerido_brl numeric, quantidade_aprox numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select * from alocacao_carteira(p_bolso_id)),
  t as (select coalesce(sum(coalesce(valor_brl, 0)), 0) + p_valor as novo from a),
  d as (
    select a.*, t.novo * a.peso_meta as alvo,
           greatest(t.novo * a.peso_meta - coalesce(a.valor_brl, 0), 0) as deficit
      from a, t where a.peso_meta > 0
  ),
  s as (select nullif(sum(deficit), 0) as soma from d),
  cam as (select usd_brl from cambio order by data desc limit 1)
  select d.ativo_id, d.ticker, d.bloco, d.moeda, coalesce(d.valor_brl, 0), round(d.alvo, 2),
         round(p_valor * d.deficit / s.soma, 2),
         case when d.preco is null then null
              else round(p_valor * d.deficit / s.soma
                         / (d.preco * case when d.moeda = 'USD' then (select usd_brl from cam) else 1 end), 4) end
    from d, s
   where s.soma is not null and d.deficit > 0
   order by d.deficit desc;
$$;

-- Grava preços de vários ativos numa data e, se vier, o câmbio.
create function public.gravar_cotacoes(p_valores jsonb, p_data date default current_date, p_usd_brl numeric default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into cotacao (ativo_id, data, preco, fonte)
  select (e ->> 'ativo_id')::bigint, p_data, (e ->> 'preco')::numeric, 'manual'
    from jsonb_array_elements(coalesce(p_valores, '[]'::jsonb)) e
   where (e ->> 'preco')::numeric > 0
  on conflict (ativo_id, data) do update set preco = excluded.preco, fonte = excluded.fonte;
  if p_usd_brl is not null then
    insert into cambio (data, usd_brl, fonte) values (p_data, p_usd_brl, 'manual')
    on conflict (data) do update set usd_brl = excluded.usd_brl, fonte = excluded.fonte;
  end if;
end;
$$;

-- Câmbio do Banco Central (o app busca a série SGS 1). Não sobrescreve um câmbio digitado.
create function public.gravar_cambio(p_valores jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int;
begin
  insert into cambio (data, usd_brl, fonte)
  select (e ->> 'data')::date, (e ->> 'valor')::numeric, 'bcb'
    from jsonb_array_elements(p_valores) e
  on conflict (data) do update set usd_brl = excluded.usd_brl where cambio.fonte = 'bcb';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.posicao_carteira(date)                    from public, anon;
revoke execute on function public.alocacao_carteira(bigint)                 from public, anon;
revoke execute on function public.sugestao_aporte(numeric, bigint)          from public, anon;
revoke execute on function public.gravar_cotacoes(jsonb, date, numeric)     from public, anon;
revoke execute on function public.gravar_cambio(jsonb)                      from public, anon;
grant execute on function public.posicao_carteira(date)                    to authenticated;
grant execute on function public.alocacao_carteira(bigint)                 to authenticated;
grant execute on function public.sugestao_aporte(numeric, bigint)          to authenticated;
grant execute on function public.gravar_cotacoes(jsonb, date, numeric)     to authenticated;
grant execute on function public.gravar_cambio(jsonb)                      to authenticated;

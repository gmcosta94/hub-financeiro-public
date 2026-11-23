-- Cadastros: categorias, itens, contas, cenários, projetos e bolsos.

-- Dois níveis: grupo (pai_id nulo) -> categoria. Lançamento aponta para categoria.
create table public.categoria (
  id                 bigint generated always as identity primary key,
  pai_id             bigint references public.categoria (id),
  nome               text not null,
  natureza           text not null check (natureza in ('receita', 'despesa')),
  -- Para onde a renda vai: define em que bloco do orçamento a categoria aparece.
  destino            text not null check (destino in ('receita', 'gasto_do_mes', 'metas', 'investimentos')),
  custo_de_vida      boolean not null default false,
  ordem              int not null default 0,
  ativa              boolean not null default true,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (pai_id, nome)
);

-- Agrupamento opcional de itens dentro de uma categoria ("Streamings").
-- Ninguém escolhe subcategoria ao lançar: ela vem do item.
create table public.subcategoria (
  id             bigint generated always as identity primary key,
  categoria_id   bigint not null references public.categoria (id),
  nome           text not null,
  ordem          int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (categoria_id, nome)
);

-- A descrição normalizada de um gasto ou a fonte de uma renda
-- ("Pão de Açúcar", "Netflix", "Empresa A"). Pertence a uma categoria.
create table public.item (
  id               bigint generated always as identity primary key,
  categoria_id     bigint not null references public.categoria (id),
  subcategoria_id  bigint references public.subcategoria (id),
  nome             text not null,
  nome_norm        text not null,          -- normalizar(nome), preenchido por trigger
  usos             int not null default 0, -- ordena as sugestões
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (categoria_id, nome_norm)
);

create function public.item_preencher_norm()
returns trigger
language plpgsql
as $$
begin
  new.nome_norm := public.normalizar(new.nome);
  return new;
end;
$$;

create trigger item_norm
  before insert or update of nome on public.item
  for each row execute function public.item_preencher_norm();

create table public.conta (
  id                     bigint generated always as identity primary key,
  nome                   text not null unique,
  tipo                   text not null check (tipo in ('corrente', 'cartao', 'corretora', 'reserva', 'cripto')),
  moeda                  text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  dia_fechamento_padrao  int check (dia_fechamento_padrao between 1 and 31),  -- só cartão
  dia_vencimento         int check (dia_vencimento between 1 and 31),         -- só cartão
  conta_pagamento_id     bigint references public.conta (id),                 -- de onde a fatura é paga
  ativa                  boolean not null default true,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);

-- Cenários de orçamento: Ideal, Reduzido, Mínimo, Economia.
create table public.cenario (
  id             bigint generated always as identity primary key,
  nome           text not null unique,
  ordem          int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Projetos Futuros de Metas: dinheiro guardado para gastar (viagem, carro...).
-- Alvo em reais de hoje e taxa real (acima da inflação).
create table public.projeto (
  id                bigint generated always as identity primary key,
  nome              text not null unique,
  valor_alvo        numeric(14,2) not null check (valor_alvo > 0),
  saldo_inicial     numeric(14,2) not null default 0,
  horizonte         text not null check (horizonte in ('curto', 'medio', 'longo')),
  inicio            date not null,
  fim               date not null check (fim > inicio),
  taxa_real_mensal  numeric(8,6) not null default 0,
  conta_id          bigint references public.conta (id),
  status            text not null default 'ativo' check (status in ('ativo', 'realizado', 'cancelado')),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- Todo dinheiro guardado pertence a exatamente um bolso.
create table public.bolso (
  id             bigint generated always as identity primary key,
  nome           text not null unique,
  tipo           text not null check (tipo in ('carteira_principal', 'carteira_satelite', 'reserva', 'projeto', 'amortizacao')),
  projeto_id     bigint unique references public.projeto (id),
  -- Aporte neste bolso conta na taxa de poupança? Projetos não contam.
  conta_na_poupanca boolean not null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check ((tipo = 'projeto') = (projeto_id is not null))
);

-- Padrão de texto -> item (e, pelo item, a categoria).
create table public.regra_categorizacao (
  id             bigint generated always as identity primary key,
  padrao         text not null,   -- já normalizado
  tipo_match     text not null default 'exato' check (tipo_match in ('exato', 'contem', 'prefixo')),
  item_id        bigint not null references public.item (id) on delete cascade,
  prioridade     int not null default 0,
  origem         text not null check (origem in ('historico', 'correcao', 'manual')),
  acertos        int not null default 0,
  erros          int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (padrao, tipo_match)
);

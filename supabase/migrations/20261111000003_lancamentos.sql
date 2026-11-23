-- Lançamentos, faturas, parcelas, recorrentes, importações e transferências.
--
-- Convenções:
--   * valor de lançamento é positivo para despesa e para receita (a natureza
--     vem da categoria); estorno/devolução é negativo na mesma categoria.
--   * competencia é sempre o dia 1 do mês de orçamento.
--   * aporte, resgate e pagamento de fatura são transferência, não lançamento.

-- Uma fatura por cartão e mês. A competência é o mês em que ela fecha.
create table public.fatura (
  id               bigint generated always as identity primary key,
  conta_id         bigint not null references public.conta (id),
  competencia      date not null check (extract(day from competencia) = 1),
  data_fechamento  date,
  data_vencimento  date,
  status           text not null default 'aberta' check (status in ('aberta', 'fechada', 'conferida', 'paga')),
  total_pdf        numeric(14,2),   -- total lido do PDF, para bater com a soma
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (conta_id, competencia)
);

-- Uma compra parcelada gera N lançamentos.
create table public.compra_parcelada (
  id                    bigint generated always as identity primary key,
  descricao             text not null,
  item_id               bigint references public.item (id),
  categoria_id          bigint not null references public.categoria (id),
  conta_id              bigint not null references public.conta (id),
  valor_total           numeric(14,2) not null,
  n_parcelas            int not null check (n_parcelas >= 2),
  data_compra           date,
  primeira_competencia  date not null check (extract(day from primeira_competencia) = 1),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

-- Modelo de lançamento que se repete (condomínio, luz, assinaturas).
create table public.recorrencia (
  id              bigint generated always as identity primary key,
  descricao       text not null,
  item_id         bigint references public.item (id),
  categoria_id    bigint not null references public.categoria (id),
  conta_id        bigint not null references public.conta (id),
  valor_estimado  numeric(14,2) not null,
  dia_previsto    int check (dia_previsto between 1 and 31),
  periodicidade   text not null default 'mensal' check (periodicidade in ('mensal', 'anual')),
  inicio          date not null,
  fim             date,
  ativa           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

create table public.lancamento (
  id                   bigint generated always as identity primary key,
  data                 date not null,                -- data real da compra ou do recebimento
  competencia          date not null check (extract(day from competencia) = 1),
  valor                numeric(14,2) not null check (valor <> 0),
  conta_id             bigint not null references public.conta (id),
  fatura_id            bigint references public.fatura (id),
  categoria_id         bigint references public.categoria (id),   -- nula só enquanto pendente
  item_id              bigint references public.item (id),
  descricao_original   text,
  origem_input         text not null check (origem_input in ('manual', 'atalho', 'recorrente', 'parcela', 'fatura_pdf', 'migracao')),
  -- pendente = caixa de entrada: aguardando revisão.
  status               text not null default 'confirmado' check (status in ('pendente', 'confirmado')),
  conciliado           boolean not null default false,            -- bateu com a fatura
  compra_parcelada_id  bigint references public.compra_parcelada (id) on delete cascade,
  parcela_numero       int,
  recorrencia_id       bigint references public.recorrencia (id),
  projeto_id           bigint references public.projeto (id),     -- gasto ligado a um projeto
  -- true = pago com saldo do projeto: baixa o projeto e não conta de novo no mês.
  pago_com_projeto     boolean not null default false,
  chave_dedup          text,
  observacao           text,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  check (status = 'pendente' or categoria_id is not null),
  check (not pago_com_projeto or projeto_id is not null)
);

create index lancamento_competencia_idx on public.lancamento (competencia, categoria_id);
create index lancamento_fatura_idx      on public.lancamento (fatura_id);
create index lancamento_item_idx        on public.lancamento (item_id);
-- Barra a mesma linha importada duas vezes.
create unique index lancamento_dedup_idx on public.lancamento (chave_dedup) where chave_dedup is not null;

-- Uma leitura de fatura (PDF ou texto colado). O arquivo não é guardado.
create table public.importacao (
  id             bigint generated always as identity primary key,
  fatura_id      bigint not null references public.fatura (id),
  tipo           text not null check (tipo in ('pdf', 'texto')),
  hash_arquivo   text,
  linhas_lidas   int not null default 0,
  conciliadas    int not null default 0,
  novas          int not null default 0,
  divergentes    int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table public.importacao_linha (
  id             bigint generated always as identity primary key,
  importacao_id  bigint not null references public.importacao (id) on delete cascade,
  data           date,
  descricao      text,
  valor          numeric(14,2),
  parcela_txt    text,
  resultado      text check (resultado in ('bateu', 'nova', 'divergente', 'ignorada')),
  lancamento_id  bigint references public.lancamento (id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Dinheiro que muda de lugar sem ser gasto nem renda.
-- valor é sempre positivo; o sentido vem do tipo.
create table public.transferencia (
  id                bigint generated always as identity primary key,
  data              date not null,
  competencia       date not null check (extract(day from competencia) = 1),
  valor             numeric(14,2) not null check (valor > 0),
  tipo              text not null check (tipo in ('aporte', 'resgate', 'pagamento_fatura', 'amortizacao', 'entre_contas')),
  conta_origem_id   bigint references public.conta (id),
  conta_destino_id  bigint references public.conta (id),
  bolso_id          bigint references public.bolso (id),   -- destino do aporte / origem do resgate
  fatura_id         bigint references public.fatura (id),
  descricao         text,
  origem_input      text not null default 'manual' check (origem_input in ('manual', 'recorrente', 'migracao')),
  chave_dedup       text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index transferencia_competencia_idx on public.transferencia (competencia, tipo);
create unique index transferencia_dedup_idx on public.transferencia (chave_dedup) where chave_dedup is not null;

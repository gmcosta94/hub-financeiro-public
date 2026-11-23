-- Projetos (fase 3). Plano em docs/06-fases-2-a-5.md.
--
-- Por projeto: alvo, já separado (saldo estimado pelo CDI), já gasto, quanto
-- falta e o aporte mensal necessário até a data final. O dinheiro fica em
-- cofrinhos a 100% do CDI (ou outro percentual); o alvo é nominal.
--
-- Saldo estimado = saldo de partida corrigido pelo CDI
--                + aportes − resgates, cada um corrigido desde a sua data
--                − gastos pagos com o dinheiro do projeto, idem.
-- "Corrigir saldo" troca o saldo de partida pelo saldo real do banco numa data;
-- o que veio antes deixa de entrar na conta. No próprio dia, conta o que foi
-- registrado depois do momento em que o saldo de partida foi definido
-- (saldo_definido_em): o saldo do banco já inclui o que veio antes.

-- 1. Série do CDI e parâmetros --------------------------------------------------
create table public.indice (
  nome          text not null,
  competencia   date not null check (extract(day from competencia) = 1),
  valor         numeric(10,6) not null,          -- % no mês: 1.07 = 1,07%
  fonte         text not null default 'bcb',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (nome, competencia)
);
select public.aplicar_acesso_padrao('indice');

create table public.parametro (
  chave         text primary key,
  valor         numeric,
  descricao     text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
select public.aplicar_acesso_padrao('parametro');

insert into public.parametro (chave, valor, descricao) values
  ('cdi_mensal_projetado', null,
   'CDI ao mês (%) usado no mês corrente e no futuro. Vazio: o último mês fechado da série.');

-- Grava meses da série (o app busca no Banco Central, série SGS 4391). Só meses fechados.
create function public.gravar_indice(p_nome text, p_valores jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int;
begin
  insert into indice (nome, competencia, valor, fonte)
  select p_nome, date_trunc('month', (e ->> 'competencia')::date)::date, (e ->> 'valor')::numeric,
         coalesce(e ->> 'fonte', 'bcb')
    from jsonb_array_elements(p_valores) e
   where (e ->> 'competencia')::date < date_trunc('month', current_date)
  on conflict (nome, competencia) do update set valor = excluded.valor, fonte = excluded.fonte;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- CDI ao mês (%) para o mês corrente e o futuro.
create function public.cdi_mensal_projetado()
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select valor from parametro where chave = 'cdi_mensal_projetado'),
    (select valor from indice
      where nome = 'CDI' and competencia < date_trunc('month', current_date)
      order by competencia desc limit 1),
    1.0);
$$;

-- Quanto 1 real rende de p_de até p_ate a p_pct do CDI. Meses fechados usam a
-- série; o mês corrente e o futuro, o CDI projetado. Mês incompleto entra pela
-- fração de dias.
create function public.fator_cdi(p_de date, p_ate date, p_pct numeric default 1)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(exp(sum(ln(1 + x.taxa / 100 * p_pct) * x.frac)), 1)
    from (
      select coalesce(i.valor, cdi_mensal_projetado()) as taxa,
             (least(p_ate, (g.m + interval '1 month')::date) - greatest(p_de, g.m))::numeric
               / ((g.m + interval '1 month')::date - g.m) as frac
        from (select d::date as m
                from generate_series(date_trunc('month', p_de), date_trunc('month', p_ate), interval '1 month') d) g
        left join indice i
          on i.nome = 'CDI' and i.competencia = g.m and g.m < date_trunc('month', current_date)
    ) x
   where p_ate > p_de and x.frac > 0;
$$;

-- 2. Projeto: rende um percentual do CDI; horizonte passa a ser calculado ----------
alter table public.projeto drop constraint projeto_horizonte_check;
alter table public.projeto drop column horizonte;
alter table public.projeto drop column taxa_real_mensal;
alter table public.projeto add column pct_cdi numeric(6,4) not null default 1 check (pct_cdi > 0);
alter table public.projeto add column saldo_inicial_em date;
update public.projeto set saldo_inicial_em = inicio;
alter table public.projeto alter column saldo_inicial_em set not null;
alter table public.projeto alter column saldo_inicial_em set default current_date;
alter table public.projeto add column saldo_definido_em timestamptz not null default now();

-- Uma operação (aporte, resgate, gasto pago com o projeto) entra no saldo estimado
-- se é de depois do dia do saldo de partida, ou do mesmo dia e registrada depois dele.
create function public.depois_do_saldo(p_data date, p_registrado timestamptz, p_saldo_em date, p_definido timestamptz)
returns boolean
language sql
immutable
as $$
  select p_data > p_saldo_em or (p_data = p_saldo_em and p_registrado > p_definido);
$$;

-- A Reserva de Emergência também tem alvo e prazo: o bolso dela pode apontar para
-- um projeto, mas continua contando na poupança (não em Metas).
alter table public.bolso drop constraint bolso_check;
alter table public.bolso add constraint bolso_projeto_check
  check ((tipo <> 'projeto' or projeto_id is not null) and (projeto_id is null or tipo in ('projeto', 'reserva')));

-- 3. Situação de cada projeto ----------------------------------------------------
-- Aporte necessário: como na planilha, PMT com pagamento no início do mês, sobre
-- o saldo atual, até o mês final (meses = DATEDIF). Diferença da planilha: o prazo
-- conta a partir do maior entre o mês atual e o início, e um saldo existente rende
-- até o início.
create function public.projetos_situacao(p_em date default current_date)
returns table (
  projeto_id          bigint,
  nome                text,
  status              text,
  bolso_id            bigint,
  conta_na_poupanca   boolean,
  valor_alvo          numeric,
  inicio              date,
  fim                 date,
  pct_cdi             numeric,
  saldo_inicial       numeric,
  saldo_inicial_em    date,
  saldo               numeric,
  aportado            numeric,
  rendimento          numeric,
  gasto               numeric,
  gasto_com_projeto   numeric,
  falta               numeric,
  taxa_mensal         numeric,
  meses_restantes     int,
  aporte_necessario   numeric,
  horizonte           text
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select p.*, b.id as bolso_id, b.conta_na_poupanca,
           cdi_mensal_projetado() / 100 * p.pct_cdi as r,
           date_trunc('month', p_em)::date as mes
      from projeto p
      join bolso b on b.projeto_id = p.id
  ),
  mov as (
    select b.id,
           sum(case t.tipo when 'resgate' then -t.valor else t.valor end) as liquido,
           sum(case t.tipo when 'resgate' then -t.valor else t.valor end * fator_cdi(t.data, p_em, b.pct_cdi)) as corrigido
      from base b
      join transferencia t on t.bolso_id = b.bolso_id
     where t.tipo in ('aporte', 'resgate') and t.data <= p_em
       and depois_do_saldo(t.data, t.criado_em, b.saldo_inicial_em, b.saldo_definido_em)
     group by b.id
  ),
  gas as (
    select b.id,
           sum(l.valor) as gasto,
           sum(l.valor) filter (where l.pago_com_projeto) as gasto_com_projeto,
           sum(l.valor) filter (where l.pago_com_projeto and l.data <= p_em
             and depois_do_saldo(l.data, l.criado_em, b.saldo_inicial_em, b.saldo_definido_em)) as desde_base,
           sum(l.valor * fator_cdi(l.data, p_em, b.pct_cdi)) filter (where l.pago_com_projeto and l.data <= p_em
             and depois_do_saldo(l.data, l.criado_em, b.saldo_inicial_em, b.saldo_definido_em)) as desde_base_corrigido
      from base b
      join lancamento l on l.projeto_id = b.id
     where l.status = 'confirmado'
     group by b.id
  ),
  s as (
    select b.*,
           round(b.saldo_inicial * fator_cdi(b.saldo_inicial_em, p_em, b.pct_cdi)
                 + coalesce(m.corrigido, 0) - coalesce(g.desde_base_corrigido, 0), 2) as saldo_est,
           b.saldo_inicial + coalesce(m.liquido, 0) - coalesce(g.desde_base, 0) as aportado_liq,
           coalesce(g.gasto, 0) as gasto_total,
           coalesce(g.gasto_com_projeto, 0) as gasto_cp,
           greatest(b.mes, date_trunc('month', b.inicio)::date) as mes_aporte
      from base b
      left join mov m on m.id = b.id
      left join gas g on g.id = b.id
  ),
  c as (
    select s.*,
           greatest((extract(year from age(date_trunc('month', s.fim), s.mes_aporte)) * 12
                   + extract(month from age(date_trunc('month', s.fim), s.mes_aporte)))::int, 0) as n,
           greatest((extract(year from age(s.mes_aporte, s.mes)) * 12
                   + extract(month from age(s.mes_aporte, s.mes)))::int, 0) as m0,
           (extract(year from age(date_trunc('month', s.fim), s.mes)) * 12
          + extract(month from age(date_trunc('month', s.fim), s.mes)))::int as ate_fim
      from s
  )
  select
    c.id, c.nome, c.status, c.bolso_id, c.conta_na_poupanca, c.valor_alvo, c.inicio, c.fim, c.pct_cdi,
    c.saldo_inicial, c.saldo_inicial_em,
    c.saldo_est,
    round(c.aportado_liq, 2),
    round(c.saldo_est - c.aportado_liq, 2),
    c.gasto_total,
    c.gasto_cp,
    greatest(round(c.valor_alvo - c.saldo_est - c.gasto_total, 2), 0),
    round(c.r, 6),
    c.n,
    round(case
      when c.status <> 'ativo' then 0
      when c.n <= 0 then greatest(c.valor_alvo - c.gasto_total - c.saldo_est, 0)
      when c.r = 0 then greatest((c.valor_alvo - c.gasto_total - c.saldo_est) / c.n, 0)
      else greatest((c.valor_alvo - c.gasto_total - c.saldo_est * power(1 + c.r, c.m0 + c.n)) * c.r
                    / ((power(1 + c.r, c.n) - 1) * (1 + c.r)), 0)
    end, 2),
    case when c.ate_fim <= 12 then 'curto' when c.ate_fim <= 36 then 'medio' else 'longo' end
  from c
  order by c.status <> 'ativo', c.fim, c.nome;
$$;

-- Aporte necessário mês a mês, para a projeção (como a aba Projetos da planilha).
-- Cada projeto ativo recebe o aporte do mês em que começa até o mês anterior ao final.
create function public.projecao_projetos(p_de date default current_date, p_meses int default 12)
returns table (projeto_id bigint, nome text, horizonte text, competencia date, aporte numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select s.projeto_id, s.nome, s.horizonte, g.m,
         case when g.m >= greatest(date_trunc('month', current_date), date_trunc('month', s.inicio))
               and g.m < date_trunc('month', s.fim)
              then s.aporte_necessario else 0 end
    from projetos_situacao() s
    cross join (select d::date as m
                  from generate_series(date_trunc('month', p_de),
                                       date_trunc('month', p_de) + (p_meses - 1) * interval '1 month',
                                       interval '1 month') d) g
   where s.status = 'ativo'
   order by s.fim, s.nome, g.m;
$$;

-- 4. Criar, editar, corrigir saldo --------------------------------------------------
-- Cria o projeto e o bolso dele. Para a Reserva de Emergência, passa o bolso que já existe.
create function public.criar_projeto(
  p_nome          text,
  p_valor_alvo    numeric,
  p_inicio        date,
  p_fim           date,
  p_saldo_inicial numeric default 0,
  p_pct_cdi       numeric default 1,
  p_bolso_id      bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into projeto (nome, valor_alvo, saldo_inicial, saldo_inicial_em, saldo_definido_em, inicio, fim, pct_cdi)
  values (trim(p_nome), p_valor_alvo, coalesce(p_saldo_inicial, 0), current_date, now(),
          date_trunc('month', p_inicio), date_trunc('month', p_fim), coalesce(p_pct_cdi, 1))
  returning id into v_id;

  if p_bolso_id is null then
    insert into bolso (nome, tipo, projeto_id, conta_na_poupanca) values (trim(p_nome), 'projeto', v_id, false);
  else
    update bolso set projeto_id = v_id where id = p_bolso_id and tipo = 'reserva' and projeto_id is null;
    if not found then
      raise exception 'Só a reserva de emergência pode virar um objetivo com prazo';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.editar_projeto(
  p_id         bigint,
  p_nome       text,
  p_valor_alvo numeric,
  p_inicio     date,
  p_fim        date,
  p_pct_cdi    numeric,
  p_status     text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update projeto
     set nome = trim(p_nome), valor_alvo = p_valor_alvo,
         inicio = date_trunc('month', p_inicio), fim = date_trunc('month', p_fim),
         pct_cdi = p_pct_cdi, status = p_status
   where id = p_id;
  if not found then
    raise exception 'Projeto não encontrado';
  end if;
  update bolso set nome = trim(p_nome) where projeto_id = p_id and tipo = 'projeto';
end;
$$;

-- O saldo real do cofrinho numa data vira o novo ponto de partida da estimativa.
create function public.corrigir_saldo_projeto(p_id bigint, p_saldo numeric, p_em date default current_date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update projeto set saldo_inicial = p_saldo, saldo_inicial_em = p_em, saldo_definido_em = now() where id = p_id;
  if not found then
    raise exception 'Projeto não encontrado';
  end if;
end;
$$;

-- Apaga um projeto de vez.
--   * gastos ligados a ele continuam lançados, sem o projeto; os que tinham sido
--     pagos com o dinheiro dele passam a contar no mês em que aconteceram;
--   * o que estava orçado para ele sai do orçamento;
--   * na Reserva de Emergência, só some o alvo e o prazo: o bolso e os aportes ficam;
--   * projeto com aportes ou resgates registrados não é apagado (seria apagar
--     histórico de dinheiro): apague-os antes ou marque o projeto como cancelado.
create function public.apagar_projeto(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_bolso bolso%rowtype;
begin
  if not exists (select 1 from projeto where id = p_id) then
    raise exception 'Projeto não encontrado';
  end if;
  select * into v_bolso from bolso where projeto_id = p_id;
  if v_bolso.tipo = 'projeto' and exists (select 1 from transferencia where bolso_id = v_bolso.id) then
    raise exception 'Este projeto tem aportes ou resgates registrados. Apague-os antes ou marque o projeto como cancelado.';
  end if;

  update lancamento set projeto_id = null, pago_com_projeto = false where projeto_id = p_id;
  if v_bolso.tipo = 'projeto' then
    delete from orcamento where bolso_id = v_bolso.id;
    delete from bolso where id = v_bolso.id;
  elsif v_bolso.id is not null then
    update bolso set projeto_id = null where id = v_bolso.id;
  end if;
  delete from projeto where id = p_id;
end;
$$;

-- 5. Lançar com projeto --------------------------------------------------------------
-- Gasto de projeto é um lançamento em Projetos Realizados (Metas) ligado ao projeto:
--   pago com o dinheiro do projeto -> baixa o saldo do projeto e não entra no mês;
--   pago com a renda do mês        -> entra no mês, em Metas, e conta como já gasto.
create function public.validar_projeto(p_categoria_id bigint, p_projeto_id bigint, p_pago boolean)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if coalesce(p_pago, false) and p_projeto_id is null then
    raise exception 'Escolha o projeto que pagou o gasto';
  end if;
  if p_projeto_id is not null and (select destino from categoria where id = p_categoria_id) is distinct from 'metas' then
    raise exception 'Só gastos de Projetos Realizados podem ser ligados a um projeto';
  end if;
end;
$$;

drop function public.lancar(numeric, bigint, text, bigint, date, date, text);
drop function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date, text);
drop function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date, text);

create function public.lancar(
  p_valor             numeric,
  p_categoria_id      bigint,
  p_descricao         text,
  p_conta_id          bigint,
  p_data              date default current_date,
  p_competencia       date default null,
  p_observacao        text default null,
  p_projeto_id        bigint default null,
  p_pago_com_projeto  boolean default false
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
  perform validar_projeto(p_categoria_id, p_projeto_id, p_pago_com_projeto);

  v_competencia := coalesce(date_trunc('month', p_competencia)::date,
                            competencia_de(p_conta_id, p_data));

  insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id,
                          item_id, descricao_original, origem_input, status, observacao,
                          projeto_id, pago_com_projeto)
  values (p_data, v_competencia, p_valor, p_conta_id, fatura_de(p_conta_id, v_competencia),
          p_categoria_id, item_de(p_categoria_id, p_descricao),
          nullif(trim(p_descricao), ''), 'manual', 'confirmado',
          nullif(trim(p_observacao), ''), p_projeto_id, coalesce(p_pago_com_projeto, false))
  returning id into v_id;

  return v_id;
end;
$$;

create function public.lancar_parcelado(
  p_valor_total          numeric,
  p_n_parcelas           int,
  p_categoria_id         bigint,
  p_descricao            text,
  p_conta_id             bigint,
  p_data                 date default current_date,
  p_primeira_competencia date default null,
  p_observacao           text default null,
  p_projeto_id           bigint default null,
  p_pago_com_projeto     boolean default false
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_descricao  text := nullif(trim(p_descricao), '');
  v_observacao text := nullif(trim(p_observacao), '');
  v_primeira   date;
  v_item_id    bigint;
  v_compra_id  bigint;
  v_parcela    numeric(14,2);
  v_comp       date;
begin
  if p_n_parcelas < 2 or p_n_parcelas > 48 then
    raise exception 'Número de parcelas inválido: %', p_n_parcelas;
  end if;
  perform validar_projeto(p_categoria_id, p_projeto_id, p_pago_com_projeto);

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
                            compra_parcelada_id, parcela_numero, observacao,
                            projeto_id, pago_com_projeto)
    values (case when k = 1 then p_data else v_comp end,
            v_comp,
            case when k = p_n_parcelas
                 then p_valor_total - v_parcela * (p_n_parcelas - 1)
                 else v_parcela end,
            p_conta_id, fatura_de(p_conta_id, v_comp), p_categoria_id, v_item_id,
            v_descricao, 'parcela', 'confirmado', v_compra_id, k, v_observacao,
            p_projeto_id, coalesce(p_pago_com_projeto, false));
  end loop;

  return v_compra_id;
end;
$$;

-- Igual à versão da migration 20261113000001, mais o projeto:
--   p_pago_com_projeto null -> mantém projeto e "pago com projeto" como estão
--   (quem chama sem esses campos não desfaz nada); se a categoria deixar de ser
--   de Metas, o vínculo com o projeto sai.
create function public.editar_lancamento(
  p_id                bigint,
  p_valor             numeric,
  p_categoria_id      bigint,
  p_descricao         text,
  p_conta_id          bigint,
  p_data              date,
  p_competencia       date default null,
  p_observacao        text default null,
  p_projeto_id        bigint default null,
  p_pago_com_projeto  boolean default null
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
  v_projeto     bigint;
  v_pago        boolean;
begin
  select * into v_atual from lancamento where id = p_id;
  if not found then
    raise exception 'Lançamento % não encontrado', p_id;
  end if;

  if p_pago_com_projeto is null then
    v_projeto := v_atual.projeto_id;
    v_pago    := v_atual.pago_com_projeto;
    if (select destino from categoria where id = p_categoria_id) is distinct from 'metas' then
      v_projeto := null;
      v_pago    := false;
    end if;
  else
    v_projeto := p_projeto_id;
    v_pago    := p_pago_com_projeto;
  end if;
  perform validar_projeto(p_categoria_id, v_projeto, v_pago);

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
         observacao         = case when p_observacao is null
                                   then v_atual.observacao else nullif(trim(p_observacao), '') end,
         projeto_id         = v_projeto,
         pago_com_projeto   = v_pago,
         status             = 'confirmado'
   where id = p_id;

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

-- 6. Orçamento: o aporte necessário de cada projeto aparece como sugestão ------------
-- Igual à migration 20261113000005, mais a coluna "sugerido" nos bolsos de projeto.
drop function public.orcamento_detalhe(bigint, date, bigint);
create function public.orcamento_detalhe(p_linha_id bigint, p_competencia date default null, p_cenario_id bigint default null)
returns table (tipo text, ref_id bigint, nome text, ordem int, orcado numeric, realizado numeric, sugerido numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with ctx as (
    select o.* from orcamento o
     where (p_competencia is not null and o.competencia = p_competencia)
        or (p_cenario_id is not null and o.cenario_id = p_cenario_id)
  ),
  lanc as (
    select l.* from lancamento l
     where l.competencia = p_competencia and l.status = 'confirmado' and not l.pago_com_projeto
  ),
  sug as (
    select s.bolso_id,
           case when p_competencia is null then s.aporte_necessario
                when date_trunc('month', p_competencia) >= greatest(date_trunc('month', current_date), date_trunc('month', s.inicio))
                 and date_trunc('month', p_competencia) < date_trunc('month', s.fim) then s.aporte_necessario
                else 0 end as valor
      from projetos_situacao() s
     where s.status = 'ativo'
  ),
  partes as (
    select 'item'::text as tipo, i.id as ref_id, i.nome, 1 as ordem,
           (select sum(valor) from ctx where ctx.item_id = i.id) as orcado,
           (select sum(valor) from lanc where lanc.item_id = i.id) as realizado,
           null::numeric as sugerido,
           i.ativo
      from item i
     where i.categoria_id = p_linha_id
    union all
    select 'bolso', b.id, b.nome, 2,
           (select sum(valor) from ctx where ctx.bolso_id = b.id),
           case when p_competencia is null then null else
             (select sum(case t.tipo when 'resgate' then -t.valor else t.valor end)
                from transferencia t
               where t.bolso_id = b.id and t.competencia = p_competencia
                 and t.tipo in ('aporte', 'resgate', 'amortizacao')) end,
           (select valor from sug where sug.bolso_id = b.id),
           coalesce((select p.status = 'ativo' from projeto p where p.id = b.projeto_id), true)
      from bolso b
      join v_linha_bolso lb on lb.bolso_id = b.id
     where lb.linha_id = p_linha_id
    union all
    select 'categoria', c.id, c.nome, 3,
           (select sum(o.valor) from ctx o left join item i on i.id = o.item_id
             where o.categoria_id = c.id or i.categoria_id = c.id),
           (select sum(valor) from lanc where lanc.categoria_id = c.id),
           null::numeric,
           c.ativa
      from categoria c
     where c.pai_id = p_linha_id and c.destino in ('investimentos', 'metas')
    union all
    select 'outros', null::bigint,
           case (select destino from categoria where id = p_linha_id)
             when 'receita' then 'Outras fontes'
             when 'investimentos' then 'Outros'
             when 'metas' then 'Outros'
             else 'Outros gastos' end,
           4,
           (select sum(valor) from ctx where ctx.categoria_id = p_linha_id),
           (select sum(valor) from lanc where lanc.categoria_id = p_linha_id and lanc.item_id is null),
           null::numeric,
           true
  )
  select tipo, ref_id, nome, ordem, coalesce(orcado, 0),
         case when p_competencia is null then null else coalesce(realizado, 0) end,
         sugerido
    from partes
   where ativo or orcado is not null or realizado is not null
   order by ordem, case when tipo = 'bolso' then ref_id end, coalesce(realizado, 0) + coalesce(orcado, 0) desc, nome;
$$;

-- 7. Permissões ------------------------------------------------------------------------
revoke execute on function public.depois_do_saldo(date, timestamptz, date, timestamptz)       from public, anon;
revoke execute on function public.gravar_indice(text, jsonb)                                   from public, anon;
revoke execute on function public.cdi_mensal_projetado()                                       from public, anon;
revoke execute on function public.fator_cdi(date, date, numeric)                               from public, anon;
revoke execute on function public.projetos_situacao(date)                                      from public, anon;
revoke execute on function public.projecao_projetos(date, int)                                 from public, anon;
revoke execute on function public.criar_projeto(text, numeric, date, date, numeric, numeric, bigint) from public, anon;
revoke execute on function public.editar_projeto(bigint, text, numeric, date, date, numeric, text) from public, anon;
revoke execute on function public.corrigir_saldo_projeto(bigint, numeric, date)               from public, anon;
revoke execute on function public.apagar_projeto(bigint)                                       from public, anon;
revoke execute on function public.validar_projeto(bigint, bigint, boolean)                     from public, anon;
revoke execute on function public.lancar(numeric, bigint, text, bigint, date, date, text, bigint, boolean) from public, anon;
revoke execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date, text, bigint, boolean) from public, anon;
revoke execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date, text, bigint, boolean) from public, anon;
revoke execute on function public.orcamento_detalhe(bigint, date, bigint)                     from public, anon;

grant execute on function public.depois_do_saldo(date, timestamptz, date, timestamptz)       to authenticated;
grant execute on function public.gravar_indice(text, jsonb)                                   to authenticated;
grant execute on function public.cdi_mensal_projetado()                                       to authenticated;
grant execute on function public.fator_cdi(date, date, numeric)                               to authenticated;
grant execute on function public.projetos_situacao(date)                                      to authenticated;
grant execute on function public.projecao_projetos(date, int)                                 to authenticated;
grant execute on function public.criar_projeto(text, numeric, date, date, numeric, numeric, bigint) to authenticated;
grant execute on function public.editar_projeto(bigint, text, numeric, date, date, numeric, text) to authenticated;
grant execute on function public.corrigir_saldo_projeto(bigint, numeric, date)               to authenticated;
grant execute on function public.apagar_projeto(bigint)                                       to authenticated;
grant execute on function public.validar_projeto(bigint, bigint, boolean)                     to authenticated;
grant execute on function public.lancar(numeric, bigint, text, bigint, date, date, text, bigint, boolean) to authenticated;
grant execute on function public.lancar_parcelado(numeric, int, bigint, text, bigint, date, date, text, bigint, boolean) to authenticated;
grant execute on function public.editar_lancamento(bigint, numeric, bigint, text, bigint, date, date, text, bigint, boolean) to authenticated;
grant execute on function public.orcamento_detalhe(bigint, date, bigint)                     to authenticated;

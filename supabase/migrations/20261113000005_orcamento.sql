-- Orçamento e resultados (fase 2). Plano em docs/06-fases-2-a-5.md.
--
-- O mês tem as linhas da aba Resultados: cada categoria é uma linha, e os grupos
-- "Poupança e Investimentos" e "Metas" são uma linha só cada (com bolsos,
-- projetos e as categorias de dentro deles no detalhe). Cada linha recebe um
-- valor cheio ou é detalhada por item (ou bolso), e o total é a soma.
--
-- Cenários (Ideal, Reduzido, Mínimo, Economia) são modelos com a mesma forma:
-- o orçamento de um mês começa de um cenário ou do mês anterior.

-- 1. Descontos: o que sai da renda antes do orçamento do casal ------------------
-- Gastos pessoais e custos da PJ não são lançados; entram só como desconto fixo,
-- e no realizado valem o mesmo que o orçado.
alter table public.categoria drop constraint categoria_destino_check;
alter table public.categoria add constraint categoria_destino_check
  check (destino in ('receita', 'gasto_do_mes', 'metas', 'investimentos', 'desconto'));

insert into public.categoria (nome, natureza, destino, custo_de_vida, ordem)
values ('Descontos', 'despesa', 'desconto', false, 6);

insert into public.categoria (pai_id, nome, natureza, destino, custo_de_vida, ordem)
select g.id, d.nome, 'despesa', 'desconto', false, d.ordem
  from public.categoria g,
       (values ('Pessoal A', 1), ('Pessoal B', 2), ('Custos da PJ', 3)) as d (nome, ordem)
 where g.nome = 'Descontos' and g.pai_id is null;

-- Desconto não é escolhido ao lançar: sai da lista de categorias da tela de lançamento.
create or replace view public.v_categoria
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
where c.ativa and c.destino <> 'desconto';

-- 2. Valores orçados ------------------------------------------------------------
-- Uma linha da tabela é um valor de um mês OU de um cenário, para exatamente uma
-- destas coisas:
--   categoria_id  a linha inteira (valor cheio) ou o "Outros gastos" quando há detalhe;
--                 numa categoria de dentro de Poupança ou Metas, o valor dela no detalhe
--   item_id       um item da categoria
--   bolso_id      um bolso (reserva, carteira, amortização) ou um projeto
create table public.orcamento (
  id            bigint generated always as identity primary key,
  competencia   date check (competencia is null or extract(day from competencia) = 1),
  cenario_id    bigint references public.cenario (id) on delete cascade,
  categoria_id  bigint references public.categoria (id),
  item_id       bigint references public.item (id),
  bolso_id      bigint references public.bolso (id),
  valor         numeric(14,2) not null check (valor > 0),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((competencia is null) <> (cenario_id is null)),
  check (num_nonnulls(categoria_id, item_id, bolso_id) = 1),
  constraint orcamento_linha_unica unique nulls not distinct (competencia, cenario_id, categoria_id, item_id, bolso_id)
);
create index orcamento_competencia_idx on public.orcamento (competencia);
select public.aplicar_acesso_padrao('orcamento');

-- 3. A que linha do orçamento pertence cada categoria e cada bolso ----------------
-- Categoria comum: ela mesma. Categoria dentro de Poupança ou Metas (Seguro de Vida,
-- Projetos Realizados): o grupo. Bolso que conta na poupança: o grupo Poupança e
-- Investimentos; bolso de projeto: o grupo Metas.
create view public.v_linha_categoria
with (security_invoker = true)
as
select c.id as categoria_id,
       case when c.pai_id is not null and c.destino in ('investimentos', 'metas') then c.pai_id else c.id end as linha_id
  from public.categoria c;

create view public.v_linha_bolso
with (security_invoker = true)
as
select b.id as bolso_id, g.id as linha_id
  from public.bolso b
  join public.categoria g
    on g.pai_id is null
   and g.destino = case when b.conta_na_poupanca then 'investimentos' else 'metas' end;

-- 4. Realizado × orçado do mês (ou só o orçado de um cenário) ---------------------
-- Realizado: lançamentos confirmados da competência (sem os gastos pagos com o
-- dinheiro de um projeto, que não passam pelo mês) e, nos grupos Poupança e Metas,
-- aportes − resgates nos bolsos. Desconto: realizado = orçado.
create function public.resultado_mes(p_competencia date default null, p_cenario_id bigint default null)
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
        union all
        select lb.linha_id, case t.tipo when 'resgate' then -t.valor else t.valor end
          from transferencia t
          join v_linha_bolso lb on lb.bolso_id = t.bolso_id
         where t.competencia = p_competencia and t.tipo in ('aporte', 'resgate', 'amortizacao')
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
         when l.destino = 'desconto' then coalesce(o.orcado, 0)
         else coalesce(r.realizado, 0) end,
    coalesce(o.detalhado, false)
  from linhas l
  left join orc o on o.linha_id = l.linha_id
  left join rea r on r.linha_id = l.linha_id
  where l.ativa or o.orcado is not null or r.realizado is not null
  order by 2, l.ordem, l.nome;
$$;

-- Aportes líquidos nos bolsos que contam na poupança (sem Seguro de Vida), para a
-- taxa de poupança: orçado e realizado do mês. No orçado entra também o valor
-- cheio da linha Poupança e Investimentos (quando ela não foi detalhada).
create function public.poupanca_mes(p_competencia date default null, p_cenario_id bigint default null)
returns table (orcado numeric, realizado numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select coalesce(sum(o.valor), 0)
       from orcamento o
       left join bolso b on b.id = o.bolso_id
       left join categoria g on g.id = o.categoria_id
      where (b.conta_na_poupanca or (g.pai_id is null and g.destino = 'investimentos'))
        and ((p_competencia is not null and o.competencia = p_competencia)
          or (p_cenario_id is not null and o.cenario_id = p_cenario_id))),
    case when p_competencia is null then null else
      (select coalesce(sum(case t.tipo when 'resgate' then -t.valor else t.valor end), 0)
         from transferencia t join bolso b on b.id = t.bolso_id
        where b.conta_na_poupanca and t.competencia = p_competencia
          and t.tipo in ('aporte', 'resgate', 'amortizacao'))
    end;
$$;

-- 5. Detalhe de uma linha: o "pop-up" ----------------------------------------------
-- Categoria comum: os itens dela e "Outros gastos". Grupo Poupança ou Metas: os
-- bolsos (em Metas, os projetos ativos), as categorias de dentro e "Outros".
create function public.orcamento_detalhe(p_linha_id bigint, p_competencia date default null, p_cenario_id bigint default null)
returns table (tipo text, ref_id bigint, nome text, ordem int, orcado numeric, realizado numeric)
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
  partes as (
    -- itens de uma categoria que é a própria linha
    select 'item'::text as tipo, i.id as ref_id, i.nome, 1 as ordem,
           (select sum(valor) from ctx where ctx.item_id = i.id) as orcado,
           (select sum(valor) from lanc where lanc.item_id = i.id) as realizado,
           i.ativo
      from item i
     where i.categoria_id = p_linha_id
    union all
    -- bolsos do grupo (reserva, carteiras, amortização; ou os projetos)
    select 'bolso', b.id, b.nome, 2,
           (select sum(valor) from ctx where ctx.bolso_id = b.id),
           case when p_competencia is null then null else
             (select sum(case t.tipo when 'resgate' then -t.valor else t.valor end)
                from transferencia t
               where t.bolso_id = b.id and t.competencia = p_competencia
                 and t.tipo in ('aporte', 'resgate', 'amortizacao')) end,
           coalesce((select p.status = 'ativo' from projeto p where p.id = b.projeto_id), true)
      from bolso b
      join v_linha_bolso lb on lb.bolso_id = b.id
     where lb.linha_id = p_linha_id
    union all
    -- categorias de dentro do grupo (Seguro de Vida, Projetos Realizados)
    select 'categoria', c.id, c.nome, 3,
           (select sum(o.valor) from ctx o left join item i on i.id = o.item_id
             where o.categoria_id = c.id or i.categoria_id = c.id),
           (select sum(valor) from lanc where lanc.categoria_id = c.id),
           c.ativa
      from categoria c
     where c.pai_id = p_linha_id and c.destino in ('investimentos', 'metas')
    union all
    -- o que não foi detalhado
    select 'outros', null::bigint,
           case (select destino from categoria where id = p_linha_id)
             when 'receita' then 'Outras fontes'
             when 'investimentos' then 'Outros'
             when 'metas' then 'Outros'
             else 'Outros gastos' end,
           4,
           (select sum(valor) from ctx where ctx.categoria_id = p_linha_id),
           (select sum(valor) from lanc where lanc.categoria_id = p_linha_id and lanc.item_id is null),
           true
  )
  select tipo, ref_id, nome, ordem, coalesce(orcado, 0),
         case when p_competencia is null then null else coalesce(realizado, 0) end
    from partes
   where ativo or orcado is not null or realizado is not null
   order by ordem, case when tipo = 'bolso' then ref_id end, coalesce(realizado, 0) + coalesce(orcado, 0) desc, nome;
$$;

-- 6. Gravar ---------------------------------------------------------------------------
-- Regrava uma linha inteira num mês ou cenário. p_valores é a lista do detalhe:
--   [{"tipo": "outros", "valor": 1500}]                              -> valor cheio
--   [{"tipo": "item", "id": 12, "valor": 900}, {"tipo": "outros", "valor": 200}, ...]
-- Valores vazios ou zero são ignorados.
create function public.orcar_linha(
  p_linha_id    bigint,
  p_valores     jsonb,
  p_competencia date default null,
  p_cenario_id  bigint default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v       jsonb;
  v_valor numeric;
  v_id    bigint;
begin
  if (p_competencia is null) = (p_cenario_id is null) then
    raise exception 'Informe o mês ou o cenário';
  end if;
  p_competencia := date_trunc('month', p_competencia)::date;

  delete from orcamento o
   where ((p_competencia is not null and o.competencia = p_competencia)
       or (p_cenario_id is not null and o.cenario_id = p_cenario_id))
     and (o.categoria_id in (select categoria_id from v_linha_categoria where linha_id = p_linha_id)
       or o.item_id in (select i.id from item i join v_linha_categoria lc on lc.categoria_id = i.categoria_id
                         where lc.linha_id = p_linha_id)
       or o.bolso_id in (select bolso_id from v_linha_bolso where linha_id = p_linha_id));

  for v in select * from jsonb_array_elements(coalesce(p_valores, '[]'::jsonb)) loop
    v_valor := round((v ->> 'valor')::numeric, 2);
    continue when v_valor is null or v_valor <= 0;
    v_id := (v ->> 'id')::bigint;

    case v ->> 'tipo'
      when 'outros' then
        insert into orcamento (competencia, cenario_id, categoria_id, valor)
        values (p_competencia, p_cenario_id, p_linha_id, v_valor);
      when 'item' then
        if not exists (select 1 from item i join v_linha_categoria lc on lc.categoria_id = i.categoria_id
                        where i.id = v_id and lc.linha_id = p_linha_id) then
          raise exception 'Item % não pertence a esta linha', v_id;
        end if;
        insert into orcamento (competencia, cenario_id, item_id, valor)
        values (p_competencia, p_cenario_id, v_id, v_valor);
      when 'bolso' then
        if not exists (select 1 from v_linha_bolso where bolso_id = v_id and linha_id = p_linha_id) then
          raise exception 'Bolso % não pertence a esta linha', v_id;
        end if;
        insert into orcamento (competencia, cenario_id, bolso_id, valor)
        values (p_competencia, p_cenario_id, v_id, v_valor);
      when 'categoria' then
        if not exists (select 1 from v_linha_categoria where categoria_id = v_id and linha_id = p_linha_id) then
          raise exception 'Categoria % não pertence a esta linha', v_id;
        end if;
        insert into orcamento (competencia, cenario_id, categoria_id, valor)
        values (p_competencia, p_cenario_id, v_id, v_valor);
      else
        raise exception 'Tipo desconhecido: %', v ->> 'tipo';
    end case;
  end loop;
end;
$$;

-- Preenche o mês com um cenário (substitui o que o mês tinha).
create function public.aplicar_cenario(p_cenario_id bigint, p_competencia date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  p_competencia := date_trunc('month', p_competencia)::date;
  delete from orcamento where competencia = p_competencia;
  insert into orcamento (competencia, categoria_id, item_id, bolso_id, valor)
  select p_competencia, categoria_id, item_id, bolso_id, valor from orcamento where cenario_id = p_cenario_id;
end;
$$;

-- Preenche um mês com outro (substitui o que o mês de destino tinha).
create function public.copiar_orcamento(p_de date, p_para date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  p_de := date_trunc('month', p_de)::date;
  p_para := date_trunc('month', p_para)::date;
  if p_de = p_para then
    raise exception 'Escolha dois meses diferentes';
  end if;
  delete from orcamento where competencia = p_para;
  insert into orcamento (competencia, categoria_id, item_id, bolso_id, valor)
  select p_para, categoria_id, item_id, bolso_id, valor from orcamento where competencia = p_de;
end;
$$;

-- Guarda o orçamento de um mês como cenário (substitui o que o cenário tinha).
create function public.salvar_cenario(p_competencia date, p_cenario_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  p_competencia := date_trunc('month', p_competencia)::date;
  delete from orcamento where cenario_id = p_cenario_id;
  insert into orcamento (cenario_id, categoria_id, item_id, bolso_id, valor)
  select p_cenario_id, categoria_id, item_id, bolso_id, valor from orcamento where competencia = p_competencia;
end;
$$;

-- 7. Mesclar itens leva junto o que estava orçado neles ------------------------------
-- Igual à migration 20261113000002, mais o bloco do orçamento antes de apagar o item.
create or replace function public.mesclar_item(p_origem bigint, p_destino bigint, p_guardar_nome boolean default false)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  o       item%rowtype;
  d       item%rowtype;
  v_resto text;
begin
  if p_origem = p_destino then
    raise exception 'Escolha dois itens diferentes';
  end if;
  select * into o from item where id = p_origem;
  select * into d from item where id = p_destino;
  if o.id is null or d.id is null then
    raise exception 'Item não encontrado';
  end if;
  if (select natureza from categoria where id = o.categoria_id)
     <> (select natureza from categoria where id = d.categoria_id) then
    raise exception 'Não é possível juntar um item de despesa com um de receita';
  end if;

  if p_guardar_nome then
    v_resto := resto_do_nome(o.nome, d.nome);
    if v_resto is not null then
      update lancamento
         set observacao = concat_ws(' · ', v_resto, nullif(btrim(observacao), ''))
       where item_id = o.id;
    end if;
  end if;

  update lancamento       set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update compra_parcelada set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update recorrencia      set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update regra_categorizacao set item_id = d.id where item_id = o.id;

  insert into orcamento as x (competencia, cenario_id, item_id, valor)
  select competencia, cenario_id, d.id, valor from orcamento where item_id = o.id
  on conflict on constraint orcamento_linha_unica do update set valor = x.valor + excluded.valor;
  delete from orcamento where item_id = o.id;

  if o.nome_norm <> '' and o.nome_norm <> d.nome_norm then
    insert into regra_categorizacao (padrao, tipo_match, item_id, prioridade, origem)
    values (o.nome_norm, 'exato', d.id, 1000, 'manual')
    on conflict (padrao, tipo_match) do nothing;
  end if;

  update item set usos = usos + o.usos where id = d.id;
  delete from item where id = o.id;
end;
$$;

-- 8. Permissões --------------------------------------------------------------------
revoke all on public.v_linha_categoria from anon;
revoke all on public.v_linha_bolso     from anon;
grant select on public.v_linha_categoria to authenticated;
grant select on public.v_linha_bolso     to authenticated;

revoke execute on function public.resultado_mes(date, bigint)                  from public, anon;
revoke execute on function public.poupanca_mes(date, bigint)                   from public, anon;
revoke execute on function public.orcamento_detalhe(bigint, date, bigint)      from public, anon;
revoke execute on function public.orcar_linha(bigint, jsonb, date, bigint)     from public, anon;
revoke execute on function public.aplicar_cenario(bigint, date)                from public, anon;
revoke execute on function public.copiar_orcamento(date, date)                 from public, anon;
revoke execute on function public.salvar_cenario(date, bigint)                 from public, anon;
grant execute on function public.resultado_mes(date, bigint)                  to authenticated;
grant execute on function public.poupanca_mes(date, bigint)                   to authenticated;
grant execute on function public.orcamento_detalhe(bigint, date, bigint)      to authenticated;
grant execute on function public.orcar_linha(bigint, jsonb, date, bigint)     to authenticated;
grant execute on function public.aplicar_cenario(bigint, date)                to authenticated;
grant execute on function public.copiar_orcamento(date, date)                 to authenticated;
grant execute on function public.salvar_cenario(date, bigint)                 to authenticated;

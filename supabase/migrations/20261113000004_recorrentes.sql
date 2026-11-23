-- Recorrentes (fase 1.5): contas fixas e assinaturas aparecem sozinhas todo mês,
-- pendentes, para confirmar com um toque ou ajustar o valor.
--
-- Um modelo (recorrencia) nasce de um lançamento real, escolhido na tela ou
-- sugerido pelo histórico. Ao abrir o app, gerar_recorrentes() cria o lançamento
-- pendente de cada modelo no mês. Confirmar um gerado atualiza o valor estimado
-- do modelo com o valor confirmado (a conta de luz do mês que vem parte da deste).

-- O texto do modelo é a observação dos lançamentos que ele gera (modelo categoria ->
-- item -> observação). Até onde o modelo já gerou fica em ultimo_mes_gerado: apagar
-- um pendente gerado (pular o mês) não o faz voltar.
alter table public.recorrencia rename column descricao to observacao;
alter table public.recorrencia alter column observacao drop not null;
alter table public.recorrencia add column ultimo_mes_gerado date
  check (ultimo_mes_gerado is null or extract(day from ultimo_mes_gerado) = 1);

-- v_lancamento passa a expor recorrencia_id (igual à migration 20261113000003, mais a coluna).
drop view public.v_lancamento;
create view public.v_lancamento
with (security_invoker = true)
as
select
  l.id,
  l.data,
  l.competencia,
  l.valor,
  l.status,
  l.conciliado,
  l.origem_input,
  l.descricao_original,
  l.observacao,
  l.conta_id,
  ct.nome                          as conta,
  ct.tipo                          as conta_tipo,
  l.fatura_id,
  l.categoria_id,
  c.nome                           as categoria,
  g.nome                           as grupo,
  c.natureza,
  c.destino,
  l.item_id,
  i.nome                           as item,
  l.compra_parcelada_id,
  l.parcela_numero,
  cp.n_parcelas,
  l.recorrencia_id,
  l.projeto_id,
  l.pago_com_projeto
from public.lancamento l
join public.conta ct                on ct.id = l.conta_id
left join public.categoria c        on c.id  = l.categoria_id
left join public.categoria g        on g.id  = c.pai_id
left join public.item i             on i.id  = l.item_id
left join public.compra_parcelada cp on cp.id = l.compra_parcelada_id;

-- Criar um modelo a partir de um lançamento -------------------------------------
-- Copia categoria, item, observação, conta, valor e dia. O mês do lançamento conta
-- como já gerado: o primeiro pendente é o do mês seguinte.
create function public.criar_recorrencia(p_lancamento_id bigint, p_periodicidade text default 'mensal')
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  l     lancamento%rowtype;
  v_id  bigint;
begin
  select * into l from lancamento where id = p_lancamento_id;
  if l.id is null then
    raise exception 'Lançamento não encontrado';
  end if;
  if l.categoria_id is null then
    raise exception 'Escolha a categoria antes de repetir';
  end if;
  if l.compra_parcelada_id is not null then
    raise exception 'Compra parcelada já gera as próprias parcelas';
  end if;
  if exists (select 1 from recorrencia r
              where r.ativa and r.categoria_id = l.categoria_id
                and r.item_id is not distinct from l.item_id
                and r.observacao is not distinct from l.observacao) then
    raise exception 'Já existe um recorrente igual';
  end if;

  insert into recorrencia (observacao, item_id, categoria_id, conta_id, valor_estimado, dia_previsto,
                           periodicidade, inicio, ultimo_mes_gerado)
  values (l.observacao, l.item_id, l.categoria_id, l.conta_id, l.valor, extract(day from l.data)::int,
          p_periodicidade, l.data, date_trunc('month', l.data)::date)
  returning id into v_id;

  update lancamento set recorrencia_id = v_id where id = l.id;
  return v_id;
end;
$$;

-- Gerar os pendentes ---------------------------------------------------------------
-- Para cada modelo ativo, cria o lançamento de cada mês ainda não gerado, até o mês
-- de p_ate. Um modelo novo não volta ao passado. Não cria se o mês já tem um
-- lançamento igual (mesma categoria, item e observação), lançado à mão por exemplo.
-- Devolve quantos lançamentos criou. Pode ser chamada quantas vezes quiser.
create function public.gerar_recorrentes(p_ate date default current_date)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r       recorrencia%rowtype;
  v_ate   date := date_trunc('month', p_ate)::date;
  v_mes   date;
  v_data  date;
  v_comp  date;
  v_n     int := 0;
  v_linhas int;
begin
  for r in
    select * from recorrencia where ativa order by id
  loop
    v_mes := coalesce((r.ultimo_mes_gerado + interval '1 month')::date, v_ate);
    while v_mes <= v_ate loop
      if (r.periodicidade = 'mensal' or extract(month from r.inicio) = extract(month from v_mes))
         and v_mes >= date_trunc('month', r.inicio)
         and (r.fim is null or v_mes <= r.fim)
         and not exists (select 1 from lancamento l
                          where l.categoria_id = r.categoria_id
                            and l.item_id is not distinct from r.item_id
                            and l.observacao is not distinct from r.observacao
                            and date_trunc('month', l.data) = v_mes) then
        v_data := v_mes + (least(coalesce(r.dia_previsto, extract(day from r.inicio)::int),
                                 extract(day from (v_mes + interval '1 month - 1 day'))::int) - 1);
        v_comp := competencia_de(r.conta_id, v_data);
        insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id, item_id,
                                observacao, origem_input, status, recorrencia_id, chave_dedup)
        values (v_data, v_comp, r.valor_estimado, r.conta_id, fatura_de(r.conta_id, v_comp),
                r.categoria_id, r.item_id, r.observacao, 'recorrente', 'pendente', r.id,
                'recorrente:' || r.id || ':' || to_char(v_mes, 'YYYY-MM'))
        on conflict (chave_dedup) where chave_dedup is not null do nothing;
        get diagnostics v_linhas = row_count;
        v_n := v_n + v_linhas;
      end if;
      update recorrencia set ultimo_mes_gerado = v_mes where id = r.id;
      v_mes := (v_mes + interval '1 month')::date;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Confirmar com um toque -------------------------------------------------------------
-- Para o pendente que já está certo (veio do recorrente ou com a sugestão certa do atalho).
create function public.confirmar_lancamento(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update lancamento set status = 'confirmado'
   where id = p_id and status = 'pendente' and categoria_id is not null;
  if not found then
    raise exception 'Este lançamento precisa ser revisado antes';
  end if;
end;
$$;

-- O valor confirmado de um gerado vira a nova estimativa do modelo.
create function public.atualizar_estimativa_recorrente()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update recorrencia set valor_estimado = new.valor where id = new.recorrencia_id;
  return new;
end;
$$;

create trigger lancamento_estimativa_recorrente
after update of status on public.lancamento
for each row
when (old.status = 'pendente' and new.status = 'confirmado' and new.recorrencia_id is not null)
execute function public.atualizar_estimativa_recorrente();

-- Views para a aba Recorrentes -----------------------------------------------------
create view public.v_recorrencia
with (security_invoker = true)
as
select
  r.id,
  r.observacao,
  r.item_id,
  i.nome  as item,
  r.categoria_id,
  c.nome  as categoria,
  c.natureza,
  c.ordem as categoria_ordem,
  r.conta_id,
  ct.nome as conta,
  r.valor_estimado,
  r.dia_previsto,
  r.periodicidade,
  r.inicio,
  r.fim,
  r.ativa,
  r.ultimo_mes_gerado
from public.recorrencia r
join public.categoria c  on c.id  = r.categoria_id
join public.conta ct     on ct.id = r.conta_id
left join public.item i  on i.id  = r.item_id;

-- Candidatos a recorrente: o mesmo item e observação em 3 ou mais dos últimos 6 meses,
-- cerca de uma vez por mês, visto nos últimos 2 meses, e sem modelo ativo ainda.
create view public.v_recorrencia_sugerida
with (security_invoker = true)
as
with base as (
  select l.id, l.categoria_id, l.item_id, l.observacao, l.competencia, l.data
    from public.lancamento l
   where l.status = 'confirmado' and l.compra_parcelada_id is null and l.item_id is not null
     -- 6 meses, contando o atual (sem a fatura do mês que vem)
     and l.competencia between date_trunc('month', current_date) - interval '5 months' and date_trunc('month', current_date)
),
grupo as (
  select categoria_id, item_id, observacao,
         count(distinct competencia) as meses,
         count(*)                    as vezes,
         max(competencia)            as ultimo_mes,
         (array_agg(id order by data desc, id desc))[1] as ultimo_lancamento_id
    from base
   group by categoria_id, item_id, observacao
)
select
  g.ultimo_lancamento_id,
  g.meses,
  g.vezes,
  g.categoria_id,
  c.nome  as categoria,
  c.natureza,
  c.ordem as categoria_ordem,
  g.item_id,
  i.nome  as item,
  g.observacao,
  l.valor as ultimo_valor,
  extract(day from l.data)::int as dia,
  ct.nome as conta
from grupo g
join public.lancamento l on l.id = g.ultimo_lancamento_id
join public.categoria c  on c.id = g.categoria_id
join public.item i       on i.id = g.item_id
join public.conta ct     on ct.id = l.conta_id
where g.meses >= 3
  and g.vezes <= g.meses * 1.25
  and g.ultimo_mes >= date_trunc('month', current_date) - interval '2 months'
  and not exists (select 1 from public.recorrencia r
                   where r.ativa and r.categoria_id = g.categoria_id
                     and r.item_id is not distinct from g.item_id
                     and r.observacao is not distinct from g.observacao);

revoke all on public.v_lancamento           from anon;
revoke all on public.v_recorrencia          from anon;
revoke all on public.v_recorrencia_sugerida from anon;
grant select on public.v_lancamento           to authenticated;
grant select on public.v_recorrencia          to authenticated;
grant select on public.v_recorrencia_sugerida to authenticated;

revoke execute on function public.criar_recorrencia(bigint, text)       from public, anon;
revoke execute on function public.gerar_recorrentes(date)               from public, anon;
revoke execute on function public.confirmar_lancamento(bigint)          from public, anon;
revoke execute on function public.atualizar_estimativa_recorrente()     from public, anon;
grant execute on function public.criar_recorrencia(bigint, text)       to authenticated;
grant execute on function public.gerar_recorrentes(date)               to authenticated;
grant execute on function public.confirmar_lancamento(bigint)          to authenticated;
grant execute on function public.atualizar_estimativa_recorrente()     to authenticated;

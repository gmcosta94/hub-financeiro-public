-- Cadastros (fase 1.8b): o que as telas de edição do modelo precisam.
--
-- Renomear, criar e inativar conta, categoria e subcategoria são updates
-- simples nas tabelas (o acesso por linha já limita a quem é editor).
-- Aqui ficam só as operações que mexem em várias tabelas de uma vez.

-- Junta dois itens: tudo o que apontava para p_origem passa a apontar para
-- p_destino, e p_origem deixa de existir.
--   * se os itens são de categorias diferentes, os lançamentos de p_origem
--     MUDAM de categoria (os totais de meses passados mudam junto);
--   * a grafia antiga vira regra, para continuar sendo reconhecida.
create function public.mesclar_item(p_origem bigint, p_destino bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  o item%rowtype;
  d item%rowtype;
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

  update lancamento       set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update compra_parcelada set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update recorrencia      set item_id = d.id, categoria_id = d.categoria_id where item_id = o.id;
  update regra_categorizacao set item_id = d.id where item_id = o.id;

  if o.nome_norm <> '' and o.nome_norm <> d.nome_norm then
    insert into regra_categorizacao (padrao, tipo_match, item_id, prioridade, origem)
    values (o.nome_norm, 'exato', d.id, 1000, 'manual')
    on conflict (padrao, tipo_match) do update set item_id = excluded.item_id;
  end if;

  update item set usos = usos + o.usos where id = d.id;
  delete from item where id = o.id;
end;
$$;

-- Muda um item de categoria e/ou de subcategoria.
--   * mesma categoria: só troca a subcategoria;
--   * outra categoria: o histórico do item acompanha. Se lá já existir um
--     item com o mesmo nome, os dois são juntados.
create function public.mover_item(
  p_id              bigint,
  p_categoria_id    bigint,
  p_subcategoria_id bigint default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  i           item%rowtype;
  v_existente bigint;
begin
  select * into i from item where id = p_id;
  if i.id is null then
    raise exception 'Item não encontrado';
  end if;
  if p_subcategoria_id is not null
     and (select categoria_id from subcategoria where id = p_subcategoria_id) is distinct from p_categoria_id then
    raise exception 'A subcategoria não pertence a essa categoria';
  end if;

  if p_categoria_id = i.categoria_id then
    update item set subcategoria_id = p_subcategoria_id where id = p_id;
    return;
  end if;

  if (select natureza from categoria where id = i.categoria_id)
     <> (select natureza from categoria where id = p_categoria_id) then
    raise exception 'Não é possível mover um item entre despesa e receita';
  end if;

  select id into v_existente from item where categoria_id = p_categoria_id and nome_norm = i.nome_norm;
  if v_existente is not null then
    perform mesclar_item(p_id, v_existente);
    if p_subcategoria_id is not null then
      update item set subcategoria_id = p_subcategoria_id where id = v_existente;
    end if;
    return;
  end if;

  update item set categoria_id = p_categoria_id, subcategoria_id = p_subcategoria_id where id = p_id;
  update lancamento       set categoria_id = p_categoria_id where item_id = p_id;
  update compra_parcelada set categoria_id = p_categoria_id where item_id = p_id;
  update recorrencia      set categoria_id = p_categoria_id where item_id = p_id;
end;
$$;

-- Apaga uma subcategoria; os itens dela voltam a ficar direto na categoria.
create function public.apagar_subcategoria(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update item set subcategoria_id = null where subcategoria_id = p_id;
  delete from subcategoria where id = p_id;
end;
$$;

-- Itens com os nomes de categoria e subcategoria e a contagem de lançamentos.
create view public.v_item
with (security_invoker = true)
as
select
  i.id,
  i.nome,
  i.nome_norm,
  i.categoria_id,
  c.nome as categoria,
  c.natureza,
  i.subcategoria_id,
  s.nome as subcategoria,
  i.usos,
  i.ativo,
  (select count(*) from public.lancamento l where l.item_id = i.id) as lancamentos
from public.item i
join public.categoria c         on c.id = i.categoria_id
left join public.subcategoria s on s.id = i.subcategoria_id;

-- Regras com o item e a categoria para onde levam.
create view public.v_regra
with (security_invoker = true)
as
select
  r.id,
  r.padrao,
  r.tipo_match,
  r.origem,
  r.acertos,
  r.erros,
  r.item_id,
  i.nome as item,
  c.nome as categoria
from public.regra_categorizacao r
join public.item i      on i.id = r.item_id
join public.categoria c on c.id = i.categoria_id;

revoke all on public.v_item  from anon;
revoke all on public.v_regra from anon;
grant select on public.v_item  to authenticated;
grant select on public.v_regra to authenticated;

revoke execute on function public.mesclar_item(bigint, bigint)        from public, anon;
revoke execute on function public.mover_item(bigint, bigint, bigint)  from public, anon;
revoke execute on function public.apagar_subcategoria(bigint)         from public, anon;
grant execute on function public.mesclar_item(bigint, bigint)        to authenticated;
grant execute on function public.mover_item(bigint, bigint, bigint)  to authenticated;
grant execute on function public.apagar_subcategoria(bigint)         to authenticated;

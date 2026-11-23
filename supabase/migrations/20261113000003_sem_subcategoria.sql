-- Fim da subcategoria (13/11/2026).
--
-- A classificação fica em dois níveis: categoria -> item, e a observação guarda
-- o detalhe de cada lançamento. As antigas subcategorias ("Refeições Fora",
-- "Compras de Mercado") viraram itens na limpeza (scripts/limpar_itens.py),
-- então a tabela e a coluna item.subcategoria_id deixam de ter uso.
--
-- Roda depois da limpeza e depois do app que já não lê subcategoria.

drop view public.v_lancamento;
drop view public.v_item;
drop function public.apagar_subcategoria(bigint);
drop function public.mover_item(bigint, bigint, bigint);

alter table public.item drop column subcategoria_id;
drop table public.subcategoria;

-- Lançamento com os nomes que a tela precisa (igual à migration 20261112000001, sem subcategoria).
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
  l.projeto_id,
  l.pago_com_projeto
from public.lancamento l
join public.conta ct                on ct.id = l.conta_id
left join public.categoria c        on c.id  = l.categoria_id
left join public.categoria g        on g.id  = c.pai_id
left join public.item i             on i.id  = l.item_id
left join public.compra_parcelada cp on cp.id = l.compra_parcelada_id;

-- Itens com a categoria e a contagem de lançamentos.
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
  i.usos,
  i.ativo,
  (select count(*) from public.lancamento l where l.item_id = i.id) as lancamentos
from public.item i
join public.categoria c on c.id = i.categoria_id;

-- Muda um item de categoria; o histórico acompanha. Se lá já existir um item
-- com o mesmo nome, os dois são juntados.
create function public.mover_item(p_id bigint, p_categoria_id bigint)
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
  if p_categoria_id = i.categoria_id then
    return;
  end if;
  if (select natureza from categoria where id = i.categoria_id)
     <> (select natureza from categoria where id = p_categoria_id) then
    raise exception 'Não é possível mover um item entre despesa e receita';
  end if;

  select id into v_existente from item where categoria_id = p_categoria_id and nome_norm = i.nome_norm;
  if v_existente is not null then
    perform mesclar_item(p_id, v_existente);
    return;
  end if;

  update item set categoria_id = p_categoria_id where id = p_id;
  update lancamento       set categoria_id = p_categoria_id where item_id = p_id;
  update compra_parcelada set categoria_id = p_categoria_id where item_id = p_id;
  update recorrencia      set categoria_id = p_categoria_id where item_id = p_id;
end;
$$;

revoke all on public.v_lancamento from anon;
revoke all on public.v_item       from anon;
grant select on public.v_lancamento to authenticated;
grant select on public.v_item       to authenticated;

revoke execute on function public.mover_item(bigint, bigint) from public, anon;
grant execute on function public.mover_item(bigint, bigint) to authenticated;

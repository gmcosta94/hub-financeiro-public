-- Lançamento já com os nomes que a tela precisa, para o app não montar joins.
-- security_invoker: a view respeita as políticas de acesso de quem consulta.

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
  s.nome                           as subcategoria,
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
left join public.subcategoria s     on s.id  = i.subcategoria_id
left join public.compra_parcelada cp on cp.id = l.compra_parcelada_id;

revoke all on public.v_lancamento from anon;
grant select on public.v_lancamento to authenticated;

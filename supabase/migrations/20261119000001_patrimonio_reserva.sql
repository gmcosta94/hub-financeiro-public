-- Patrimônio: a reserva de emergência vira um grupo à parte, separado dos projetos
-- (no app ela mora na aba Investimentos, não em Projetos). Grupos: Investimentos (1),
-- Reserva de emergência (2), Projetos (3), Bens (4) e Dívidas (5). Mesmo retorno de
-- antes; as fotos mensais passam a gravar os grupos novos a partir da próxima foto.
create or replace function public.patrimonio_atual(p_em date default current_date)
returns table (grupo text, grupo_ordem int, bolso_id bigint, bem_id bigint, nome text, valor numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select 'Investimentos', 1, p.bolso_id, null::bigint, p.bolso, round(sum(p.valor_brl), 2)
    from posicao_carteira(p_em) p
   group by p.bolso_id, p.bolso
  having sum(p.valor_brl) <> 0
  union all
  select case when b.tipo = 'reserva' then 'Reserva de emergência' else 'Projetos' end,
         case when b.tipo = 'reserva' then 2 else 3 end,
         s.bolso_id, null, s.nome, round(s.saldo, 2)
    from projetos_situacao(p_em) s
    left join bolso b on b.id = s.bolso_id
   where s.status <> 'cancelado' and s.saldo <> 0
  union all
  select case b.natureza when 'bem' then 'Bens' else 'Dívidas' end,
         case b.natureza when 'bem' then 4 else 5 end,
         null, b.id, b.nome,
         case b.natureza when 'bem' then v.valor else -v.valor end
    from bem b
    join lateral (
      select bv.valor from bem_valor bv
       where bv.bem_id = b.id and bv.em <= p_em
       order by bv.em desc limit 1
    ) v on true
   where b.ativo
  order by 2, 6 desc;
$$;

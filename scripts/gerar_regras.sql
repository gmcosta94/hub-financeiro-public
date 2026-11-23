-- Gera as regras de categorização a partir do histórico e mede a cobertura.
--
-- Uso:  psql "$DATABASE_URL" -f scripts/gerar_regras.sql
--
-- Regra: toda descrição (normalizada) que apareceu 2 vezes ou mais em despesas
-- vira "mesma descrição -> mesmo item". Se a descrição apareceu em mais de uma
-- categoria, vence o item mais usado.

begin;

delete from regra_categorizacao where origem = 'historico';

with usos as (
  select normalizar(l.descricao_original) as padrao,
         l.item_id,
         count(*) as n
  from lancamento l
  join categoria c on c.id = l.categoria_id
  where c.natureza = 'despesa'
  group by 1, 2
),
ranking as (
  select padrao, item_id, n,
         sum(n) over (partition by padrao) as total,
         row_number() over (partition by padrao order by n desc, item_id) as posicao
  from usos
)
insert into regra_categorizacao (padrao, tipo_match, item_id, prioridade, origem, acertos, erros)
select padrao, 'exato', item_id, total, 'historico', n, total - n
from ranking
where posicao = 1 and total >= 2 and padrao <> '';

commit;

-- Relatório: quanto do histórico as regras cobrem e quanto acertam.
with base as (
  select l.id, l.categoria_id, i.categoria_id as categoria_regra
  from lancamento l
  join categoria c on c.id = l.categoria_id and c.natureza = 'despesa'
  left join regra_categorizacao r
         on r.tipo_match = 'exato' and r.padrao = normalizar(l.descricao_original)
  left join item i on i.id = r.item_id
)
select count(*)                                                    as lancamentos,
       (select count(*) from regra_categorizacao)                  as regras,
       round(100.0 * count(categoria_regra) / count(*), 1)         as cobertura_pct,
       round(100.0 * count(*) filter (where categoria_regra = categoria_id)
             / nullif(count(categoria_regra), 0), 1)               as acerto_pct
from base;

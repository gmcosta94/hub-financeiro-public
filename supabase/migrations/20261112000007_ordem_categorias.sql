-- Ordem de exibição das categorias: a mesma da planilha (aba Resultados),
-- para a tela de lançamento e as análises futuras mostrarem na ordem conhecida.
-- categoria.ordem passa a ser uma ordem única entre as categorias de despesa,
-- e não mais uma ordem dentro de cada grupo.

update public.categoria c
   set ordem = o.ordem
  from (values
    ('Projetos Realizados',    1),
    ('Caridade',               2),
    ('Moradia',                3),
    ('Contas de Casa',         4),
    ('Mercado e Alimentação',  5),
    ('Transporte',             6),
    ('Saúde',                  7),
    ('Pet',                   8),
    ('Lazer',                  9),
    ('Conhecimento',          10),
    ('Gastos Extras',         11),
    ('Seguro de Vida',        12)
  ) as o (nome, ordem)
 where c.nome = o.nome and c.pai_id is not null and c.natureza = 'despesa';

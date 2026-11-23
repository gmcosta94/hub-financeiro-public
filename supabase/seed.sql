-- Seed: estrutura fixa do hub (docs/01-categorias.md).
-- Só nomes e estrutura. Nenhum valor pessoal: itens, lançamentos e projetos
-- vêm de scripts/migrar_historico.py, que lê dados/ (fora do git).

-- Grupos -----------------------------------------------------------------
insert into categoria (nome, natureza, destino, custo_de_vida, ordem) values
  ('Ganhos',                    'receita', 'receita',       false, 1),
  ('Custo de Vida',             'despesa', 'gasto_do_mes',  true,  2),
  ('Fora do Custo de Vida',     'despesa', 'gasto_do_mes',  false, 3),
  ('Metas',                     'despesa', 'metas',         false, 4),
  ('Poupança e Investimentos',  'despesa', 'investimentos', false, 5);

-- Categorias ---------------------------------------------------------------
insert into categoria (pai_id, nome, natureza, destino, custo_de_vida, ordem)
select g.id, c.nome, g.natureza, g.destino, g.custo_de_vida, c.ordem
from (values
  ('Ganhos',                   'Salário Principal',      1),
  ('Ganhos',                   'Rendas Paralelas',       2),
  ('Ganhos',                   'Outros',                 3),
  ('Custo de Vida',            'Moradia',                1),
  ('Custo de Vida',            'Contas de Casa',         2),
  ('Custo de Vida',            'Mercado e Alimentação',  3),
  ('Custo de Vida',            'Transporte',             4),
  ('Custo de Vida',            'Saúde',                  5),
  ('Custo de Vida',            'Pet',                   6),
  ('Fora do Custo de Vida',    'Lazer',                  1),
  ('Fora do Custo de Vida',    'Conhecimento',           2),
  ('Fora do Custo de Vida',    'Caridade',               3),
  ('Fora do Custo de Vida',    'Gastos Extras',          4),
  -- O que é pago em projetos (casa nova, enxoval, viagem).
  -- "Projetos Futuros" não é categoria: é aporte em projeto (transferencia).
  ('Metas',                    'Projetos Realizados',    1),
  -- Única despesa do grupo: proteção, não forma patrimônio.
  -- Reserva, carteiras e amortização são bolsos (transferencia).
  ('Poupança e Investimentos', 'Seguro de Vida',         1)
) as c (grupo, nome, ordem)
join categoria g on g.nome = c.grupo and g.pai_id is null;

-- Ordem de exibição das despesas: a da planilha (aba Resultados).
update categoria c
   set ordem = o.ordem
  from (values
    ('Projetos Realizados', 1), ('Caridade', 2), ('Moradia', 3), ('Contas de Casa', 4),
    ('Mercado e Alimentação', 5), ('Transporte', 6), ('Saúde', 7), ('Pet', 8),
    ('Lazer', 9), ('Conhecimento', 10), ('Gastos Extras', 11), ('Seguro de Vida', 12)
  ) as o (nome, ordem)
 where c.nome = o.nome and c.pai_id is not null and c.natureza = 'despesa';

-- Contas -------------------------------------------------------------------
insert into conta (nome, tipo, ativa) values
  ('Conta', 'corrente', true);

insert into conta (nome, tipo, dia_fechamento_padrao, dia_vencimento, conta_pagamento_id, ativa)
select c.nome, 'cartao', c.fechamento, c.vencimento, (select id from conta where nome = 'Conta'), c.ativa
from (values
  ('Cartão Principal',        28,   1,    true),
  -- Cartões encerrados: existem só para carregar o histórico de 2026.
  ('Cartão Antigo 1', null, null, false),
  ('Cartão Antigo 2',   null, null, false),
  ('Cartão Antigo 3',     null, null, false)
) as c (nome, fechamento, vencimento, ativa);

-- Nome do cartão na Carteira do iPhone (usado pelo atalho do Apple Pay).
update conta set apelido_carteira = 'Meu Banco' where nome = 'Cartão Principal';

-- Cenários de orçamento ------------------------------------------------------
insert into cenario (nome, ordem) values
  ('Ideal', 1), ('Reduzido', 2), ('Mínimo', 3), ('Economia', 4);

-- Bolsos fixos (os de projeto nascem junto com cada projeto) -----------------
insert into bolso (nome, tipo, conta_na_poupanca) values
  ('Reserva de Emergência',     'reserva',            true),
  ('Carteira Principal',        'carteira_principal', true),
  ('Carteira Satélite',         'carteira_satelite',  true),
  ('Amortização do Apartamento','amortizacao',        true);

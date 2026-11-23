-- Dados FICTÍCIOS para demonstração: as capturas de tela do README e quem quiser
-- rodar o app sem dados próprios. Nada aqui vem de dados reais.
--
-- Uso (banco local recém-criado):
--   supabase db reset
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/dados_ficticios.sql
--   scripts/preparar_app_local.sh
--
-- Um casal com salário fixo, gastos do dia a dia no cartão e na conta, um
-- orçamento mensal, três projetos, a reserva de emergência e uma carteira de
-- investimentos montada desde 2019. Os números variam de forma determinística
-- (sem random()), então cada execução gera exatamente os mesmos dados.

begin;

-- "Acaso" determinístico entre 0 e 1.
create function pg_temp.acaso(n bigint) returns numeric
language sql immutable as $$ select (abs(sin(n * 12.9898) * 43758.5453) - floor(abs(sin(n * 12.9898) * 43758.5453)))::numeric $$;

create function pg_temp.cat(p text) returns bigint
language sql stable as $$ select id from categoria where nome = p and pai_id is not null $$;

create function pg_temp.conta(p text) returns bigint
language sql stable as $$ select id from conta where nome = p $$;

create function pg_temp.bolso(p text) returns bigint
language sql stable as $$ select id from bolso where nome = p $$;

-- 1. Projetos e a reserva de emergência -----------------------------------------
select criar_projeto('Reserva de Emergência', 60000, date '2025-01-01', date '2027-12-01', 31000, 1,
                     pg_temp.bolso('Reserva de Emergência'));
select criar_projeto('Viagem para o Japão', 32000, date '2026-01-01', date '2027-06-01', 6000);
select criar_projeto('Troca de Carro', 60000, date '2026-03-01', date '2028-12-01', 4000);
select criar_projeto('Reforma da Cozinha', 25000, date '2027-01-01', date '2027-12-01', 0);
select criar_projeto('Mudança', 12000, date '2025-06-01', date '2026-04-01', 0);
update projeto set status = 'realizado' where nome = 'Mudança';
-- O saldo de partida vale no fim de 2025: os aportes de 2026 entram na estimativa.
update projeto set saldo_inicial_em = date '2025-12-31', saldo_definido_em = timestamptz '2025-12-31';

-- 2. Lançamentos de 2026 ------------------------------------------------------------
-- Cada modelo vira lançamentos mês a mês: valor base ± variação, tantas vezes por
-- mês, a partir de um dia, numa conta. Observações se alternam.
do $$
declare
  m        record;
  v_mes    int;
  v_vez    int;
  v_data   date;
  v_valor  numeric;
  v_n      int := 0;
  v_obs    text;
begin
  for m in
    select * from (values
      -- categoria,               item,                      conta,         dia, base,   var,  vezes, meses,                 observações
      ('Salário Principal',       'Empresa A',               'Conta',        5,  19800,  0,    1,     '{}'::int[],           '{}'::text[]),
      ('Rendas Paralelas',        'Consultoria',             'Conta',       15,  2400,   0.4,  1,     '{2,5,8,10}',          '{"Projeto de dados","Mentoria"}'),
      ('Outros',                  'Restituição',             'Conta',       20,  1850,   0,    1,     '{6}',                 '{"Imposto de renda"}'),
      ('Moradia',                 'Aluguel',                 'Conta',       10,  3800,   0,    1,     '{}',                  '{}'),
      ('Moradia',                 'Condomínio',              'Conta',       10,  870,    0.05, 1,     '{}',                  '{}'),
      ('Moradia',                 'IPTU',                    'Conta',       12,  215,    0,    1,     '{2,3,4,5,6,7,8,9,10,11}', '{}'),
      ('Contas de Casa',          'Energia',                 'Cartão Principal',   8,  240,    0.25, 1,     '{}',                  '{}'),
      ('Contas de Casa',          'Internet e Celular',      'Cartão Principal',   9,  185,    0,    1,     '{}',                  '{}'),
      ('Contas de Casa',          'Água e Gás',              'Conta',       14,  140,    0.2,  1,     '{}',                  '{}'),
      ('Mercado e Alimentação',   'Compras de Mercado',      'Cartão Principal',   3,  390,    0.35, 4,     '{}',                  '{"Supermercado","Feira","Atacado"}'),
      ('Mercado e Alimentação',   'Padaria',                 'Cartão Principal',   2,  38,     0.4,  5,     '{}',                  '{"Padaria da esquina"}'),
      ('Transporte',              'Combustível',             'Cartão Principal',   4,  240,    0.15, 3,     '{}',                  '{}'),
      ('Transporte',              'Aplicativo de transporte','Cartão Principal',   6,  32,     0.5,  3,     '{}',                  '{"Ida ao aeroporto","Volta do jantar","Centro"}'),
      ('Transporte',              'Seguro do Carro',         'Cartão Principal',  18,  210,    0,    1,     '{}',                  '{}'),
      ('Saúde',                   'Plano de Saúde',          'Conta',        7,  1120,   0,    1,     '{}',                  '{}'),
      ('Saúde',                   'Farmácia',                'Cartão Principal',  11,  120,    0.5,  2,     '{}',                  '{}'),
      ('Saúde',                   'Academia',                'Cartão Principal',   2,  190,    0,    1,     '{}',                  '{}'),
      ('Pet',                    'Ração e Petiscos',        'Cartão Principal',  13,  260,    0.15, 1,     '{}',                  '{}'),
      ('Pet',                    'Banho e Tosa',            'Cartão Principal',  16,  95,     0,    1,     '{}',                  '{}'),
      ('Lazer',                   'Refeições Fora',          'Cartão Principal',   5,  145,    0.6,  4,     '{}',                  '{"Restaurante italiano","Japonês","Hamburgueria","Pizzaria"}'),
      ('Lazer',                   'Streamings e Assinaturas','Cartão Principal',  15,  48,     0.3,  3,     '{}',                  '{"Vídeo","Música","Notícias"}'),
      ('Lazer',                   'Cinema e Shows',          'Cartão Principal',  21,  160,    0.5,  1,     '{3,6,7,9,11}',        '{"Cinema","Show"}'),
      ('Conhecimento',            'Cursos',                  'Cartão Principal',  12,  290,    0.3,  1,     '{1,3,4,6,8,9,10}',    '{"Curso online","Workshop"}'),
      ('Conhecimento',            'Livros',                  'Cartão Principal',  19,  75,     0.4,  1,     '{2,4,5,7,10}',        '{}'),
      ('Caridade',                'Doações',                 'Conta',       25,  150,    0,    1,     '{}',                  '{}'),
      ('Gastos Extras',           'Presentes',               'Cartão Principal',  17,  240,    0.6,  1,     '{3,5,6,8,10,11}',     '{"Aniversário","Casamento de amigos"}'),
      ('Seguro de Vida',          'Seguro de Vida',          'Conta',       20,  135,    0,    1,     '{}',                  '{}')
    ) as t (categoria, item, conta, dia, base, var, vezes, meses, obs)
  loop
    for v_mes in 1..12 loop
      continue when cardinality(m.meses) > 0 and not v_mes = any (m.meses);
      for v_vez in 1..m.vezes loop
        v_n := v_n + 1;
        v_data := make_date(2026, v_mes, least(m.dia + (v_vez - 1) * (24 / m.vezes), 28));
        continue when v_data >= current_date;
        v_valor := round(m.base * (1 + m.var * (pg_temp.acaso(v_n) * 2 - 1)), 2);
        v_obs := case when cardinality(m.obs) > 0 then m.obs[1 + (v_n % cardinality(m.obs))] end;
        perform lancar(v_valor, pg_temp.cat(m.categoria), m.item, pg_temp.conta(m.conta), v_data, null, v_obs);
      end loop;
    end loop;
  end loop;
end;
$$;

-- Uma compra parcelada, um estorno e passagens da viagem pagas com a renda do mês.
select lancar_parcelado(5400, 10, pg_temp.cat('Gastos Extras'), 'Eletrônicos', pg_temp.conta('Cartão Principal'),
                        date '2026-08-14', null, 'Notebook novo');
select lancar(-89.90, pg_temp.cat('Gastos Extras'), 'Presentes', pg_temp.conta('Cartão Principal'),
              date '2026-10-22', null, 'Estorno de compra devolvida');
select lancar(2800, pg_temp.cat('Projetos Realizados'), 'Passagens', pg_temp.conta('Cartão Principal'),
              date '2026-04-09', null, 'Japão', (select id from projeto where nome = 'Viagem para o Japão'));

-- Dois lançamentos do atalho do celular esperando revisão.
insert into lancamento (data, competencia, valor, conta_id, descricao_original, origem_input, status)
values (current_date - 1, competencia_de(pg_temp.conta('Cartão Principal'), current_date - 1), 42.50,
        pg_temp.conta('Cartão Principal'), 'CAFETERIA AROMA', 'atalho', 'pendente'),
       (current_date - 2, competencia_de(pg_temp.conta('Cartão Principal'), current_date - 2), 18.90,
        pg_temp.conta('Cartão Principal'), 'ESTACIONAMENTO CENTRO', 'atalho', 'pendente');

-- 3. Guardar: aportes do mês nos bolsos --------------------------------------------
do $$
declare
  v_mes  int;
  v_data date;
begin
  for v_mes in 1..12 loop
    v_data := make_date(2026, v_mes, 6);
    continue when v_data >= current_date;
    perform guardar(900, (select id from bolso where nome = 'Reserva de Emergência'), 'aporte', v_data);
    perform guardar(2600, (select id from bolso where nome = 'Carteira Principal'), 'aporte', v_data);
    perform guardar(350, (select id from bolso where nome = 'Carteira Satélite'), 'aporte', v_data);
    perform guardar(500, (select id from bolso where nome = 'Previdência'), 'aporte', v_data);
    perform guardar(1450, (select id from bolso where nome = 'Viagem para o Japão'), 'aporte', v_data);
    if v_mes >= 3 then
      perform guardar(1200, (select id from bolso where nome = 'Troca de Carro'), 'aporte', v_data);
    end if;
    if v_mes in (3, 6, 9) then
      perform guardar(2000, (select id from bolso where nome = 'Amortização do Apartamento'), 'aporte', v_data);
    end if;
  end loop;
  perform guardar(1500, (select id from bolso where nome = 'Reserva de Emergência'), 'resgate', date '2026-07-15');
end;
$$;

-- 4. Orçamento de cada mês (e o cenário "Ideal" igual a ele) --------------------------
insert into orcamento (competencia, categoria_id, valor)
select make_date(2026, mes, 1), pg_temp.cat(o.categoria), o.valor
  from generate_series(1, 12) mes
 cross join (values
   ('Salário Principal', 19800), ('Rendas Paralelas', 1500), ('Moradia', 4900), ('Contas de Casa', 560),
   ('Mercado e Alimentação', 1700), ('Transporte', 1000), ('Saúde', 1500), ('Pet', 360), ('Lazer', 900),
   ('Conhecimento', 300), ('Caridade', 150), ('Gastos Extras', 400), ('Seguro de Vida', 135)
 ) as o (categoria, valor);

insert into orcamento (competencia, bolso_id, valor)
select make_date(2026, mes, 1), pg_temp.bolso(o.bolso), o.valor
  from generate_series(1, 12) mes
 cross join (values
   ('Reserva de Emergência', 900), ('Carteira Principal', 2500), ('Carteira Satélite', 300),
   ('Previdência', 500), ('Viagem para o Japão', 1450), ('Troca de Carro', 1200)
 ) as o (bolso, valor);

insert into orcamento (cenario_id, categoria_id, item_id, bolso_id, valor)
select (select id from cenario where nome = 'Ideal'), o.categoria_id, o.item_id, o.bolso_id, o.valor
  from orcamento o where o.competencia = date '2026-11-01';

-- 5. Carteira de investimentos ---------------------------------------------------------
-- Pesos de cada ativo dentro do bloco (os pesos dos blocos vêm da migration).
insert into ativo (ticker, nome, grupo, moeda, bolso_id, bloco_id, peso_no_bloco)
select a.ticker, a.nome, a.grupo, a.moeda, pg_temp.bolso(a.bolso),
       (select id from bloco where nome = a.bloco and bolso_id is null), a.peso
  from (values
    ('Tesouro Selic 2029',  'Tesouro Selic 2029',          'Tesouro Direto', 'BRL', 'Carteira Principal', 'RF Brasil',        0.40),
    ('Tesouro IPCA+ 2032',  'Tesouro IPCA+ 2032',          'Tesouro Direto', 'BRL', 'Carteira Principal', 'RF Brasil',        0.60),
    ('BOVA11',              'Ibovespa (ETF)',              'ETF',            'BRL', 'Carteira Principal', 'RV Brasil',        0.60),
    ('DIVO11',              'Dividendos (ETF)',            'ETF',            'BRL', 'Carteira Principal', 'RV Brasil',        0.40),
    ('BND',                 'Títulos americanos (ETF)',    'ETF USA',        'USD', 'Carteira Principal', 'RF EUA',           0.50),
    ('SHY',                 'Treasuries curtos (ETF)',     'ETF USA',        'USD', 'Carteira Principal', 'RF EUA',           0.50),
    ('VOO',                 'S&P 500 (ETF)',               'ETF USA',        'USD', 'Carteira Principal', 'RV EUA',           0.50),
    ('VXUS',                'Mundo ex-EUA (ETF)',          'ETF USA',        'USD', 'Carteira Principal', 'RV EUA',           0.30),
    ('VIG',                 'Dividendos crescentes (ETF)', 'ETF USA',        'USD', 'Carteira Principal', 'RV EUA',           0.20),
    ('GLD',                 'Ouro (ETF)',                  'ETF USA',        'USD', 'Carteira Principal', 'Reserva de valor', 1.00),
    ('PETR4',               'Petrobras PN',                'Ações',          'BRL', 'Carteira Satélite',  null,               null),
    ('VALE3',               'Vale ON',                     'Ações',          'BRL', 'Carteira Satélite',  null,               null),
    ('BBAS3',               'Banco do Brasil ON',          'Ações',          'BRL', 'Carteira Satélite',  null,               null),
    ('HGLG11',              'Fundo logístico',             'Fundo Imobiliário','BRL','Carteira Satélite', null,               null),
    ('KNRI11',              'Fundo de renda urbana',       'Fundo Imobiliário','BRL','Carteira Satélite', null,               null),
    ('MSFT',                'Microsoft',                   'Ações EUA',      'USD', 'Carteira Satélite',  null,               null),
    ('Previdência PGBL',    'Fundo de previdência',        'Previdência',    'BRL', 'Previdência',        null,               null)
  ) as a (ticker, nome, grupo, moeda, bolso, bloco, peso);

-- Preço de cada ativo ao longo do tempo: crescimento mensal + uma ondulação.
create function pg_temp.preco(p_ticker text, p_mes int) returns numeric
language sql immutable as $$
  select round((p.inicial * exp(p.mensal * p_mes + p.onda * sin(p_mes / 4.0 + length(p_ticker))))::numeric, 4)
    from (values
      ('Tesouro Selic 2029', 10200.0, 0.0078, 0.002), ('Tesouro IPCA+ 2032', 1900.0, 0.0085, 0.03),
      ('BOVA11', 92.0, 0.0045, 0.08), ('DIVO11', 68.0, 0.0050, 0.06),
      ('BND', 82.0, -0.0004, 0.03), ('SHY', 84.0, -0.0002, 0.01),
      ('VOO', 230.0, 0.0105, 0.06), ('VXUS', 52.0, 0.0025, 0.06), ('VIG', 108.0, 0.0075, 0.05),
      ('GLD', 122.0, 0.0090, 0.05), ('PETR4', 26.0, 0.0040, 0.10), ('VALE3', 44.0, 0.0050, 0.10),
      ('BBAS3', 21.0, 0.0060, 0.08), ('HGLG11', 150.0, 0.0010, 0.04), ('KNRI11', 140.0, 0.0005, 0.04),
      ('MSFT', 102.0, 0.0150, 0.06), ('Previdência PGBL', 1.0, 0.0075, 0.01)
    ) as p (ticker, inicial, mensal, onda)
   where p.ticker = p_ticker
$$;

-- Dólar: de 3,80 (jan/2019) a 5,40 (hoje), com ondulação.
create function pg_temp.dolar(p_mes int) returns numeric
language sql immutable as $$ select round((3.8 + 1.6 * p_mes / 95.0 + 0.25 * sin(p_mes / 5.0))::numeric, 4) $$;

-- Compras mensais de jan/2019 a out/2026 (histórico, como viria do MyProfit).
-- Satélite: compras esparsas a partir de 2021; previdência a partir de 2023.
insert into historico_investimento (data, ticker, bolso_id, tipo, quantidade, valor_brl, moeda, valor_moeda, fonte)
select d.data, a.ticker, a.bolso_id, 'compra',
       round(c.valor / case when a.moeda = 'USD' then pg_temp.dolar(d.mes) else 1 end / pg_temp.preco(a.ticker, d.mes), 6),
       c.valor, a.moeda,
       case when a.moeda = 'USD' then round(c.valor / pg_temp.dolar(d.mes), 2) end,
       'myprofit'
  from ativo a
 cross join lateral (
   select (make_date(2019, 1, 10) + make_interval(months => g))::date as data, g as mes
     from generate_series(0, 93) g
 ) d
 cross join lateral (
   select case
     when a.bolso_id = pg_temp.bolso('Carteira Principal') then
       round(1900 * coalesce((select k.peso_meta from bloco k where k.id = a.bloco_id), 0) * a.peso_no_bloco
             * (0.6 + pg_temp.acaso(d.mes * 31 + a.id) * 0.8)
             -- RV EUA comprou menos nos últimos anos; reserva de valor, mais.
             * case when a.ticker in ('VOO', 'VXUS', 'VIG') and d.mes > 60 then 0.4
                    when a.ticker = 'GLD' then 1.8 else 1 end, 2)
     when a.bolso_id = pg_temp.bolso('Carteira Satélite') and d.mes >= 24 and pg_temp.acaso(d.mes * 7 + a.id) > 0.72 then
       round(400 + pg_temp.acaso(d.mes + a.id * 3) * 600, 2)
     when a.bolso_id = pg_temp.bolso('Previdência') and d.mes >= 48 then 450
   end as valor
 ) c
 where c.valor > 0;

-- Proventos de dividendos e fundos imobiliários.
insert into historico_investimento (data, ticker, bolso_id, tipo, valor_brl, moeda, fonte)
select make_date(2019 + g / 12, 1 + g % 12, 25), a.ticker, a.bolso_id, 'provento',
       round(15 + pg_temp.acaso(g + a.id) * 40, 2), 'BRL', 'myprofit'
  from ativo a cross join generate_series(24, 93, 3) g
 where a.ticker in ('DIVO11', 'HGLG11', 'KNRI11', 'BBAS3');

-- Posição de partida no app: o que o histórico acumulou até 31/10/2026.
insert into movimentacao (data, ativo_id, tipo, quantidade, valor_brl, origem)
select date '2026-10-31', a.id, 'posicao_inicial', sum(h.quantidade), sum(h.valor_brl), 'myprofit'
  from ativo a join historico_investimento h on h.ticker = a.ticker and h.tipo = 'compra'
 group by a.id;

-- Previdência: um saldo (quantidade 1, preço = saldo).
update movimentacao m set quantidade = 1
  from ativo a where a.id = m.ativo_id and a.ticker = 'Previdência PGBL';

-- Preços de hoje e o dólar.
insert into cotacao (ativo_id, data, preco, fonte)
select a.id, current_date,
       case when a.ticker = 'Previdência PGBL'
            then round((select sum(valor_brl) from historico_investimento h where h.ticker = a.ticker) * 1.18, 2)
            else round(pg_temp.preco(a.ticker, 95), 2) end,
       'manual'
  from ativo a;
insert into cambio (data, usd_brl, fonte) values (current_date, 5.40, 'manual');

-- Satélite: um bloco por grupo, com metas.
select blocos_por_grupo(pg_temp.bolso('Carteira Satélite'));
update bloco set peso_meta = case nome when 'Ações' then 0.45 when 'Fundo Imobiliário' then 0.35 when 'Ações EUA' then 0.20 end
 where bolso_id = pg_temp.bolso('Carteira Satélite');
update ativo set peso_no_bloco = 1 where bolso_id = pg_temp.bolso('Carteira Satélite');

-- A aposentadoria conta as duas carteiras. (Num banco novo, a migration que cria o
-- objetivo roda antes do seed que cria os bolsos, então o vínculo fica para cá.)
insert into objetivo_bolso (objetivo_id, bolso_id)
select o.id, b.id from objetivo o, bolso b
 where o.nome = 'Aposentadoria' and b.tipo in ('carteira_principal', 'carteira_satelite')
on conflict do nothing;

-- 6. Bens e dívidas ---------------------------------------------------------------------
insert into bem (nome, natureza, ordem) values
  ('Apartamento', 'bem', 1), ('Carro', 'bem', 2), ('Financiamento do apartamento', 'divida', 3);
insert into bem_valor (bem_id, em, valor)
select b.id, date '2026-11-01', v.valor
  from bem b join (values ('Apartamento', 620000), ('Carro', 68000), ('Financiamento do apartamento', 352000)) as v (nome, valor)
    on v.nome = b.nome;

commit;

-- Conferência rápida.
select 'lançamentos' as o, count(*) from lancamento
union all select 'transferências', count(*) from transferencia
union all select 'ativos', count(*) from ativo
union all select 'histórico', count(*) from historico_investimento;

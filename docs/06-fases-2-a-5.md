# Plano — fases 2 a 5 (orçamento, projetos, carteira, painéis)

Combinado em 13/11/2026. A importação de fatura em PDF e de extrato OFX (1.8 e 1.9) fica para o fim: o lançamento manual com atalho e recorrentes já resolve o dia a dia.

Ordem: orçamento e resultados → projetos → carteira → painéis.

## Decisões de 13/11/2026

- **Orçamento livre por mês**, como na aba Resultados: cada linha do mês recebe um valor cheio, ou abre um detalhe com os itens (e "Outros gastos" da categoria) e o total vira a soma.
- **Cenários são modelos.** Ideal, Reduzido, Mínimo e Economia guardam valores por linha e por item; o orçamento de um mês começa de um cenário ou do mês anterior e depois é ajustado à vontade. O realizado × orçado compara sempre com o orçamento do mês.
- **Projetos rendem 100% do CDI e o alvo é nominal.** O alvo já é pensado como o valor necessário na data final (um carro de R$ 50 mil daqui a um ano e meio). Só a aposentadoria trabalha em reais de hoje, com taxa real (fase 4). Isso substitui a decisão de 11/11 de alvos em reais de hoje para os projetos.
- **O saldo do projeto é estimado**: aportes e resgates capitalizados pelo CDI de cada mês (série pública do Banco Central). Dá para corrigir com o saldo real do banco quando quiser.
- **Gasto pago com o dinheiro do projeto** (o hotel pago com o cofrinho da viagem) é lançado direto no projeto: baixa o saldo do projeto e não entra no fluxo do mês. Gasto do projeto pago com a renda do mês (o hotel pago com o salário) entra no mês, em Metas, e também conta como já gasto no projeto.
- **Histórico de investimentos vem do MyProfit** (exportação com todas as movimentações: Brasil, EUA, Tesouro e cripto). Notas de corretagem só para conferir.

## Fase 2 — Orçamento e resultados

As linhas do mês seguem a aba Resultados, na ordem dela:

| Bloco | Linhas | Detalhe da linha (o "pop-up") | Realizado |
|---|---|---|---|
| Ganhos | Salário Principal, Rendas Paralelas, Outros | itens (fontes) + outros | lançamentos de receita |
| Descontos | Pessoal A, Pessoal B, Custos da PJ | — | igual ao orçado (não são lançados) |
| Poupança e Investimentos | uma linha | reserva, carteiras, amortização e Seguro de Vida | aportes − resgates nos bolsos + seguro |
| Metas | uma linha | projetos ativos e Projetos Realizados | aportes − resgates nos projetos + gastos de projeto pagos com a renda |
| Caridade, Custo de Vida, Fora do Custo de Vida | uma linha por categoria | itens + "Outros gastos" | lançamentos confirmados |

No pé: líquido do casal (ganhos − descontos), total investido + gasto, saldo final e taxa de poupança ((aportes − resgates em bolsos que contam na poupança) ÷ ganhos).

Entregas:
1. Schema: `orcamento` (um mês **ou** um cenário; linha = categoria, item ou bolso), grupo "Descontos", funções para orçar, aplicar cenário e copiar mês, e `resultado_mes()`.
2. Carga: orçamento mensal de 2026 da aba Resultados e os quatro cenários da aba de cenários, por categoria (os itens se detalham no app).
3. Tela "Orçamento": mês com realizado × orçado e percentual, o detalhe de cada linha e o modo cenário.

*Pronto quando*: o realizado × orçado de out/2026 no app bate com a aba Resultados, e o orçamento de dez/2026 é montado a partir de um cenário em poucos minutos.

Andamento (13/11/2026): em produção, com a carga de 2026 e dos cenários. Outubro de 2026 bate linha a linha com a aba Resultados, no orçado e no realizado (diferenças de R$ 0,01 de arredondamento da planilha). Carga: `scripts/migrar_orcamento.py` gera `dados/orcamento/carga.sql`.

### Aba Resultados (17/11/2026)

O relatório mês a mês do ano, como a aba de mesmo nome da planilha. As linhas e o orçado são os mesmos da tela Orçamento.

- **Organização:**
  - os blocos se recolhem;
  - um bloco com uma linha só mostra apenas o subtotal;
  - linha sem nada no ano não aparece.
- **Percentual ao lado de cada realizado**, conforme a comparação escolhida:
  - **vs orçado:** variação sobre o orçado. Fica verde quando entrou ou foi guardado mais, ou gasto menos, do que o orçado.
  - **vs mês anterior (análise horizontal):** variação sobre o mês anterior; no total, sobre os mesmos meses do ano anterior. Mesma regra de cor.
  - **% dos ganhos (análise vertical):** quanto a linha representa dos ganhos do período, como numa DRE. Fica sem cor.
- **Diferenças conhecidas para a planilha:**
  - De jan a mai, os aportes no projeto Casa Nova aparecem em Metas no app e em Investimentos na planilha.
  - O total da planilha soma dezembro, que já tem parcelas lançadas; o do app soma só até o mês atual.
  - Fora isso, os meses batem linha a linha.
- **Filtro por meio de pagamento (19/11/2026):** como na planilha, para bater a fatura do cartão e o saldo da conta separadamente.
  - Filtrado, "vs orçado" fica indisponível.
  - Somem os blocos zerados no ano (Ganhos e Descontos num cartão).

Andamento (17/11/2026): em produção.

### Painéis: objetivos e quanto poupar por mês (19/11/2026)

O cartão Projetos dos Painéis virou **Objetivos · quanto poupar por mês**, com três partes:

- **Projetos:** cada projeto com o progresso e o aporte mensal. A soma inclui os projetos que ainda vão começar.
- **Reserva de emergência:** saldo, objetivo, quanto falta, prazo e aporte mensal (`projetos_situacao`).
- **Investimentos · aposentadoria:** quanto tem, o alvo, a renda alvo e o prazo (`objetivo_situacao`), com o aporte pela premissa e pelo rendimento realizado.

No fim, o consolidado: projetos + reserva + aposentadoria (pela premissa) = quanto poupar por mês. A aposentadoria carrega à parte, porque leva uns segundos, e mostra "calculando…" enquanto isso.

## Fase 3 — Projetos

Por projeto: alvo, já separado (saldo estimado com CDI), já gasto, quanto falta e o aporte mensal necessário até a data final: `PMT(CDI mensal, meses restantes, saldo, alvo − já gasto)`. Projeção mês a mês e a soma dos aportes necessários sugerida na linha Metas do orçamento.

Operações: aporte e resgate (o "Guardar" que já existe), gasto pago com o projeto e gasto do projeto pago com a renda. Reserva de Emergência aparece junto, com alvo e prazo, mas conta como poupança.

Carga: os projetos ativos da planilha (alvo, saldo atual, início, fim). Aposentadoria não é projeto: vai para a fase 4.

*Pronto quando*: a aba Projetos da planilha deixa de ser usada.

Andamento (13/11/2026): em produção, com os seis projetos da planilha e a série do CDI. Projeto pode ser apagado de vez (`apagar_projeto`), menos quando tem aportes ou resgates registrados. Com a taxa da planilha (0,7% a.m.), o aporte necessário bate com o dela; nos projetos que ainda não começaram, bate com a coluna "Valor mensal a investir" (a "Valor mensal restante" da planilha conta o prazo a partir de hoje, o erro apontado no briefing). Carga: `scripts/migrar_projetos.py` gera `dados/projetos/carga.sql` (seis projetos; o saldo atual da planilha vira o ponto de partida).

## Fase 4 — Carteira

Blocos, ativos, metas de alocação (seção 6 do briefing), movimentações importadas do MyProfit, cotação e câmbio manuais (automáticos depois), peso real × meta e sugestão de aporte. Proventos entram; imposto não. Aposentadoria como objetivo das carteiras: renda mensal alvo, taxa de retirada, taxa real premissa e a rentabilidade real realizada como checagem.

*Pronto quando*: o aporte do mês é decidido pelo app, sem abrir o MyProfit.

O que a exportação do MyProfit traz (13/11/2026, `dados/historico_investimentos.xlsx`, relatório de negociações de jan/2017 a jul/2026): 350 compras e vendas de 85 ativos, em BRL e USD, com data, instituição, quantidade (negativa na venda), preço com e sem taxas. Não traz eventos corporativos (bonificação, desdobramento, conversão), trocas de ticker (FB → META, por exemplo), transferências entre corretoras nem proventos. Somando só as negociações, 15 ativos terminam com quantidade negativa.

Os outros três relatórios do MyProfit (13/11/2026, em `dados/`) fecham esses buracos:

| Relatório | O que traz | Uso |
|---|---|---|
| `posicao_detalhada.xls` | A posição em 13/11/2026: quantidade, preço médio, preço atual, grupo e a categoria usada no MyProfit, por ativo (46 ativos) | Ponto de partida da carteira |
| `historico_saldos.xls` | A quantidade de cada ativo depois de cada operação, com o tipo: negociação, desdobramento, bonificação, mudança de ticker, agrupamento, lançamento manual | Eventos corporativos que faltavam; o último saldo bate com a posição em 45 de 46 ativos (o fundo, que registra cotas por operação, fica pela posição) |
| `proventos.xlsx` | 1.314 pagamentos de 2017 a nov/2026: dividendo, JCP, rendimento, aluguel, amortização, com datas e valor | Rentabilidade com proventos |

Os `.xls` são `.xlsx` com a extensão trocada: abrir pelo conteúdo.

Decisões de 13/11/2026:
- **A carteira parte da posição de 13/11/2026**; negociações, eventos e proventos entram como histórico, para preço médio e rentabilidade. Daqui em diante, tudo é lançado no app.
- **Bolsos**: o que bate com os ativos do briefing (seção 6) é carteira principal; o resto é carteira satélite (ele ainda vai limpar a satélite); nada é reserva de emergência. Dois ativos estão como "Carteira Principal" no MyProfit sem constar no briefing: ficam na satélite até ele decidir.
- A última negociação é de 24/07/2026; a carteira em 13/11 é coerente com isso.

Andamento (13/11/2026): primeira entrega em produção. Previdência é um bolso à parte (fora das metas, conta na poupança): o fundo de previdência foi portado integralmente em ago/2026 para outro fundo (ajuste em `dados/carteira/ajustes.json`), e as contribuições de 2026 foram para esse bolso. Posição, metas, preços, câmbio, peso real × meta e sugestão de aporte. O valor da carteira no app bate com o total do MyProfit em 13/11 (com o preço implícito de cada ativo). Carga: `scripts/migrar_carteira.py` gera `dados/carteira/carga.sql`. Ficam para a segunda entrega: histórico, proventos, rentabilidade e aposentadoria.

Segunda entrega (13/11/2026, em produção): histórico do MyProfit (negociações e proventos) e rentabilidade pela taxa interna de retorno, nominal e real, por bolso e no total, desde o primeiro aporte. Aposentadoria como objetivo da carteira principal e satélite, com premissas editáveis (renda mensal em reais de hoje, taxa de retirada, taxa real e data). Carga: `scripts/migrar_historico_investimentos.py` gera `dados/carteira/historico.sql`. Falta: rentabilidade em janelas de 12, 24 e 36 meses (precisa de preços históricos).

### Reserva de emergência na aba Investimentos (18/11/2026)

A aba Carteira passou a se chamar Investimentos, e a reserva de emergência abre a página.

- **No cartão:** quanto tem, o objetivo, até quando e o aporte mensal para chegar lá, além dos botões Aplicar e Resgatar.
- **Aplicar e Resgatar** gravam um "Guardar" no bolso da reserva, que aparece em Lançamentos.
- **Tocar no cartão** abre o objetivo, o prazo, o % do CDI e a correção do saldo com o valor do banco.
- **No banco, nada mudou:** a reserva continua com alvo e prazo de projeto (`projetos_situacao` estima o saldo pelo CDI).
- **Onde ela deixa de aparecer:** a tela Projetos (lista, somas e projeção de 12 meses) e o cartão Projetos dos Painéis.
- **Onde ela continua:** no patrimônio, como grupo próprio ("Reserva de emergência", desde a migration `20261119000001`), e no bloco Poupança e Investimentos do orçamento.

### Aba Investimentos reorganizada (18/11/2026)

Do mais importante para o detalhe:

1. **Topo:** total investido (reserva + carteiras + previdência), a rentabilidade geral desde o início (nominal, real e ganho) e a composição numa barra.
2. **Objetivos lado a lado:** aposentadoria e reserva de emergência.
   - Aposentadoria: quanto tem, o alvo, a data, a renda alvo e o aporte mensal pela premissa e pelo realizado.
   - Reserva: o mesmo, mais Aplicar e Resgatar.
3. **Rentabilidade desde o início:** tabela por carteira (principal, satélite, previdência e o total) com início, taxa nominal e real ao ano, ganho e proventos.
4. **Carteira principal, meta × real:**
   - uma barra por bloco (o preenchimento é o real, o traço é a meta), com a distância em pontos percentuais e o valor;
   - tocar abre os ativos do bloco com a mesma barra;
   - as ferramentas (preços, operação, metas) ficam no cartão, e o aporte do mês fica ao lado.
5. **Carteira satélite** agrupada por tipo (ETF, ações, FII...), com cada grupo abrindo nos ativos, e **previdência** com aportado e ganho.

A rentabilidade (taxa interna de retorno de todo o histórico) leva uns 3 segundos no banco. Enquanto isso, os cartões mostram "Calculando…" no lugar certo, para a página não pular.

**Ajustes de 18/11/2026:**

- **Objetivos:** aposentadoria e reserva com a mesma altura.
- **Carteiras e aporte:**
  - A principal fica ao lado de uma coluna com o aporte do mês, os botões Atualizar preços e Registrar operação e a previdência, e as duas têm a mesma altura.
  - A satélite fica embaixo da principal.
  - Cada carteira tem "Abrir todos os ativos" e, no pé do cartão, "Editar metas".
  - No celular, tudo fica um embaixo do outro nessa ordem.
- **Escala das barras de meta × real:** fixa, de 0 a 100% da carteira, com marcas em 25, 50 e 75%. Antes cada cartão usava o maior valor dele, e as barras não se comparavam.
- **Metas da satélite:** seguem o modelo da principal, com peso de cada bloco na carteira e de cada ativo no bloco.
  - Os blocos são os grupos do MyProfit e começam sem meta.
  - Sem metas, o cartão mostra só o peso real.
  - `alocacao_carteira` e `sugestao_aporte` já aceitam a carteira como parâmetro.

### Tela de Projetos reorganizada (18/11/2026)

1. **Topo:** quanto está separado, de quanto (soma dos alvos), a barra do total (já gasto, separado, falta), o aporte do mês, o já gasto e o que falta.
2. **Cartões dos projetos:**
   - quanto já foi juntado (separado + gasto) e o % do alvo;
   - barra empilhada com já gasto, separado e falta;
   - separado, gasto, falta, prazo e aporte mensal;
   - o horizonte marcado com a cor dele.
3. **Aportes nos próximos 12 meses:** gráfico de linhas com o total e uma linha por horizonte (curto, médio e longo prazo).
4. **Linha do tempo:** cada projeto do início ao fim, com a parte cheia mostrando o % do alvo já juntado e um traço no "hoje".
5. **Realizados e cancelados**, por último.

As cores dos horizontes são as mesmas no rótulo, no gráfico e na linha do tempo.

## Fase 5 — Painéis

Realizado × orçado ao longo do ano, evolução de gastos por categoria e item, taxa de poupança, projetos e patrimônio. Visão de leitura para quem só lê.

Decisões (14/11/2026):
- **Patrimônio líquido** = investimentos a valor de mercado (carteiras e previdência) + reserva e projetos (saldo estimado pelo CDI) + bens − dívidas. Bens e dívidas (apartamento, carro, saldo devedor) têm valor atualizado à mão, com data.
- **Evolução**: foto mensal a partir de nov/2026 (não há preços de mercado do passado). Para antes, o gráfico mostra o aportado acumulado em investimentos (compras − vendas) desde 2017.
- **Painéis é a tela inicial** para os dois; quem só lê vê tudo e não altera nada.
- Gráficos em SVG próprio, sem biblioteca. Toda coluna e todo ponto mostram o valor ao tocar, e cada gráfico tem a tabela com os números.

Painéis: patrimônio líquido (composição e evolução), projetos (progresso e aporte do mês), e, filtrados pelo ano, realizado × orçado mês a mês por bloco, taxa de poupança mês a mês e acumulada, e gastos por categoria (ranking do ano, mês a mês e por item).

Andamento (16/11/2026): em produção. A primeira foto mensal é gravada quando o editor abre os painéis.

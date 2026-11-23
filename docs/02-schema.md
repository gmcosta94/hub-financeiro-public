# Schema do banco — proposta

Postgres. Nomes em português, snake_case, singular. Toda tabela tem `id` (bigint identity), `criado_em`, `atualizado_em`. Dinheiro em `numeric(14,2)`; quantidade de ativo em `numeric(20,8)`. Controle de acesso por linha ligado em todas as tabelas.

Isto é o desenho, não a migration. Os tipos e restrições exatos ficam para a fase 0.

## Convenções que valem para tudo

- **Sinal**: em `lancamento`, despesa e receita são positivas; estorno/devolução é negativo na mesma categoria. A natureza vem da categoria.
- **Competência**: sempre o dia 1 do mês de orçamento. Em conta, é o mês da data. Em cartão, é o mês em que a fatura fecha: o cartão vence dia 1 e fecha entre os dias 27 e 29, então quase sempre coincide com o mês da compra; compras feitas depois do fechamento caem no mês seguinte. A data de fechamento é informada por fatura (padrão 28). A compra feita no próprio dia do fechamento (o "melhor dia de compra") já cai no mês seguinte. A função `competencia_de` calcula a sugestão; a tela de lançamento mostra o mês sugerido e deixa trocar entre o mês da data e o seguinte.
- **Transferência não é lançamento**: aporte, resgate e pagamento de fatura não entram em realizado × orçado de despesa.
- **Bolso**: toda posição de investimento e todo saldo guardado pertence a exatamente um bolso (carteira principal, satélite ou um projeto).

## Cadastros

**`categoria`** — dois níveis: grupo → categoria.
`pai_id` (nulo no grupo), `nome`, `natureza` (receita | despesa), `destino` (gasto_do_mes | metas | investimentos), `custo_de_vida` (bool), `conta_na_poupanca` (bool), `ordem`, `ativa`.
Restrição: lançamento só aponta para categoria (nível 2).

**`item`** — o tipo de gasto dentro da categoria ("Refeições Fora", "Compras de Mercado"), ou a fonte de renda ("Empresa A"). É o segundo e último nível da classificação; o detalhe de cada lançamento ("Mamma Jamma") vai em `lancamento.observacao`.
`nome`, `categoria_id`, `usos` (para ordenar as sugestões), `ativo`.
Até 13/11/2026 havia uma tabela `subcategoria` pendurada no item; ela virou o próprio item e foi removida (migration `20261113000003`).

**`conta`**
`nome`, `tipo` (corrente | cartao | corretora | reserva | cripto), `moeda` (BRL | USD), `dia_fechamento_padrao`, `dia_vencimento` (só cartão), `conta_pagamento_id` (de onde a fatura é paga), `ativa`.
Só o cartão principal e a Conta ficam ativos. Três cartões antigos entram inativos, para carregar o histórico (um deles ainda tem uma parcela em aberto).

**`regra_categorizacao`**
`padrao` (texto normalizado: minúsculas, sem acento, sem sufixo de parcela e de data), `tipo_match` (exato | contem | prefixo), `item_id`, `categoria_id`, `prioridade`, `origem` (historico | correcao | manual), `acertos`, `erros`.
Cada correção feita na revisão cria ou ajusta uma regra.

## Lançamentos

**`fatura`** — uma por cartão e mês.
`conta_id`, `competencia`, `data_fechamento`, `data_vencimento`, `status` (aberta | fechada | conferida | paga), `total_pdf` (total lido do PDF, para bater com a soma).

**`lancamento`**
`data` (data real da compra), `competencia`, `valor`, `conta_id`, `fatura_id` (se cartão), `categoria_id`, `descricao_original`, `item_id`, `origem_input` (manual | atalho | recorrente | parcela | fatura_pdf | migracao), `status` (pendente | confirmado), `conciliado` (bool: bateu com a fatura), `compra_parcelada_id`, `parcela_numero`, `recorrencia_id`, `projeto_id` (despesa paga com dinheiro de um projeto), `chave_dedup`, `observacao`.

- `status = pendente` é a caixa de entrada: tudo que chega por atalho, recorrência ou PDF sem categoria certa fica aqui até a revisão.
- `chave_dedup` = conta + data + valor + descrição normalizada; índice único parcial para barrar duplicata de importação.

**`compra_parcelada`**
`descricao`, `item_id`, `categoria_id`, `conta_id`, `valor_total`, `n_parcelas`, `data_compra`, `primeira_competencia`.
Ao criar, gera os N lançamentos (o último absorve a diferença de centavos). Editar ou cancelar a compra refaz só as parcelas futuras.

**`recorrencia`**
`observacao`, `item_id`, `categoria_id`, `conta_id`, `valor_estimado`, `dia_previsto`, `periodicidade` (mensal | anual, no mês de `inicio`), `inicio`, `fim`, `ativa`, `ultimo_mes_gerado`.
Nasce de um lançamento real (`criar_recorrencia`), escolhido na tela ou sugerido por `v_recorrencia_sugerida`. Ao abrir o app, `gerar_recorrentes()` cria o pendente de cada mês ainda não gerado; apagar um pendente pula o mês sem que ele volte. Confirmar um gerado atualiza `valor_estimado` com o valor confirmado.

**`importacao`** — uma por PDF ou colagem de texto.
`fatura_id`, `tipo` (pdf | texto), `hash_arquivo`, `linhas_lidas`, `conciliadas`, `novas`, `divergentes`.
O PDF em si não é guardado.

**`importacao_linha`** — cada linha lida, com o resultado da conciliação.
`importacao_id`, `data`, `descricao`, `valor`, `parcela_txt`, `resultado` (bateu | nova | divergente | ignorada), `lancamento_id`.

**`transferencia`**
`data`, `competencia`, `valor`, `conta_origem_id`, `conta_destino_id`, `tipo` (aporte | resgate | pagamento_fatura | amortizacao | entre_contas), `bolso_id` (destino ou origem: reserva, carteira ou projeto), `fatura_id`, `observacao`.
É o que a tela chama de lançar "Investimentos" ou "Metas → Projetos Futuros": escolhe-se o destino e o valor. Seguro de vida não passa por aqui; é `lancamento` de despesa.

## Orçamento

**`cenario`** — Ideal, Reduzido, Mínimo, Economia. `nome`, `ordem`. São modelos: o orçamento de um mês começa de um cenário (`aplicar_cenario`) ou do mês anterior (`copiar_orcamento`) e depois é ajustado.

**`orcamento`** (migration `20261113000005`)
Um valor de um mês (`competencia`) **ou** de um cenário (`cenario_id`), para exatamente uma destas coisas: `categoria_id` (a linha inteira, ou "Outros gastos" quando a linha é detalhada), `item_id` (um item da categoria) ou `bolso_id` (reserva, carteira, amortização ou projeto). O total de uma linha é a soma do que a compõe.
As linhas do mês são as da aba Resultados: cada categoria, mais "Poupança e Investimentos" e "Metas" como uma linha só cada (`v_linha_categoria`, `v_linha_bolso` dizem a que linha pertence cada categoria e bolso).
Funções: `resultado_mes` (realizado × orçado de um mês, ou o orçado de um cenário), `orcamento_detalhe` (o detalhe de uma linha), `orcar_linha` (regrava uma linha), `poupanca_mes` (para a taxa de poupança), `aplicar_cenario`, `copiar_orcamento`, `salvar_cenario`.

**Descontos** — grupo de categorias (Pessoal A, Pessoal B, Custos da PJ) com `destino = desconto`. Não são lançados: entram só no orçamento, e no realizado valem o mesmo que o orçado.

## Projetos

Decidido em 13/11/2026 (substitui a decisão de 11/11): projetos têm alvo nominal e rendem 100% do CDI; o saldo é estimado pelo CDI de cada mês. Só a aposentadoria usa reais de hoje e taxa real (ver `objetivo`). Detalhes em `docs/06-fases-2-a-5.md`.

**`projeto`** (migration `20261113000006`) — os Projetos Futuros de Metas (viagem, carro, reforma, educação) e a Reserva de Emergência, que tem alvo e prazo mas conta na poupança (o bolso dela aponta para o projeto e continua com `conta_na_poupanca`).
`nome`, `valor_alvo`, `inicio`, `fim`, `pct_cdi` (1 = 100% do CDI), `saldo_inicial` + `saldo_inicial_em` + `saldo_definido_em` (o ponto de partida da estimativa), `status` (ativo | realizado | cancelado). O horizonte é calculado: até 12 meses curto, até 36 médio, depois longo.
Saldo estimado = saldo de partida corrigido pelo CDI + aportes − resgates no bolso, cada um corrigido desde a sua data, − gastos pagos com o dinheiro do projeto. Entra o que é posterior ao ponto de partida (no mesmo dia, o que foi registrado depois dele). "Corrigir saldo" (`corrigir_saldo_projeto`) troca o ponto de partida pelo saldo real do banco.
Gasto do projeto = lançamento em Projetos Realizados com `projeto_id`. Com `pago_com_projeto` baixa o saldo e fica fora do mês; sem, entra em Metas no mês. Os dois contam como já gasto.
Funções: `projetos_situacao` (alvo, separado, já gasto, falta, aporte necessário), `projecao_projetos` (mês a mês), `criar_projeto`, `editar_projeto`, `corrigir_saldo_projeto`, `apagar_projeto` (recusa se houver aportes ou resgates; gastos ligados ficam, sem o projeto), `fator_cdi`, `cdi_mensal_projetado`. O aporte necessário é o `PMT` da planilha (pagamento no início do mês, prazo por `DATEDIF`), com o prazo contado do maior entre o mês atual e o início.

**`objetivo`** + **`objetivo_bolso`** (migration `20261114000001`) — alvo de patrimônio para um conjunto de bolsos. Hoje só a Aposentadoria: renda mensal alvo, taxa de retirada, taxa real premissa e data alvo, editáveis na tela Carteira; bolsos: carteira principal e satélite (a previdência fica de fora). `objetivo_situacao` dá alvo, progresso e o aporte mensal necessário pela premissa e pela rentabilidade real realizada. Desenho original:
- Aposentadoria: `renda_mensal_alvo` e `taxa_retirada_anual`; o alvo é renda × 12 ÷ taxa de retirada. Usa `taxa_real_premissa` para calcular o aporte necessário até `data_alvo`.

**`objetivo_bolso`** — quais bolsos contam para o objetivo. Aposentadoria: carteira principal e satélite; a reserva pode ser incluída por opção.

A rentabilidade real realizada (12, 24, 36 meses e desde o início) aparece ao lado da premissa como checagem, com o aporte recalculado em cada uma. Ela não dirige o plano.

**`parametro`** — chave/valor para premissas globais. Hoje: `cdi_mensal_projetado` (vazio = o último mês fechado da série). Na fase 4 entra `inflacao_anual_projetada`.

**`indice`** — séries públicas mensais (% ao mês). `nome`, `competencia`, `valor`. O CDI (Banco Central, SGS 4391) é buscado pelo próprio app quando falta algum mês fechado (`gravar_indice`); o mês corrente e o futuro usam o CDI projetado. Na fase 4 entra o IPCA.

## Investimentos (fases 4 e 5; desenhado agora para não retrabalhar)

**`bolso`** — `nome`, `tipo` (carteira_principal | carteira_satelite | reserva | projeto | amortizacao), `projeto_id`. A tabela nasce na fase 0, porque as transferências da fase 1 já apontam para ela.

Primeira entrega da fase 4 (migration `20261113000007`, 13/11/2026):

**`bloco`** — RF Brasil, RV Brasil, RF EUA, RV EUA, Reserva de valor. `classe`, `regiao`, `peso_meta` (peso do bloco na carteira; na principal nasce com x = 35% do briefing), `ordem`, `bolso_id` (nulo = carteira principal; preenchido = outra carteira, hoje a satélite, migration `20261118000002`). Na satélite, `blocos_por_grupo(bolso)` cria um bloco por grupo do MyProfit (meta zero até definir) e põe nele os ativos sem bloco; a carga da carteira chama de novo no fim. Nome único por carteira.

**Previdência** — bolso à parte (`tipo = previdencia`), fora da carteira principal e da satélite, contando na poupança. Fundos do MyProfit vão para ele; a posição é "1 posição" com o saldo como preço, porque cotas mudam numa portabilidade.

**`ativo`** — `ticker`, `nome`, `grupo` (como no MyProfit), `moeda` (BRL | USD), `bolso_id` (carteira principal, satélite ou previdência), `bloco_id` e `peso_no_bloco` (principal e satélite). Meta do ativo = peso do bloco × peso no bloco ÷ soma dos pesos do bloco. Ativo da meta sem posição entra com quantidade zero, para a sugestão poder apontá-lo.

**`movimentacao`** — `data`, `ativo_id`, `tipo` (posicao_inicial | compra | venda | provento | ajuste), `quantidade` (positiva; em ajuste, com sinal), `valor_brl`, `origem` (manual | myprofit). A carteira parte da posição de 13/11/2026 do MyProfit (`posicao_inicial`, com o custo total). Preço médio: compra soma ao custo; venda tira a parte proporcional; ajuste (desdobramento, bonificação) muda só a quantidade.

**`cotacao`** — `ativo_id`, `data`, `preco` (na moeda do ativo), `fonte`. Atualizado à mão na tela (`gravar_cotacoes`); a carga usa o preço implícito do MyProfit (total atual ÷ quantidade).

**`cambio`** — `data`, `usd_brl`, `fonte`. O app busca o dólar do Banco Central (SGS 1, `gravar_cambio`); câmbio digitado não é sobrescrito.

Funções: `posicao_carteira` (quantidade, custo, proventos, preço, valor), `alocacao_carteira` (peso real × meta), `sugestao_aporte` (cada ativo recebe na proporção do que falta para a meta depois do aporte; nada é vendido).

Segunda entrega (migration `20261114000001`): **`historico_investimento`** (negociações e proventos do MyProfit antes da posição de partida, em reais; dólar do Banco Central de cada data) e rentabilidade pela taxa interna de retorno: `fluxos_investimento` (compra = dinheiro posto; venda e provento = dinheiro tirado; o valor de hoje fecha), `taxa_interna`, `rentabilidade_investimentos` (nominal e real, pelo IPCA de `indice`). Janelas de 12, 24 e 36 meses ficam para quando houver preços históricos. Metas sem histórico por enquanto (sem `vigente_desde`).

**`saldo_mensal`** — `conta_id`, `competencia`, `saldo`. Base do patrimônio líquido.

## Patrimônio e painéis (fase 5, migration `20261114000002`)

**`bem`** — `nome`, `natureza` (bem | divida), `ativo`, `ordem`. Apartamento, carro, saldo devedor do financiamento: o que não está em bolso nenhum.

**`bem_valor`** — `bem_id`, `em`, `valor` (sempre positivo; dívida entra negativa no patrimônio). Cada atualização é uma linha; vale a mais recente até a data.

**`patrimonio_mes`** — foto do patrimônio: `competencia`, `bolso_id` **ou** `bem_id`, `grupo`, `nome`, `valor`. O mês corrente é refeito (`fotografar_patrimonio`) quando quem edita abre os painéis; os meses passados ficam. Não há preço de mercado do passado, então a evolução começa em nov/2026.

Funções: `patrimonio_atual` (investimentos a mercado por bolso, reserva e projetos pelo saldo estimado, bens e dívidas), `patrimonio_evolucao` (fotos e o aportado acumulado em investimentos desde 2017), `resultado_ano` (`resultado_mes` dos 12 meses), `poupanca_ano` (taxa de poupança orçada, realizada e acumulada no ano) e `itens_ano` (`orcamento_detalhe` dos 12 meses).

## Relatório de resultados (migration `20261117000001`)

**`resultados_ano(p_ano, p_conta_id)`** — o relatório da aba Resultados: uma linha por linha do relatório e por mês do ano, mais o total do ano (`competencia` nula).

- **Linhas do relatório:**
  - `tipo` `linha`: cada linha de `resultado_mes`;
  - `tipo` `bloco`: o subtotal de cada bloco;
  - `tipo` `total`: Renda líquida, Investido + gasto e Saldo.
- **Colunas de cada célula:** `orcado`, `realizado`, `anterior` (o realizado do mês anterior) e `ganhos` (os ganhos realizados do período).
- **`sentido`:** diz a cor da variação.
  - `1`: mais é melhor (ganhos, investimentos, metas, renda líquida e saldo);
  - `-1`: menos é melhor (descontos e gastos);
  - `0`: sem juízo (investido + gasto).
- **Mês sem lançamento:** antes do histórico ou ainda por vir, tem realizado nulo, e por isso não entra na análise horizontal.
- **Total do ano:**
  - orçado e realizado somam só os meses que já têm realizado;
  - o anterior soma os mesmos meses do ano anterior.

**Por meio de pagamento (migration `20261119000002`):** `resultado_mes` e `resultados_ano` aceitam `p_conta_id` opcional. Com ele, o demonstrativo considera:

- os lançamentos daquela conta;
- os aportes que saíram dela e os resgates que entraram nela;
- os descontos zerados, porque não passam por conta;
- o orçado nulo, porque o orçamento não é por conta.

A base da análise vertical continua sendo os ganhos de todas as contas. No cartão, o "Investido + gasto" do mês é o valor da fatura.

## Acesso

**`membro`** — `user_id` (do provedor de autenticação), `nome`, `papel` (editor | leitor).

Políticas: quem está em `membro` lê tudo; só `editor` escreve. O endpoint do atalho usa um token próprio, revogável, que só consegue inserir lançamento pendente.

## Views principais

- `v_realizado_orcado` — por competência, cenário, categoria e item. Em Metas, aplica a regra de contagem do doc 01.
- `v_taxa_poupanca` — (aportes em reserva, carteiras e amortização − resgates) ÷ renda. Sem seguro de vida e sem aportes em projetos.
- `v_objetivo_acompanhamento` — alvo, valor atual, aporte necessário pela premissa e pelas rentabilidades realizadas.
- `v_fatura_resumo` — total lançado × total do PDF, pendências.
- `v_projeto_projecao`, `v_projeto_acompanhamento`.
- `v_posicao`, `v_alocacao_real_x_meta`, `v_sugestao_aporte`.
- `v_patrimonio`.

## Migração do histórico de 2026

1. `Gastos` (1.773 linhas) → `lancamento`, exceto a categoria "Investimentos". "Metas" vira Projetos Realizados.
2. "Investimentos": seguros → `lancamento` em Seguro de Vida; assinatura de curso → `lancamento` em Conhecimento; aportes e resgates → `transferencia`.
3. Descrição: extrair o sufixo "Nx - k" para `compra_parcelada` + `parcela_numero`, e a data "dd/mm" para `data`; o que sobra, normalizado, vira o `item`.
4. Itens: a migração cria um por descrição; `scripts/limpar_itens.py` os agrupa no tipo de gasto e passa o detalhe para a observação.
5. `Ganhos` (70 linhas) → `lancamento` de receita.
6. Regras de categorização semeadas com as descrições repetidas.
7. Conferência: soma por mês e categoria do banco tem que bater com a planilha.

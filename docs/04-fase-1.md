# Plano — fase 0 (base) e fase 1 (lançamentos)

Critério de pronto da fase 1: **fechar um mês inteiro em menos de 15 minutos**, com a planilha rodando em paralelo para conferência.

## Fase 0 — Especificação e base

| # | Entrega | Pronto quando |
|---|---|---|
| 0.1 | Validar categorias, schema e stack (docs 01–03) | Perguntas respondidas, docs atualizados |
| 0.2 | Experimento do Apple Pay: automação "Transação" disparando uma notificação; uma compra pelo iPhone e outra pelo Watch | Sabemos o que cada um entrega (estabelecimento, valor, cartão) |
| 0.3 | Projeto Supabase criado, CLI instalada, banco local rodando | `supabase start` funciona no Mac |
| 0.4 | Migrations: cadastros, lançamentos, transferências, acesso por linha | Banco sobe do zero com um comando |
| 0.5 | Seed: categorias, contas (cartão principal e conta ativos; três cartões antigos inativos), bolsos, cenários | Conferido contra o doc 01 |
| 0.6 | Script de migração do histórico de 2026 | Soma por mês × categoria igual à planilha; parcelas e datas reais extraídas |
| 0.7 | Regras de categorização geradas do histórico | Relatório de cobertura e acerto sobre 2026 |
| 0.8 | Script de backup | Dump restaurado com sucesso num banco vazio |

## Fase 1 — Lançamentos

Andamento em 13/11/2026:

| Item | Situação |
|---|---|
| 1.1 Esqueleto do app | Em produção |
| 1.2 Lançamento rápido, com competência editável | Em produção |
| Editar e apagar lançamento (não previsto no plano original) | Feito, testado no local |
| 1.3 Categorização por regras (`sugerir`; correção vira regra) | Feito, testado no local |
| 1.4 Compra parcelada | Feito, testado no local; editar a compra inteira fica para os cadastros |
| 1.6 Caixa de entrada ("Para revisar") | Feito, testado no local |
| 1.7 Atalho do Apple Pay (função `registrar_atalho` + tela do token) | Feito no local; falta montar o atalho no iPhone |
| 1.8b Cadastros: itens (renomear, mover, mesclar), categorias, contas, regras | Em produção. Categorias aparecem na ordem fixa da planilha; editar a compra parcelada inteira não será feito (apagar uma parcela ou todas basta) |
| Observação por lançamento (não previsto no plano original) | Em produção. Campo opcional no lançamento e na edição. Mesclar item pode guardar o nome antigo como observação |
| Modelo categoria → item → observação; limpeza dos itens (não previsto) | Em produção desde 13/11/2026 (backup de antes em `dados/backups/`). A subcategoria vira item e sai do banco; 835 itens viram 67 e o detalhe vai para a observação. O atalho grava o comerciante na observação; a tela sugere as observações mais usadas do item; a lista mostra a observação como título |
| 1.5 Recorrentes | Em produção. Modelos criados a partir de um lançamento ("Repetir todo mês") ou das sugestões do histórico (Cadastros › Recorrentes); pendentes gerados ao abrir o app; confirmar com um toque na fila "Para revisar" |
| Folha de lançamento repaginada (18/11/2026, não previsto) | Feito, testado no local. Data no cabeçalho, forma de pagamento ao lado do valor, categorias de gasto em três linhas (especiais, custo de vida, fora do custo de vida). Valor com vírgula automática ("59821" vira 598,21), botão ",00" e botão "±" para valor negativo: estorno ou reembolso entra como gasto negativo na categoria da compra e abate do mês da competência; é sempre à vista. Guardar divide o valor entre vários bolsos (reserva, carteiras e previdência, amortização, projetos), em grupos (Reserva, Investimentos, Projetos), com deslizador, campo e um botão "tudo"/"resto" em cada um e a conferência do total; grava tudo numa transação só (`guardar_varios`) |
| Filtros da lista de lançamentos (19/11/2026) | Feito, testado no local. Seletores maiores (com seta própria, para o Safari respeitar o espaçamento). Categorias com seleção múltipla, na ordem da demonstração de Resultados e agrupadas pelos blocos; marcar o bloco marca todas as categorias dele, e cada uma mostra quantos lançamentos tem no mês |
| 1.8 Fatura em PDF, 1.9 Extrato OFX, 1.10 Mês de teste | A fazer (fatura e OFX por último, a pedido) |

O atalho chama a função `registrar_atalho` direto pela API do banco, autorizado por um token gerado no app. Não foi preciso Edge Function.

Ordem pensada para dar retorno cedo: primeiro o que ele mais espera (parcelas e sugestão de categoria), depois a captura automática, por último a conciliação.

### 1.1 Esqueleto do app
Login, PWA instalável, publicação automática. Lista de lançamentos do mês com filtro por conta e categoria.
*Pronto quando*: abre no iPhone pela tela de início e mostra o histórico migrado.

### 1.2 Lançamento rápido
Valor → categoria (as mais usadas primeiro) → item, com as sugestões da categoria ou texto livre. Conta e data com padrão (Cartão Principal, hoje). "Investimentos" e "Projetos Futuros" pedem o destino em vez do item.
*Pronto quando*: um gasto comum é lançado em menos de 10 segundos no celular.

### 1.3 Categorização por regras
Ao digitar ou receber uma descrição, o app normaliza, aplica as regras e preenche item e categoria. Corrigir uma sugestão cria ou ajusta a regra.
*Pronto quando*: reaplicando as regras sobre 2026, a cobertura e o acerto batem com os números do briefing (dois terços, ~97%).

### 1.4 Compra parcelada
Uma tela: valor total, número de parcelas, primeira fatura. Gera as parcelas futuras; editar ou cancelar refaz só as que ainda não venceram.
*Pronto quando*: as parcelas em aberto de 2026 foram recriadas como compras parceladas e as faturas futuras já aparecem com elas.

### 1.5 Recorrentes
Cadastro de modelos (condomínio, luz, gás, internet, IPTU, terapias, seguros, assinaturas). No início do mês aparecem como pendentes para confirmar ou ajustar.
Como ficou: o modelo nasce de um lançamento real, pelo botão "Repetir todo mês" ou pelas sugestões do histórico (o mesmo item e observação em 3 ou mais dos últimos 6 meses, cerca de uma vez por mês). Os pendentes são gerados ao abrir o app, sem duplicar o que já foi lançado à mão no mês; confirmar é um toque (✓) na fila. O valor do modelo acompanha o último confirmado.
*Pronto quando*: as contas fixas do mês são confirmadas em menos de 2 minutos.

### 1.6 Caixa de entrada
Uma fila só para tudo que está pendente: vindos do atalho, recorrentes a confirmar, sem categoria. Revisão em lote, um toque por item.
*Pronto quando*: zerar a fila de uma semana leva menos de 2 minutos.

### 1.7 Atalho do Apple Pay
Endpoint com token próprio; atalho no iPhone enviando estabelecimento, valor e cartão. O lançamento entra pendente, já com a categoria sugerida.

Resultado do experimento 0.2 (12/11/2026): a automação "Transação" dispara na hora da compra e entrega os campos neste formato (valores de exemplo):

| Campo | Como chega | Tratamento |
|---|---|---|
| Comerciante | `Global Parking`; às vezes genérico, como `Estacionamento` | Vira `descricao_original`; passa por `normalizar()` e pelas regras |
| Valor | `R$ 22,00` (texto, formato brasileiro) | Tirar `R$`, pontos de milhar e trocar vírgula por ponto |
| Cartão ou Tíquete | `Meu Banco` | Não é o nome da conta no app: a conta precisa de um apelido da Carteira para casar |
| Nome | Igual ao comerciante | Ignorado |
| Data Atual | `12 de nov. de 2026, 15:23` | O atalho envia em formato ISO, não este texto |

Falta confirmar se o pagamento pelo Watch também dispara. Se não: atalho de ditado no relógio ("quarenta reais padaria") usando o mesmo endpoint.
*Pronto quando*: uma compra por aproximação aparece na caixa de entrada sem ele abrir o app.

### 1.8 Fechamento de fatura
Envio do PDF (ou colagem de texto) → leitura das linhas → conciliação com os lançamentos da fatura por valor e data (tolerância de alguns dias) → três listas: bateu, falta lançar, lançado e não está na fatura. Total do PDF × total lançado no topo.
Só existe leitor para o banco do cartão principal, único em uso. A data de fechamento (entre 27 e 29) é informada aqui e define a competência das compras dos últimos dias do mês.
*Pronto quando*: a fatura do cartão de um mês real é conferida sem criar nenhum lançamento em dobro.

### 1.8b Cadastros
Telas para editar o modelo sem abrir o banco: contas (criar cartão, inativar), categorias (renomear, inativar, criar itens), itens (renomear, mover de categoria, mesclar dois itens) e regras de categorização.
Regra geral: o que tem histórico não é apagado, só inativado. Projetos entram na fase 3 e cenários na fase 2. Quem tem acesso (membros) continua só no painel do Supabase.
*Pronto quando*: dá para cadastrar um cartão novo, inativar um antigo e mesclar dois itens duplicados pelo app, com o histórico preservado.

### 1.9 Extrato da conta em OFX
Envio do OFX exportado do banco → conciliação com os lançamentos e transferências da conta → confirma recorrentes com o valor real, propõe o que faltou e liga pagamentos de fatura, aportes e resgates às transferências. O identificador de cada movimento (FITID) impede duplicata em reimportações.
Vem depois da fatura porque a conta tem poucos movimentos e o lançamento manual dá conta enquanto isso.
*Pronto quando*: o OFX de um mês real é importado duas vezes seguidas e a segunda não cria nada.

### 1.10 Mês de teste
Um mês completo lançado no app e na planilha em paralelo. Medir o tempo de fechamento e comparar os totais por categoria.
*Pronto quando*: totais iguais e fechamento em menos de 15 minutos. A partir daí a aba `Gastos` da planilha para de ser alimentada.

## Fora da fase 1

Orçamento e realizado × orçado (fase 2), projetos (3), carteira (4), patrimônio e painéis (5). A visão de quem só lê entra na fase 2, quando houver o que olhar; o acesso dela já nasce criado na fase 0.

## Riscos da fase

- Automação do Apple Pay não funcionar como esperado: plano B é o lançamento rápido, que precisa ser bom de qualquer jeito.
- Layout do PDF do banco difícil de ler: colagem de texto como caminho alternativo.
- Classificação com níveis demais aumentar o atrito do lançamento: por isso ficou categoria → item, com a observação livre e sugerida.

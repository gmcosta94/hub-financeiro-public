# Hub Financeiro

[English](README.md) | **Português**

**Um sistema de finanças da casa que substituiu duas planilhas antigas: gastos do dia a dia, orçamento mensal, projetos de poupança e carteira de investimentos, com toda a regra de negócio escrita em SQL.**

React + TypeScript (PWA) · Postgres/Supabase com RLS · Cloudflare · dados abertos do Banco Central

<p align="center">
  <img src="docs/imagens/paineis-computador.png" alt="Painéis: patrimônio líquido, objetivos e quanto poupar por mês, realizado × orçado" width="860">
</p>

<sub>Todas as telas usam dados fictícios.</sub>

> Vitrine pública. O desenvolvimento acontece num repositório privado desde 11/11/2026 (35 commits até esta atualização); aqui ficam o código, os documentos de decisão e as telas, sem os dados pessoais.

## O problema

Por anos, as finanças de um casal viveram em duas planilhas. Todo gasto era digitado à mão, coluna por coluna (cerca de 170 lançamentos por mês, 15% deles parcelas copiadas linha a linha); o orçamento era uma aba de fórmulas que só o autor entendia; os projetos de poupança (viagem, carro, reserva de emergência) eram projetados com taxa fixa e uma contagem de meses que errava; e a carteira de investimentos ficava num aplicativo de terceiros que não seguia as categorias da casa. Aplicativos pagos de finanças foram testados e abandonados: nenhum respeitava o jeito como esta família classifica o dinheiro nem mostrava o que ela queria ver.

O hub substitui as planilhas uma parte de cada vez, com um banco relacional como fonte única. Uma fase só começa quando a anterior substituiu a sua parte da planilha, e cada migração é conferida contra ela linha a linha.

> **O que ele responde todo mês:** para onde foi o dinheiro (e contra qual orçamento), quanto da renda foi poupado, quanto guardar para cada objetivo e onde investir o próximo aporte sem vender nada.

## Como as peças se ligam

```mermaid
flowchart LR
  subgraph Captura
    Atalho[Atalho do Apple Pay] --> Revisar[Para revisar]
    Rapido[Lançamento rápido<br/>valor, categoria, item] --> Lancamentos
    Recorrentes[Contas recorrentes] --> Revisar
    Revisar --> Lancamentos[Lançamentos<br/>categoria, item, observação<br/>mês da fatura]
  end
  subgraph Plano
    Orcamento[Orçamento do mês<br/>e cenários]
  end
  subgraph Poupar
    Guardar[Guardar: um aporte<br/>dividido entre bolsos] --> Bolsos[Reserva de emergência<br/>carteiras, previdência<br/>projetos]
  end
  Lancamentos --> Resultados[Resultados<br/>mês a mês]
  Orcamento --> Resultados
  Bolsos --> Projetos[Projetos<br/>alvo, prazo, CDI]
  Bolsos --> Carteira[Investimentos<br/>meta × real, TIR]
  Resultados --> Paineis
  Projetos --> Paineis
  Carteira --> Paineis[Painéis<br/>patrimônio e objetivos]
```

Todo gasto tem uma categoria (a árvore fixa da planilha), um item (o tipo de gasto: "Compras de Mercado", "Refeições Fora") e uma observação livre opcional (o lugar, a pessoa). Dinheiro guardado não é gasto: é uma transferência para um bolso, que alimenta os projetos, a carteira e a taxa de poupança.

## Telas

| | |
|---|---|
| ![Resultados](docs/imagens/resultados-computador.png) | ![Investimentos](docs/imagens/investimentos-computador.png) |
| **Resultados**: o demonstrativo mês a mês, como a aba da planilha que ele substituiu. O percentual ao lado de cada valor alterna entre *vs orçado*, *vs mês anterior* (análise horizontal) e *% dos ganhos* (análise vertical), e o demonstrativo inteiro pode ser filtrado por meio de pagamento, para bater a fatura do cartão. | **Investimentos**: aposentadoria e reserva de emergência lado a lado, rentabilidade desde o primeiro aporte (TIR, nominal e real) e meta × real por classe de ativo, abrindo em cada ativo. |
| ![Orçamento](docs/imagens/orcamento-computador.png) | ![Projetos](docs/imagens/projetos-computador.png) |
| **Orçamento**: o orçado em destaque e o realizado embaixo, em vermelho só quando o gasto passa (guardar mais do que o previsto é bom). | **Projetos**: quanto está separado para cada objetivo, o aporte mensal necessário para chegar no prazo, os próximos 12 meses e uma linha do tempo. |

<p align="center">
  <img src="docs/imagens/lancamentos-computador.png" alt="Lançamentos com a folha de novo lançamento aberta" width="860">
</p>

**Lançamentos**: o extrato do mês com filtros, e a folha de lançamento: o valor é digitado como numa maquininha ("59821" vira 598,21), as categorias vêm na mesma ordem do demonstrativo, e o "Guardar" divide um depósito entre vários bolsos numa transação só.

<p align="center">
  <img src="docs/imagens/paineis-celular.png" alt="Painéis no celular" width="260">
  &nbsp;&nbsp;
  <img src="docs/imagens/lancamento-celular.png" alt="Novo lançamento no celular" width="260">
</p>

No celular o app é instalável (PWA), e uma compra é registrada em poucos segundos; um atalho do Apple Pay também manda o estabelecimento e o valor direto para a caixa "Para revisar".

## Decisões de engenharia

**A regra de negócio mora no banco.** O app lê views e chama funções; ele não calcula o resultado do mês nem quanto um projeto precisa. Isso é SQL, em 27 migrations numeradas, sem ORM: 30 tabelas, 10 views, 64 funções e 31 triggers. Algumas delas:

- `competencia_de()`: a que mês do orçamento uma compra no cartão pertence, pelo dia de fechamento do cartão.
- `lancar_parcelado()`: a compra parcelada lançada uma vez vira uma linha por fatura, ligadas à compra.
- `regra_categorizacao` + `normalizar()`: regras de categorização aprendidas do histórico e de cada correção feita à mão (dois terços dos lançamentos são categorizados sozinhos, com ~97% de acerto).
- `resultado_mes()` / `resultados_ano()`: realizado × orçado de cada linha, com o mês anterior, os ganhos como base da análise vertical e um filtro opcional por meio de pagamento.
- `projetos_situacao()`: o saldo de cada projeto estimado pelo CDI de cada mês e o aporte necessário até o prazo.
- `alocacao_carteira()` / `sugestao_aporte()`: peso de cada ativo × meta, e como dividir o próximo aporte para a carteira caminhar para a meta sem vender nada.
- `taxa_interna()` + `fator_ipca()`: taxa interna de retorno desde o primeiro aporte, nominal e real (descontado o IPCA).
- `guardar_varios()`: um depósito dividido entre vários bolsos é gravado tudo ou nada.

**Segurança por padrão.** Toda tabela tem segurança por linha (59 políticas) com dois papéis: quem edita e quem só lê. Sem login, a API não lê nada; a única função que uma chamada anônima alcança é a do atalho do Apple Pay, autenticada por um token guardado como hash. A chave secreta do Supabase nunca entra no app.

**Uma migração que se confere sozinha.** O histórico do ano foi carregado das planilhas por scripts em Python que se recusam a gravar se algum total mensal divergir da planilha. Depois, o demonstrativo do orçamento foi conferido contra a aba da planilha linha a linha. Esses scripts leem arquivos pessoais, então ficam no repositório privado.

**Dados abertos, nenhum dado pessoal para fora.** CDI, IPCA e dólar vêm da API pública do Banco Central, buscados pelo app só com a série e as datas. Renda, saúde e gastos da família não saem do banco escolhido.

**Decisões de produto nos detalhes.** Cada área do app tem uma cor, seguindo o horizonte de tempo do dinheiro (dia a dia, curto e médio prazo, longo prazo). Estorno é gasto negativo na categoria original, não renda. O orçado é o número grande e o realizado fica embaixo, colorido conforme a linha seja gasto (menos é melhor) ou poupança (mais é melhor).

## Como o projeto é tocado

- **Documentos primeiro.** Antes do código, um briefing e as decisões em [`docs/`](docs): a árvore de categorias, o schema, a stack e o plano de cada fase. Quando uma decisão muda, o documento muda junto.
- **Fases que substituem a planilha.** Lançamentos, depois orçamento e resultados, projetos, carteira e painéis. Cada fase só vai para produção depois de bater com a planilha que substitui.
- **Ciclos curtos com o usuário real.** Cada lote é testado no banco local e no navegador (computador e celular, claro e escuro), mostrado no local e só então publicado. O retorno de uso vira o próximo lote.
- **Programação em par com IA.** O projeto é feito com o [Claude Code](https://claude.com/claude-code): eu defino o produto, as regras e a ordem, e reviso o que entra; o agente implementa, testa e documenta. Os commits registram a coautoria.
- **Dado pessoal fica fora do repositório.** Planilhas, faturas e dumps ficam numa pasta fora do git. Esta vitrine é gerada por um script que tira o conteúdo pessoal e se recusa a publicar se achar um termo vetado; as telas usam dados fictícios.

## Stack

| Camada | Escolha |
|---|---|
| Banco e regras | Postgres (Supabase): migrations em SQL, views com `security_invoker`, funções plpgsql, triggers, RLS |
| App | React 19, TypeScript, Vite, PWA (vite-plugin-pwa), CSS e gráficos em SVG escritos à mão, temas claro e escuro |
| Publicação | Cloudflare Workers (arquivos estáticos) a cada push na `main`; migrations com `supabase db push` |
| Dados | API SGS do Banco Central (CDI, IPCA, dólar); migração única em Python (pandas, openpyxl) |
| Qualidade | `tsc`, oxlint; teste de acesso por papel (`scripts/testar_acesso.sql`); backups com teste de restauração |

```
app/                  o app (telas em src/telas, gráficos e utilitários em src/lib)
supabase/migrations/  o banco, em SQL numerado
supabase/seed.sql     a árvore de categorias, contas, cenários e bolsos
scripts/              dados fictícios, regras de categorização, limpeza de itens, backup, teste de acesso
docs/                 decisões e especificações
```

## Rodando localmente

Precisa de Docker (ou Colima), Supabase CLI e Node.

```bash
supabase start
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/dados_ficticios.sql
scripts/preparar_app_local.sh
npm --prefix app install
npm --prefix app run dev
```

O app abre em `http://localhost:5173` com um ano de dados fictícios e um usuário de teste criado pelo script (o login fica em `app/.env.local`).

## Documentos

- [`docs/06-fases-2-a-5.md`](docs/06-fases-2-a-5.md): orçamento, resultados, projetos, carteira e painéis, fase a fase.
- [`docs/02-schema.md`](docs/02-schema.md): tabelas, funções e convenções.
- [`docs/05-modelo-de-dados.md`](docs/05-modelo-de-dados.md): o modelo de dados, com exemplos.
- [`docs/01-categorias.md`](docs/01-categorias.md): a árvore de categorias.
- [`docs/03-stack.md`](docs/03-stack.md): a stack, o layout e o sistema de cores.
- [`CLAUDE.md`](CLAUDE.md): as regras do projeto, para pessoas e para o agente.

## Situação

Em uso diário. Próximos passos: importar a fatura do cartão em PDF e o extrato do banco em OFX, e depois um mês inteiro tocado só pelo app.

Projeto irmão: [Hub de Produtividade](https://github.com/gmcosta94/hub-produtividade-public), feito do mesmo jeito.

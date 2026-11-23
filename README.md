# Personal Finance Hub

**English** | [Português](README.pt-BR.md)

**A household finance system that replaced two long-lived spreadsheets: daily expenses, a monthly budget, savings projects and an investment portfolio, with every business rule written in SQL.**

React + TypeScript (PWA) · Postgres/Supabase with RLS · Cloudflare · Central Bank of Brazil open data

<p align="center">
  <img src="docs/imagens/paineis-computador.png" alt="Dashboards: net worth, goals and how much to save per month, budget versus actual" width="860">
</p>

<sub>The app's interface is in Portuguese. All screens use fictional data.</sub>

> Public showcase. Development happens in a private repository since November 11, 2026 (32 commits as of this update); this one holds the code, the decision documents and the screens, without personal data.

## The problem

For years, a couple's finances lived in two spreadsheets. Every expense was typed by hand, column by column (about 170 entries a month, 15% of them installments copied row by row); the budget was a tab of formulas only its author understood; savings projects (a trip, a car, the emergency fund) were projected with a fixed rate and a month count that drifted; and the investment portfolio sat in a third-party app that didn't follow the household's own categories. Paid finance apps were tried and dropped: none of them respected how this family classifies money or showed what they actually wanted to see.

The hub replaces the spreadsheets one piece at a time, with a relational database as the single source of truth. A phase only starts once the previous one has replaced its part of the spreadsheet, and each migration is checked against it line by line.

> **What it answers every month:** where the money went (and against what budget), how much of the income was saved, how much to put aside for each goal, and where to invest the next contribution without selling anything.

## How it fits together

```mermaid
flowchart LR
  subgraph Capture
    Shortcut[Apple Pay shortcut] --> Inbox[To review]
    Quick[Quick entry<br/>value, category, item] --> Entries
    Recurring[Recurring bills] --> Inbox
    Inbox --> Entries[Entries<br/>category, item, note<br/>month of the card bill]
  end
  subgraph Plan
    Budget[Monthly budget<br/>and scenarios]
  end
  subgraph Save
    Save1[Save: one transfer<br/>split across buckets] --> Buckets[Emergency fund<br/>portfolios, pension<br/>projects]
  end
  Entries --> Report[Results<br/>month by month]
  Budget --> Report
  Buckets --> Projects[Projects<br/>target, deadline, CDI]
  Buckets --> Portfolio[Investments<br/>target vs actual, IRR]
  Report --> Dashboards
  Projects --> Dashboards
  Portfolio --> Dashboards[Dashboards<br/>net worth and goals]
```

Every expense has a category (the fixed tree from the spreadsheet), an item (the kind of spending: "Groceries", "Eating out") and an optional free note (the place, the person). Money set aside is not an expense: it is a transfer into a bucket, which feeds projects, the portfolio and the savings rate.

## Screens

| | |
|---|---|
| ![Results report](docs/imagens/resultados-computador.png) | ![Investments](docs/imagens/investimentos-computador.png) |
| **Results**: the month-by-month report, like the spreadsheet tab it replaced. The percentage next to each value switches between *vs budget*, *vs previous month* (horizontal analysis) and *% of income* (vertical analysis), and the whole report can be filtered by payment method to match a card bill. | **Investments**: retirement and emergency fund side by side, return since the first contribution (IRR, nominal and real), and target versus actual per asset class, expandable to each asset. |
| ![Budget](docs/imagens/orcamento-computador.png) | ![Projects](docs/imagens/projetos-computador.png) |
| **Budget**: the planned amount in focus and the actual amount below, red only when spending goes over (saving more than planned is good). | **Projects**: how much is set aside for each goal, the monthly contribution needed to reach it on time, the next 12 months and a timeline. |

<p align="center">
  <img src="docs/imagens/lancamentos-computador.png" alt="Entries with the new entry sheet open" width="860">
</p>

**Entries**: the month's log with filters, and the entry sheet: the value is typed like on a card machine ("59821" becomes 598.21), categories come in the same order as the report, and "Save" splits one deposit across several buckets in a single transaction.

<p align="center">
  <img src="docs/imagens/paineis-celular.png" alt="Dashboards on mobile" width="260">
  &nbsp;&nbsp;
  <img src="docs/imagens/lancamento-celular.png" alt="New entry on mobile" width="260">
</p>

On mobile the app is installable (PWA), and a purchase is recorded in a few seconds; an Apple Pay shortcut can also send the merchant and the amount straight to the review inbox.

## Engineering decisions

**Business rules live in the database.** The app reads views and calls functions; it doesn't compute what a month's result is or how much a project needs. That is SQL, in 27 numbered migrations with no ORM: 30 tables, 10 views, 64 functions and 31 triggers. A few of them:

- `competencia_de()`: which budget month a card purchase belongs to, from the card's closing day.
- `lancar_parcelado()`: an installment purchase entered once becomes one row per bill, linked to the purchase.
- `regra_categorizacao` + `normalizar()`: categorization rules learned from history and from every manual correction (two thirds of entries are categorized automatically, with ~97% accuracy).
- `resultado_mes()` / `resultados_ano()`: actual versus budget for every line, with the previous month, income as the base for vertical analysis and an optional payment-method filter.
- `projetos_situacao()`: each project's balance estimated with the monthly CDI rate (the Brazilian interbank rate) and the contribution needed until its deadline.
- `alocacao_carteira()` / `sugestao_aporte()`: weight per asset versus target, and how to split the next contribution so the portfolio moves toward the target without selling.
- `taxa_interna()` + `fator_ipca()`: internal rate of return since the first contribution, nominal and real (inflation-adjusted with IPCA).
- `guardar_varios()`: a deposit split across several buckets is written all or nothing.

**Security by default.** Every table has row-level security (59 policies) with two roles: an editor and a read-only member. Without a login the API reads nothing; the only function an anonymous call can reach is the Apple Pay shortcut, authenticated by a hashed token. The secret service key never goes into the app.

**A migration that reconciles itself.** The year's history was loaded from the spreadsheets by Python scripts that refuse to write anything if any monthly total diverges from the spreadsheet. The budget report was then checked against the spreadsheet tab line by line. Those scripts read personal files, so they stay in the private repository.

**Open data, no personal data out.** CDI, IPCA and the dollar rate come from the Central Bank's public API, fetched by the app with only the series and the dates. Income, health and spending data never leave the chosen database.

**Product decisions in the details.** Each area of the app has its own color, following the money's time horizon (day to day, short and medium term, long term). Refunds are negative expenses in the original category, not income. The planned amount is the big number and the actual sits below it, colored by whether the line is spending (lower is better) or saving (higher is better).

## How the project is run

- **Docs first.** Before code, a brief and the decisions in [`docs/`](docs) (in Portuguese): the category tree, the schema, the stack, and the plan of each phase. When a decision changes, the document changes with it.
- **Phases that replace the spreadsheet.** Entries, then budget and results, projects, portfolio, and dashboards. Each phase goes to production only after it matches the spreadsheet it replaces.
- **Short cycles with the real user.** Each batch is tested on the local database and in the browser (desktop and mobile, light and dark), shown locally and only then published. Usage feedback becomes the next batch.
- **Pair programming with AI.** The project is built with [Claude Code](https://claude.com/claude-code): I define the product, the rules and the order, and review what goes in; the agent implements, tests and documents. Commits record the co-authorship.
- **Personal data stays out of the repository.** Spreadsheets, bills and dumps live in a folder outside git. This showcase is generated by a script that removes personal content and refuses to publish if it finds a vetoed term; the screens use fictional data.

## Stack

| Layer | Choice |
|---|---|
| Database and rules | Postgres (Supabase): SQL migrations, views with `security_invoker`, plpgsql functions, triggers, RLS |
| App | React 19, TypeScript, Vite, PWA (vite-plugin-pwa), hand-written CSS and SVG charts, light and dark themes |
| Deployment | Cloudflare Workers (static assets) on every push to `main`; migrations with `supabase db push` |
| Data | Central Bank of Brazil SGS API (CDI, IPCA, USD); one-off migration in Python (pandas, openpyxl) |
| Quality | `tsc`, oxlint; an access test per role (`scripts/testar_acesso.sql`); backups with a test restore |

```
app/                  the app (screens in src/telas, charts and helpers in src/lib)
supabase/migrations/  the database, as numbered SQL
supabase/seed.sql     the category tree, accounts, scenarios and buckets
scripts/              fictional data, categorization rules, item cleanup, backup, access test
docs/                 decisions and specifications
```

## Running locally

Requires Docker (or Colima), the Supabase CLI and Node.

```bash
supabase start
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/dados_ficticios.sql
scripts/preparar_app_local.sh
npm --prefix app install
npm --prefix app run dev
```

The app opens at `http://localhost:5173` with a year of fictional data and a test user created by the script (its login is written to `app/.env.local`).

## Documents (in Portuguese)

- [`docs/06-fases-2-a-5.md`](docs/06-fases-2-a-5.md): budget, results, projects, portfolio and dashboards, phase by phase.
- [`docs/02-schema.md`](docs/02-schema.md): tables, functions and conventions.
- [`docs/05-modelo-de-dados.md`](docs/05-modelo-de-dados.md): the data model, with worked examples.
- [`docs/01-categorias.md`](docs/01-categorias.md): the category tree.
- [`docs/03-stack.md`](docs/03-stack.md): the stack, the layout and the color system.
- [`CLAUDE.md`](CLAUDE.md): the project rules, for people and for the agent.

## Status

In daily use. Next steps: importing the card's PDF bill and the bank's OFX statement, then a full month run entirely from the app.

Sibling project: [Productivity Hub](https://github.com/gmcosta94/hub-produtividade-public), built the same way.

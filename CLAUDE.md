# Hub financeiro pessoal

Só a fatura do cartão não é exportável (PDF de fatura fechada). O extrato da conta corrente sai em OFX, XLSX e PDF; o app importa o OFX.

## Regras do projeto

- Responder em português.
- `dados/` guarda planilhas exportadas, faturas e dumps. Fica fora do git e nunca deve ser versionado, nem ter o conteúdo copiado para arquivos versionados (exemplos em docs e testes usam valores fictícios).
- Dados de renda, saúde e despesas da família não vão para logs nem para serviços externos além do banco escolhido.
- Banco relacional é a fonte única. SQL explícito em migrations legíveis; sem ORM gerando schema.
- Trabalho por fases (`docs/04-fase-1.md` e `docs/06-fases-2-a-5.md`). Uma fase só começa quando a anterior substituiu o pedaço correspondente da planilha.
- Especificações e decisões ficam em `docs/`.

## Como rodar (banco local)

```bash
colima start                                   # Docker leve; necessário para o Supabase local
supabase start -x studio,imgproxy,storage-api,realtime,logflare,vector,edge-runtime,supavisor,postgres-meta,mailpit
supabase db reset                              # recria o banco: migrations + seed.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/dados_ficticios.sql   # dados fictícios
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/gerar_regras.sql
# A série do CDI o app busca sozinho no Banco Central ao abrir a tela Projetos.
# O IPCA e o dólar o app busca sozinho no Banco Central ao abrir a tela Carteira.
scripts/backup.sh --testar                     # dump em dados/backups/ + teste de restauração
```

App (React + Vite, em `app/`):

```bash
scripts/preparar_app_local.sh   # grava app/.env.local e cria o usuário de teste local (refazer após db reset)
npm --prefix app run dev        # http://localhost:5173, apontando para o banco local
npm --prefix app run build && npm --prefix app run lint
```

- O app lê views `v_*` do banco em vez de montar joins; regra de negócio fica em SQL.
- View nova precisa de `security_invoker = true`, `revoke all ... from anon` e `grant select ... to authenticated`.
- `psql` e `pg_dump` vêm do libpq do Homebrew: `/opt/homebrew/opt/libpq/bin`.
- Tabela nova em `public` precisa chamar `select aplicar_acesso_padrao('nome')` na própria migration.
- `normalizar()` (migration 1) é a única definição de "mesma descrição"; não reimplementar fora do banco.

## Estrutura

- `supabase/migrations/` — schema em SQL numerado; `supabase/seed.sql` — categorias, contas, cenários, bolsos.
- `scripts/` — dados fictícios, geração de regras, limpeza de itens, backup.

- Vitrine pública: este repositório é privado; `scripts/publicar_vitrine.sh` copia a `main` para `gmcosta94/hub-financeiro-public`, sem o briefing, a pasta `.claude`, os scripts de carga e o próprio script, trocando trechos pessoais e recusando termos vetados. As telas do README usam `scripts/dados_ficticios.sql`. Rodar depois de publicar algo que deva aparecer lá.
- `dados/` — arquivos pessoais, ignorados pelo git.
- `docs/` — schema, árvore de categorias, stack, planos de fase.

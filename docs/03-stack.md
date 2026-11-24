# Stack — proposta

## Recomendação

| Camada | Escolha | Por quê |
|---|---|---|
| Banco, login, acesso por linha | **Supabase** (Postgres gerenciado) | Já decidido no briefing. Traz autenticação e políticas por linha sem servidor próprio. |
| Regras de negócio | **SQL no Postgres**: views e funções em migrations | É a parte que o autor lê e mantém. Realizado × orçado, taxa de poupança, projeção de projetos e alocação ficam em SQL, não escondidos em código de tela. O Power BI depois lê as mesmas views. |
| Migrations | **Supabase CLI**, arquivos `.sql` numerados em `supabase/migrations/` | SQL puro, versionado, sem ORM. |
| App | **React + TypeScript + Vite**, como PWA | Site estático: sem servidor para manter. Instala no iPhone e no iPad pela tela de início. |
| Hospedagem do app | **Cloudflare Pages** | Gratuito, publica a cada push no GitHub, HTTPS incluído. |
| Endpoint do atalho do iOS | **Supabase Edge Function** | Recebe estabelecimento e valor do app Atalhos e grava um lançamento pendente. Única peça de código no servidor na fase 1. |
| Leitura da fatura em PDF | **No navegador** (pdf.js) com um leitor por emissor | O PDF nunca sai do aparelho; só as linhas extraídas vão para o banco. |
| Migração do histórico | **Python** (pandas), script em `scripts/` | Roda uma vez, na linguagem que o autor já usa. |

## Layout: celular e computador (17/11/2026)

Uma base de código, dois arranjos, com o ponto de quebra em 1024px. O mesmo valor está em `app/src/index.css` (seção "Computador") e em `app/src/lib/tela.ts`.

- **Abaixo de 1024px (celular e tablet em pé):** fica como sempre foi. Abas no topo, coluna única de até 640px, folhas de edição subindo de baixo.
- **A partir de 1024px (computador):**
  - Coluna lateral fixa com as abas, Cadastros, Atalho e Sair, e o conteúdo com até 1280px.
  - Folhas de edição viram uma janela no meio da tela.
  - Cada tela ganha sua grade:
    - Painéis em duas colunas, com o gráfico de gastos mostrando a lista e o detalhe lado a lado;
    - Lançamentos com os controles fixos à esquerda e o extrato à direita;
    - Orçamento com os blocos em duas colunas;
    - Projetos com os cartões em grade;
    - Carteira com alocação de um lado e satélite, previdência e rentabilidade do outro.
- **Ajuste fino dentro dos cartões:** por consulta de contêiner, e não de janela, porque no computador um cartão pode ser estreito.

## Atualização do app instalado (24/11/2026)

O app guarda os próprios arquivos no aparelho (PWA), então uma aba aberta continuava na versão antiga depois de cada publicação. Agora `app/src/lib/atualizacao.ts` cuida disso:

- **Quando procura:** ao abrir, a cada meia hora e sempre que a aba volta a ficar visível.
- **Quando troca:** recarrega sozinho na versão nova, mas só quando nada está sendo editado (nenhuma folha aberta e nenhum campo em foco). Enquanto houver, espera.
- **Configuração:** o service worker está em `registerType: 'prompt'`. Quem decide a hora da troca é o app, não o `autoUpdate`, que recarregaria no meio de um lançamento.

## Cores (18/11/2026)

**Superfícies:** fundo "gelo" (`#f1f3f5`, cinza bem claro e levemente frio); cartões, folhas e menu lateral em branco.

**Cor de destaque por área do app, pelo horizonte de tempo do dinheiro:**

| Área | Telas | Cor (claro / escuro) |
|---|---|---|
| Visão geral | Painéis e Cadastros | grafite `#3b4a5c` / `#b6c2d1` |
| Dia a dia | Lançamentos, Orçamento e Resultados | verde-água `#0f766e` / `#5cc2b1` |
| Curto e médio prazo | Projetos | azul-marinho `#004376` / `#7db4e3` |
| Longo prazo | Carteira | índigo `#4b52b8` / `#a3aaf0` |

- **No CSS:** as cores ficam em `--area-*`, e a classe `area-*` (aplicada na aba e no conteúdo) troca `--destaque`. Tudo que já usava `--destaque` (botões, abas, fichas, barras) muda sozinho.
- **Contraste:** todas passam AA com texto branco, no claro, e com o fundo, no escuro.
- **Cores de estado (`--receita`, `--alerta`) e dos gráficos (`--serie-*`):** continuam separadas da cor da área.

## Alternativas descartadas

- **Next.js ou SvelteKit com servidor**: resolvem problemas que este app não tem (SEO, renderização no servidor) e acrescentam um servidor para manter.
- **Backend em Python (FastAPI)**: seria a linguagem do autor, mas exige hospedar e manter um serviço ligado o tempo todo. Com a lógica em SQL, o backend quase não existe.
- **Streamlit ou similar**: rápido para dashboard, ruim para lançar no celular em dois toques e não vira PWA decente.
- **Power Apps**: já descartado no briefing.

## Custo

- Supabase gratuito: 500 MB de banco (o histórico de um ano ocupa poucos MB), dois projetos ativos.
- Cloudflare Pages gratuito.
- Domínio próprio: opcional. O endereço padrão gratuito funciona.
- **Total previsto: R$ 0/mês.**

## Custo de manutenção e riscos

1. **Pausa por inatividade**: o plano gratuito do Supabase pausa projetos sem uso por 7 dias. Com uso diário não ocorre; se ocorrer, é retomar no painel.
2. **Sem backup automático no plano gratuito.** Mitigação: script de `pg_dump` semanal salvando em `dados/` (fora do git) ou no iCloud. Entra na fase 0.
3. **TypeScript/React não é a linguagem do autor.** Mitigação: telas finas, regra em SQL. Mudar uma conta ou um indicador é mexer numa view.
4. **Leitor de PDF por emissor quebra quando o banco muda o layout.** Mitigação: colagem de texto como alternativa sempre disponível, e o total da fatura como conferência.
5. **Atualizações de dependências**: poucas bibliotecas, atualização a cada alguns meses.

## Ferramentas a instalar no Mac

Instalados em 11/11/2026 via Homebrew: Node.js, Supabase CLI, Colima + Docker CLI (substituem o Docker Desktop, sem interface nem licença) e libpq (`psql`, `pg_dump`). Python 3 já existia; as dependências dos scripts ficam em `.venv/`.

## Ponto que precisa de decisão: modelo de linguagem

O briefing pede sugestão de categoria por modelo de linguagem para descrições nunca vistas, e também pede que nada vá para serviços externos além do banco. As duas coisas conflitam. Opções:

- **A (recomendada para a fase 1)**: só regras. Cobrem cerca de dois terços com 97% de acerto; o resto é revisado à mão e cada correção vira regra, então a cobertura sobe sozinha.
- **B**: enviar ao modelo apenas o texto da descrição (sem valor, data ou conta) junto com a lista de categorias. Baixo risco, mas é um serviço externo a mais.

Sugestão: começar com A, medir quantos lançamentos por mês ficam sem regra depois de dois meses, e só então decidir sobre B.

## Estrutura de pastas prevista

```
supabase/
  migrations/     # SQL numerado: schema, views, funções, políticas
  functions/      # endpoint do atalho
  seed/           # categorias, cenários, contas (sem valores pessoais)
app/              # React + Vite (PWA)
scripts/          # migração do histórico, backup
docs/
dados/            # fora do git
```

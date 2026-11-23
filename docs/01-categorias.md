# Categorias — estrutura validada em 11/11/2026, revista em 13/11/2026

Fonte: aba `Planejamento de Cenários` e logs `Gastos` e `Ganhos` de 2026. As abas ocultas foram descartadas. Sem valores: só a estrutura.

## Como funciona

- Dois níveis de classificação e um campo livre: **categoria** (obrigatória) → **item** (o tipo de gasto: "Refeições Fora", "Compras de Mercado", "Estacionamento e Pedágio") → **observação** (o detalhe daquela vez: "Mamma Jamma", "Pão de Açúcar", "Aula Pet").
- O item é o que se soma e se analisa; a observação descreve e não agrupa. Em categorias pequenas o item é a própria conta (Condomínio, Conta de Luz, Seguro Azos).
- Ao escolher o item, o app sugere as observações mais usadas dele. O que chega do Apple Pay, da fatura ou do extrato entra com o texto de origem (o comerciante) na observação e o item sugerido pelas regras, para confirmar ou trocar.
- Até 13/11/2026 existia uma subcategoria pendurada no item. Ela virou o próprio item (as antigas subcategorias são os itens de hoje) e a tabela foi removida: três níveis mais a observação era granularidade demais.
- O orçamento é por categoria ou por item.
- Receitas usam o mesmo mecanismo: a categoria é o tipo de renda e o item é a fonte.

## Três destinos da renda

| Destino | Grupos | Conta na taxa de poupança |
|---|---|---|
| Gastos do mês | Custo de Vida, Fora do Custo de Vida | Não |
| Metas (consumo adiado ou grande) | Projetos Futuros, Projetos Realizados | Não |
| Poupança e Investimentos | Reserva, Carteiras, Amortização, Seguro de Vida | Sim, exceto Seguro de Vida |

**Taxa de poupança = (aportes em reserva, carteiras e amortização extra − resgates) ÷ renda.**

## Ganhos (receita)

- **Salário Principal** — itens: um por empregador (salário, pró-labore)
- **Rendas Paralelas** — itens: um por cliente ou trabalho paralelo
- **Outros** — itens: Benefícios, Bônus e 13º, Restituição de IR, Presentes

## Custo de Vida (despesa)

- **Moradia** — itens: Financiamento, Condomínio, IPTU
- **Contas de Casa** — itens: Luz, Gás, Vivo, Claro TV + Net
- **Mercado e Alimentação** — itens: Compras de Mercado · Feira · Padaria · Quentinhas · Almoço e café fora
- **Transporte** — itens: Combustível · Estacionamento e Pedágio · Seguro e Manutenção · Ônibus e Apps
- **Saúde** — itens: Remédios e Vitaminas · Terapias e Consultas · Exames e Vacinas · Atividade Física
- **Pet** — itens: Ração e Petiscos · Saúde · Banho · Escolinha · Acessórios

## Fora do Custo de Vida (despesa)

- **Lazer** — itens: Refeições Fora · Comes e bebes · Streamings e Assinaturas · Compras · Viagens e passeios · Cabelo e beleza · Churrasco e festas
- **Conhecimento** — itens: Cursos e Comunidades (o curso na observação) · Ferramentas (Claude, Seguro Mac)
- **Caridade** — itens: um por instituição
- **Gastos Extras** — itens: Tarifas e Seguros de Cartão · Serviços da Casa · Coisas para casa · Outros gastos

## Metas

- **Projetos Futuros** — não é categoria de lançamento: é aporte em um projeto (viagem, troca de carro, reforma, educação dos filhos). Cada projeto tem saldo, alvo e aporte necessário.
- **Projetos Realizados** (despesa) — o que é pago: casa nova, enxoval, viagem. Pode ser ligado a um projeto.

Regra de contagem no realizado de Metas do mês:

1. Aporte em projeto conta.
2. Gasto pago com a renda do mês conta.
3. Gasto pago com saldo de projeto baixa o saldo do projeto e não conta de novo.
4. Gasto antecipado de um projeto futuro (o hotel de uma viagem do fim do ano, a assinatura de alertas de milhas para planejá-la): é despesa ligada ao projeto (`projeto_id`), paga com a renda do mês. Conta no realizado de Metas do mês e no avanço do projeto, mas não é saldo do bolso: não está guardado nem rendendo. Avanço do projeto = saldo do bolso + gastos antecipados; o aporte necessário sai do que falta. (Fase 3.)

## Poupança e Investimentos

Não é categoria de despesa. Ao lançar "Investimentos", escolhe-se o destino:

- **Reserva de Emergência** — seção própria em Investimentos, com alvo e saldo.
- **Carteira Principal / Carteira Satélite** — o objetivo delas é a aposentadoria.
- **Previdência** — bolso à parte (desde 13/11/2026), fora das metas das carteiras; conta na taxa de poupança.
- **Amortização extra do apartamento.**
- **Seguro de Vida** — único destino que é despesa (proteção, não resgatável). Aparece no grupo, fica fora da taxa de poupança e do patrimônio.

A parcela normal do financiamento continua em Moradia.

## Fora do escopo por ora

Gastos pessoais de cada um e custos da PJ não são lançados no app. Seguem apenas como desconto fixo no orçamento, antes do líquido do casal: o grupo **Descontos** (Pessoal A, Pessoal B, Custos da PJ) existe só no orçamento e não aparece na tela de lançamento.

## Observações para a migração

- A categoria "Investimentos" do log se divide em: seguros → Seguro de Vida; assinatura de curso → Conhecimento; aportes, poupança e reservas → transferências; resgates → transferências no sentido contrário.
- A categoria "Metas" do log vira Projetos Realizados.
- Fontes antigas deixam de ser ativas; o histórico é mantido como item inativo.
- Estornos (15 linhas negativas fora de Investimentos) migram como lançamento negativo na mesma categoria.
- A migração cria um item por descrição da planilha (835 em 2026); `scripts/limpar_itens.py` os agrupa nos itens acima e passa o detalhe para a observação (plano em `dados/limpeza/`, fora do git).

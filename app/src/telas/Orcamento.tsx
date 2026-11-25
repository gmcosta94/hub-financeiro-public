import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { centavosTexto, competenciaAtual, nomeDoMes, paraNumero, reais, somarMeses } from '../lib/formato'

// Destinos em que passar do orçado é ruim (gasto e desconto).
const GASTO = new Set(['gasto_do_mes', 'desconto'])

/**
 * Orçamento do mês: realizado × orçado nas linhas da aba Resultados.
 * Cada linha expande nos itens (ou bolsos), como linhas agrupadas de planilha, e o
 * orçado de cada item se edita ali mesmo; o total da linha é a soma. "Outros gastos"
 * guarda o valor sem detalhe. Cenários são modelos com a mesma forma.
 * Toda a conta está no banco (resultado_mes, orcamento_detalhe, orcar_linha).
 */

type Linha = {
  bloco: string
  bloco_ordem: number
  linha_id: number
  nome: string
  destino: string
  orcado: number
  realizado: number | null
  detalhado: boolean
}
type Parte = {
  tipo: 'item' | 'bolso' | 'categoria' | 'outros'
  ref_id: number | null
  nome: string
  orcado: number
  realizado: number | null
  sugerido: number | null // aporte necessário do projeto (só nos bolsos de projeto)
}
type Cenario = { id: number; nome: string }

const chaveParte = (p: Parte) => `${p.tipo}:${p.ref_id ?? ''}`
const semChave = (o: Record<string, string>, k: string) => {
  const n = { ...o }
  delete n[k]
  return n
}
const parametrosDe = (modo: 'mes' | 'cenario', competencia: string, cenarioId: number | null) =>
  modo === 'mes'
    ? { p_competencia: competencia, p_cenario_id: null }
    : { p_competencia: null, p_cenario_id: cenarioId }
const pct = (real: number | null, orc: number) => (real === null || !orc ? null : Math.round((real / orc) * 100))
const percentual = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`)

export function Orcamento({ podeEditar }: { podeEditar: boolean }) {
  const [modo, setModo] = useState<'mes' | 'cenario'>('mes')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [cenarios, setCenarios] = useState<Cenario[]>([])
  const [cenarioId, setCenarioId] = useState<number | null>(null)
  const [versao, setVersao] = useState(0)
  const [resultado, setResultado] = useState<{
    chave: string
    contexto: string
    linhas: Linha[]
    poupanca: { orcado: number; realizado: number | null }
  } | null>(null)
  // Recarrega os itens abertos só quando o mês inteiro muda (preencher com cenário);
  // gravar um item atualiza a própria linha na hora, sem recarregar nada.
  const [versaoItens, setVersaoItens] = useState(0)
  // Linhas expandidas (pelo id da linha), como grupos de linhas numa planilha.
  const [abertas, setAbertas] = useState<Set<number>>(() => new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [preencher, setPreencher] = useState(false)
  const [versaoCenarios, setVersaoCenarios] = useState(0)

  useEffect(() => {
    supabase
      .from('cenario')
      .select('id,nome')
      .order('ordem')
      .then(({ data }) => setCenarios((data ?? []) as Cenario[]))
  }, [versaoCenarios])

  const cenarioEscolhido = (cenarios.some((c) => c.id === cenarioId) ? cenarioId : null) ?? cenarios[0]?.id ?? null
  const contexto = `${modo}|${competencia}|${cenarioEscolhido}`

  useEffect(() => {
    if (modo === 'cenario' && cenarioEscolhido === null) return
    let cancelado = false
    const p = parametrosDe(modo, competencia, cenarioEscolhido)
    const chaveDoPedido = `${modo}|${competencia}|${cenarioEscolhido}|${versao}`
    Promise.all([supabase.rpc('resultado_mes', p), supabase.rpc('poupanca_mes', p)]).then(([r, po]) => {
      if (cancelado) return
      const pp = (po.data as { orcado: number; realizado: number | null }[] | null)?.[0]
      setResultado({
        chave: chaveDoPedido,
        contexto: `${modo}|${competencia}|${cenarioEscolhido}`,
        linhas: (r.data ?? []) as Linha[],
        poupanca: pp ?? { orcado: 0, realizado: null },
      })
    })
    return () => {
      cancelado = true
    }
  }, [modo, competencia, cenarioEscolhido, versao])

  // Mesmo mês ou cenário: continua mostrando os números enquanto os novos chegam
  // (depois de gravar um item, a tela não pisca nem mostra "Carregando").
  const atual = resultado?.contexto === contexto ? resultado : null
  const linhas = useMemo(() => atual?.linhas ?? [], [atual])
  const mostrarRealizado = modo === 'mes'

  const blocos = useMemo(() => {
    const grupos: { nome: string; ordem: number; linhas: Linha[] }[] = []
    for (const l of linhas) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo.nome === l.bloco) ultimo.linhas.push(l)
      else grupos.push({ nome: l.bloco, ordem: l.bloco_ordem, linhas: [l] })
    }
    return grupos
  }, [linhas])

  const soma = (f: (l: Linha) => boolean, campo: 'orcado' | 'realizado') =>
    linhas.filter(f).reduce((s, l) => s + (l[campo] ?? 0), 0)
  const ehRenda = (l: Linha) => l.destino === 'receita'
  const ehDesconto = (l: Linha) => l.destino === 'desconto'
  const ehSaida = (l: Linha) => !ehRenda(l) && !ehDesconto(l)
  const total = (campo: 'orcado' | 'realizado') => {
    const renda = soma(ehRenda, campo)
    const descontos = soma(ehDesconto, campo)
    const saidas = soma(ehSaida, campo)
    return { renda, liquido: renda - descontos, saidas, saldo: renda - descontos - saidas }
  }
  const orc = total('orcado')
  const rea = total('realizado')
  const taxaOrc = orc.renda ? (atual?.poupanca.orcado ?? 0) / orc.renda : null
  const taxaRea = rea.renda && atual?.poupanca.realizado != null ? atual.poupanca.realizado / rea.renda : null

  function avisar(m: string) {
    setAviso(m)
    setTimeout(() => setAviso(null), 2500)
  }

  async function preencherCom(origem: 'anterior' | number) {
    setPreencher(false)
    const { error } =
      origem === 'anterior'
        ? await supabase.rpc('copiar_orcamento', { p_de: somarMeses(competencia, -1), p_para: competencia })
        : await supabase.rpc('aplicar_cenario', { p_cenario_id: origem, p_competencia: competencia })
    if (error) avisar('Não foi possível preencher.')
    else {
      setVersao((v) => v + 1)
      setVersaoItens((v) => v + 1)
      avisar('Orçamento do mês preenchido. Ajuste o que quiser.')
    }
  }

  const nomeCenario = cenarios.find((c) => c.id === cenarioEscolhido)?.nome

  return (
    <main className="orcamento">
      <div className="controles-orc">
        <div className="segmentos pequenos">
          <button type="button" className={modo === 'mes' ? 'ativo' : undefined} onClick={() => setModo('mes')}>
            Mês
          </button>
          <button type="button" className={modo === 'cenario' ? 'ativo' : undefined} onClick={() => setModo('cenario')}>
            Cenários
          </button>
        </div>

        {modo === 'mes' ? (
          <header className="mes">
            <button aria-label="Mês anterior" onClick={() => setCompetencia((c) => somarMeses(c, -1))}>
              ‹
            </button>
            <h1>{nomeDoMes(competencia)}</h1>
            <button aria-label="Mês seguinte" onClick={() => setCompetencia((c) => somarMeses(c, 1))}>
              ›
            </button>
          </header>
        ) : (
          <div className="fichas cenarios">
            {cenarios.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === cenarioEscolhido ? 'ativo' : undefined}
                onClick={() => setCenarioId(c.id)}
              >
                {c.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="resumo-orc">
        {/* Como nas linhas: o orçado em destaque e o realizado embaixo, na cor da regra. */}
        <Cartao rotulo="Renda líquida" real={mostrarRealizado ? rea.liquido : null} orcado={orc.liquido} cor="no-limite" />
        <Cartao rotulo="Investido + gasto" real={mostrarRealizado ? rea.saidas : null} orcado={orc.saidas} cor="no-limite" />
        <Cartao
          rotulo="Saldo"
          real={mostrarRealizado ? rea.saldo : null}
          orcado={orc.saldo}
          sinal
          cor={rea.saldo < 0 ? 'estourou' : 'no-limite'}
        />
        <div>
          <span>Taxa de poupança</span>
          <strong>{percentual(taxaOrc)}</strong>
          {mostrarRealizado && (
            <small className={`realizado-resumo ${(taxaRea ?? 0) < (taxaOrc ?? 0) ? 'estourou' : 'no-limite'}`}>
              realizado {percentual(taxaRea)}
            </small>
          )}
        </div>
      </section>

      {/* Ações do mês à esquerda; expandir ou recolher todas as linhas à direita. */}
      <div className="linha-acoes-orc">
        {podeEditar && modo === 'mes' && (
          <div className="acoes-orc">
            {preencher ? (
              <>
                <span className="rotulo">Substituir o orçamento do mês por:</span>
                <div className="fichas">
                  <button type="button" onClick={() => preencherCom('anterior')}>
                    Mês anterior
                  </button>
                  {cenarios.map((c) => (
                    <button key={c.id} type="button" onClick={() => preencherCom(c.id)}>
                      {c.nome}
                    </button>
                  ))}
                  <button type="button" className="discreto" onClick={() => setPreencher(false)}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="discreto" onClick={() => setPreencher(true)}>
                Preencher com cenário ou mês anterior…
              </button>
            )}
          </div>
        )}
        {modo === 'cenario' && (
          <div className="sobre-cenario">
            {nomeCenario ? (
              <p className="origem">
                Cenário {nomeCenario}: um modelo para preencher meses. Mudanças aqui não alteram meses já orçados.
              </p>
            ) : (
              <p className="origem">Nenhum cenário ainda.</p>
            )}
            {podeEditar && (
              <GerenciarCenarios
                key={cenarioEscolhido ?? 'nenhum'}
                cenarios={cenarios}
                escolhido={cenarios.find((c) => c.id === cenarioEscolhido) ?? null}
                onMudou={(id, mensagem) => {
                  setVersaoCenarios((v) => v + 1)
                  setCenarioId(id)
                  avisar(mensagem)
                }}
              />
            )}
          </div>
        )}
        {atual && (
          <div className="expandir-orc">
            <button
              type="button"
              className="link"
              onClick={() => setAbertas(abertas.size > 0 ? new Set() : new Set(blocos.flatMap((b) => b.linhas.map((l) => l.linha_id))))}
            >
              {abertas.size > 0 ? 'Recolher todas' : 'Expandir todas as categorias'}
            </button>
          </div>
        )}
      </div>

      {!atual && !(modo === 'cenario' && cenarios.length === 0) && <p className="vazio">Carregando…</p>}

      {/* Duas colunas fixas (no computador): renda, descontos, poupança e metas à
          esquerda; custo de vida e o que fica fora dele à direita. Colunas automáticas
          do CSS não se redistribuem direito quando uma linha expande e recolhe. */}
      <div className="blocos-orc">
        {[blocos.filter((b) => b.ordem <= 4), blocos.filter((b) => b.ordem > 4)].map((coluna, i) => (
          <div key={i} className="coluna-orc">
            {coluna.map((b) => {
              const bo = b.linhas.reduce((s, l) => s + l.orcado, 0)
              const br = b.linhas.reduce((s, l) => s + (l.realizado ?? 0), 0)
              // Bloco de gasto acima do orçado fica vermelho; ganhar, poupar e cumprir metas
              // além do orçado é bom.
              const blocoEstourou = bo > 0 && br > bo && b.linhas.some((l) => GASTO.has(l.destino))
              return (
                <section key={b.nome} className="bloco-orc">
                  <h2>
                    <span>{b.nome}</span>
                    <span className="totais-bloco">
                      <span>{reais(bo)}</span>
                      {mostrarRealizado && (
                        <small className={bo > 0 ? (blocoEstourou ? 'estourou' : 'no-limite') : undefined}>{reais(br)}</small>
                      )}
                    </span>
                  </h2>
                  <ul>
                    {b.linhas.map((l) => {
                      const p = pct(l.realizado, l.orcado)
                      // Vermelho só para gasto acima do orçado; investir e cumprir metas além do
                      // orçado é bom (fica na cor normal), como na aba Resultados.
                      const estourou = p !== null && p > 100 && GASTO.has(l.destino)
                      return (
                        <li key={l.linha_id}>
                          <button
                            type="button"
                            className="linha-orc"
                            aria-expanded={abertas.has(l.linha_id)}
                            onClick={() =>
                              setAbertas((a) => {
                                const n = new Set(a)
                                if (n.has(l.linha_id)) n.delete(l.linha_id)
                                else n.add(l.linha_id)
                                return n
                              })
                            }
                          >
                            <span className="nome">
                              <span className="seta" aria-hidden="true">
                                {abertas.has(l.linha_id) ? '▾' : '▸'}
                              </span>
                              {l.nome}
                              {l.detalhado && <small className="parcela">detalhado</small>}
                            </span>
                            {/* Orçado em destaque; o realizado embaixo, na cor da barra. */}
                            <span className="numeros">
                              <span className="real">{l.orcado ? reais(l.orcado) : 'sem orçamento'}</span>
                              {mostrarRealizado && (
                                <span className={`orc realizado${l.orcado > 0 ? (estourou ? ' estourou' : ' no-limite') : ''}`}>
                                  {reais(l.realizado ?? 0)}
                                </span>
                              )}
                            </span>
                            {mostrarRealizado && l.orcado > 0 && (
                              <span className="barra" aria-hidden="true">
                                <span
                                  className={estourou ? 'estourou' : undefined}
                                  style={{ width: `${Math.min(p ?? 0, 100)}%` }}
                                />
                              </span>
                            )}
                          </button>
                          {abertas.has(l.linha_id) && (
                            <DetalheLinha
                              linha={l}
                              parametros={parametrosDe(modo, competencia, cenarioEscolhido)}
                              mostrarRealizado={mostrarRealizado}
                              podeEditar={podeEditar}
                              recarga={versaoItens}
                              onSalvo={() => setVersao((v) => v + 1)}
                              onErro={avisar}
                            />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        ))}
      </div>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

    </main>
  )
}

/** Cartão do resumo: o orçado em destaque e, embaixo, o realizado na cor da regra. */
function Cartao({
  rotulo,
  real,
  orcado,
  sinal,
  cor,
}: {
  rotulo: string
  real: number | null
  orcado: number
  sinal?: boolean
  cor: 'no-limite' | 'estourou'
}) {
  return (
    <div>
      <span>{rotulo}</span>
      <strong className={sinal && orcado < 0 ? 'negativo' : undefined}>{reais(orcado)}</strong>
      {real !== null && <small className={`realizado-resumo ${cor}`}>realizado {reais(real)}</small>}
    </div>
  )
}

/** O "pop-up" da linha: valor cheio ou detalhe por item, com o total somando. */
/**
 * Itens de uma linha, expandidos embaixo dela, editados como células de planilha:
 * o orçado de cada um (quem edita digita "300" e vira 300,00; centavos com vírgula)
 * grava ao sair do campo e já aparece na hora, sem recarregar a tela. O realizado
 * vem embaixo, na cor da regra. O total da linha é a soma; "Outros gastos" é o
 * valor sem detalhe.
 */
function DetalheLinha({
  linha,
  parametros,
  mostrarRealizado,
  podeEditar,
  recarga,
  onSalvo,
  onErro,
}: {
  linha: Linha
  parametros: { p_competencia: string | null; p_cenario_id: number | null }
  mostrarRealizado: boolean
  podeEditar: boolean
  recarga: number
  onSalvo: () => void
  onErro: (m: string) => void
}) {
  const { p_competencia: pCompetencia, p_cenario_id: pCenario } = parametros
  const linhaId = linha.linha_id
  // Item criado aqui: recarrega a linha e já põe o cursor no valor dele.
  const [criados, setCriados] = useState(0)
  const [focar, setFocar] = useState<string | null>(null)
  const [novoItem, setNovoItem] = useState<string | null>(null)
  const chave = `${linhaId}|${pCompetencia}|${pCenario}|${recarga}|${criados}`
  const [carga, setCarga] = useState<{ chave: string; partes: Parte[] } | null>(null)
  // Texto do campo enquanto está sendo editado (por parte).
  const [textos, setTextos] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('orcamento_detalhe', { p_linha_id: linhaId, p_competencia: pCompetencia, p_cenario_id: pCenario })
      .then(({ data }) => {
        if (!cancelado) setCarga({ chave, partes: (data ?? []) as Parte[] })
      })
    return () => {
      cancelado = true
    }
  }, [chave, linhaId, pCompetencia, pCenario])

  if (!carga) return <p className="itens-orc-carregando">Carregando…</p>
  // Itens ficam numa categoria; as linhas de Poupança e Metas são grupos (bolsos).
  const aceitaItem = podeEditar && linha.destino !== 'investimentos' && linha.destino !== 'metas'

  async function criarItem() {
    const nome = (novoItem ?? '').trim()
    if (!nome) return setNovoItem(null)
    const { data, error } = await supabase.rpc('criar_item', { p_categoria_id: linhaId, p_nome: nome })
    if (error) return onErro('Não foi possível criar o item.')
    setNovoItem(null)
    setFocar(`item:${data as number}`)
    setCriados((v) => v + 1)
  }
  const partes = carga.partes
  const sugestoes = partes.filter((p) => p.sugerido !== null && p.sugerido > 0)
  const texto = (v: number) => (v ? centavosTexto(Math.round(v * 100)) : '')

  // Grava a linha inteira com os valores dados e já mostra o novo valor; se o banco
  // recusar, volta ao que estava.
  async function gravar(novos: Record<string, number>) {
    const antes = partes
    const depois = partes.map((p) => (chaveParte(p) in novos ? { ...p, orcado: novos[chaveParte(p)] } : p))
    setCarga((c) => (c ? { ...c, partes: depois } : c))
    const lista = depois.map((p) => ({ tipo: p.tipo, id: p.ref_id, valor: p.orcado }))
    const { error } = await supabase.rpc('orcar_linha', { p_linha_id: linhaId, p_valores: lista, ...parametros })
    if (error) {
      setCarga((c) => (c ? { ...c, partes: antes } : c))
      onErro('Não foi possível salvar. Nada foi alterado.')
    } else onSalvo()
  }

  function sair(p: Parte) {
    const k = chaveParte(p)
    const digitado = textos[k]
    setTextos((t) => semChave(t, k))
    if (digitado === undefined) return
    const valor = digitado.trim() === '' ? 0 : paraNumero(digitado)
    if (valor === null || valor < 0 || valor === p.orcado) return
    gravar({ [k]: valor })
  }

  return (
    <ul className="itens-orc">
      {partes.map((p) => {
        const k = chaveParte(p)
        const estourou = GASTO.has(linha.destino) && p.orcado > 0 && (p.realizado ?? 0) > p.orcado
        const nome = p.tipo === 'outros' && partes.length === 1 ? 'Valor (sem detalhe)' : p.nome
        return (
          <li key={k}>
            <span className="nome-item">
              {nome}
              {p.sugerido !== null && p.sugerido > 0 && <small>sugerido {reais(p.sugerido)}</small>}
            </span>
            <span className="numeros-item">
              {podeEditar ? (
                <input
                  className="valor-item"
                  autoFocus={focar === k}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={textos[k] ?? texto(p.orcado)}
                  onFocus={(e) => {
                    const alvo = e.currentTarget
                    setTextos((t) => ({ ...t, [k]: texto(p.orcado) }))
                    requestAnimationFrame(() => alvo.select())
                  }}
                  onChange={(e) => setTextos((t) => ({ ...t, [k]: e.target.value }))}
                  onBlur={() => {
                    if (focar === k) setFocar(null)
                    sair(p)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setTextos((t) => semChave(t, k))
                      requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur())
                    }
                  }}
                  aria-label={`Orçado para ${p.nome} em ${linha.nome}`}
                />
              ) : (
                <span className="valor-item">{p.orcado ? reais(p.orcado) : '–'}</span>
              )}
              {mostrarRealizado && p.realizado !== null && (
                <small className={p.orcado > 0 ? (estourou ? 'estourou' : 'no-limite') : undefined}>{reais(p.realizado)}</small>
              )}
            </span>
          </li>
        )
      })}
      {podeEditar && sugestoes.length > 0 && (
        <li className="acao-item">
          <button
            type="button"
            className="link"
            onClick={() => gravar(Object.fromEntries(sugestoes.map((p) => [chaveParte(p), Math.ceil(p.sugerido ?? 0)])))}
          >
            Usar o aporte necessário de cada projeto
          </button>
        </li>
      )}
      {aceitaItem && (
        <li className="acao-item novo-item-orc">
          {novoItem === null ? (
            <button type="button" className="link" onClick={() => setNovoItem('')}>
              + Novo item em {linha.nome}
            </button>
          ) : (
            <input
              className="campo"
              autoFocus
              placeholder="Nome do item (Enter cria)"
              value={novoItem}
              onChange={(e) => setNovoItem(e.target.value)}
              onBlur={() => !novoItem.trim() && setNovoItem(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') criarItem()
                if (e.key === 'Escape') setNovoItem(null)
              }}
              aria-label={`Nome do novo item em ${linha.nome}`}
            />
          )}
        </li>
      )}
    </ul>
  )
}

/**
 * Novo cenário (em branco ou cópia de outro), renomear e apagar o escolhido.
 * Apagar leva junto os valores do cenário; meses já preenchidos com ele não mudam.
 */
function GerenciarCenarios({
  cenarios,
  escolhido,
  onMudou,
}: {
  cenarios: Cenario[]
  escolhido: Cenario | null
  onMudou: (escolher: number | null, mensagem: string) => void
}) {
  const [acao, setAcao] = useState<'novo' | 'renomear' | 'apagar' | null>(null)
  const [nome, setNome] = useState('')
  const [base, setBase] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function abrir(a: 'novo' | 'renomear' | 'apagar') {
    setAcao(a)
    setErro(null)
    setNome(a === 'renomear' ? (escolhido?.nome ?? '') : '')
    setBase(a === 'novo' && escolhido ? String(escolhido.id) : '')
  }

  async function confirmar() {
    setErro(null)
    const n = nome.trim()
    if (acao !== 'apagar' && !n) return setErro('Dê um nome ao cenário.')
    if (acao === 'novo' || acao === 'renomear') {
      const repetido = cenarios.some(
        (c) => c.nome.toLowerCase() === n.toLowerCase() && (acao === 'novo' || c.id !== escolhido?.id),
      )
      if (repetido) return setErro('Já existe um cenário com esse nome.')
    }
    setSalvando(true)
    if (acao === 'novo') {
      const { data, error } = await supabase.rpc('criar_cenario', { p_nome: n, p_copiar_de: base ? Number(base) : null })
      setSalvando(false)
      if (error) return setErro('Não foi possível criar o cenário.')
      setAcao(null)
      onMudou(data as number, `Cenário ${n} criado.`)
    } else if (acao === 'renomear' && escolhido) {
      const { error } = await supabase.from('cenario').update({ nome: n }).eq('id', escolhido.id)
      setSalvando(false)
      if (error) return setErro('Não foi possível renomear.')
      setAcao(null)
      onMudou(escolhido.id, 'Cenário renomeado.')
    } else if (acao === 'apagar' && escolhido) {
      const { error } = await supabase.from('cenario').delete().eq('id', escolhido.id)
      setSalvando(false)
      if (error) return setErro('Não foi possível apagar.')
      setAcao(null)
      onMudou(null, `Cenário ${escolhido.nome} apagado.`)
    }
  }

  if (acao === null)
    return (
      <div className="acoes-cenario">
        <button type="button" className="link" onClick={() => abrir('novo')}>
          + Novo cenário
        </button>
        {escolhido && (
          <>
            <button type="button" className="link" onClick={() => abrir('renomear')}>
              Renomear
            </button>
            <button type="button" className="link perigo-link" onClick={() => abrir('apagar')}>
              Apagar
            </button>
          </>
        )}
      </div>
    )

  return (
    <div className="editor-cenario">
      {acao === 'apagar' ? (
        <p>
          Apagar o cenário <strong>{escolhido?.nome}</strong> e os valores dele? Meses já preenchidos com ele não mudam. Não
          dá para desfazer.
        </p>
      ) : (
        <>
          <input
            className="campo"
            autoFocus
            placeholder="Nome do cenário"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmar()
              if (e.key === 'Escape') setAcao(null)
            }}
            aria-label="Nome do cenário"
          />
          {acao === 'novo' && (
            <select className="campo" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Começar com">
              <option value="">Começar em branco</option>
              {cenarios.map((c) => (
                <option key={c.id} value={c.id}>
                  Cópia de {c.nome}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <div className="botoes-cenario">
        <button type="button" className={acao === 'apagar' ? 'perigo' : 'principal'} disabled={salvando} onClick={confirmar}>
          {acao === 'novo' ? 'Criar' : acao === 'renomear' ? 'Salvar' : 'Apagar cenário'}
        </button>
        <button type="button" className="discreto" onClick={() => setAcao(null)}>
          Cancelar
        </button>
      </div>
      {erro && <p className="erro">{erro}</p>}
    </div>
  )
}

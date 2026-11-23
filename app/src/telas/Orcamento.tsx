import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { centavosTexto, competenciaAtual, lerDigitado, nomeDoMes, reais, somarMeses } from '../lib/formato'

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
  const [resultado, setResultado] = useState<{ chave: string; linhas: Linha[]; poupanca: { orcado: number; realizado: number | null } } | null>(null)
  // Linhas expandidas (pelo id da linha), como grupos de linhas numa planilha.
  const [abertas, setAbertas] = useState<Set<number>>(() => new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [preencher, setPreencher] = useState(false)

  useEffect(() => {
    supabase
      .from('cenario')
      .select('id,nome')
      .order('ordem')
      .then(({ data }) => setCenarios((data ?? []) as Cenario[]))
  }, [])

  const cenarioEscolhido = cenarioId ?? cenarios[0]?.id ?? null
  const chave = `${modo}|${competencia}|${cenarioEscolhido}|${versao}`

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
        linhas: (r.data ?? []) as Linha[],
        poupanca: pp ?? { orcado: 0, realizado: null },
      })
    })
    return () => {
      cancelado = true
    }
  }, [modo, competencia, cenarioEscolhido, versao])

  const atual = resultado?.chave === chave ? resultado : null
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
          <p className="origem">
            Cenário {nomeCenario}: um modelo para preencher meses. Mudanças aqui não alteram meses já orçados.
          </p>
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

      {!atual && <p className="vazio">Carregando…</p>}

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
                              versao={versao}
                              onSalvo={() => {
                                setVersao((v) => v + 1)
                                avisar('Orçamento salvo.')
                              }}
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
 * Itens de uma linha, expandidos embaixo dela: o orçado de cada um (editável por quem
 * edita; grava ao sair do campo) e o realizado embaixo, na cor da regra. O total da
 * linha é a soma; "Outros gastos" é o valor sem detalhe.
 */
function DetalheLinha({
  linha,
  parametros,
  mostrarRealizado,
  podeEditar,
  versao,
  onSalvo,
  onErro,
}: {
  linha: Linha
  parametros: { p_competencia: string | null; p_cenario_id: number | null }
  mostrarRealizado: boolean
  podeEditar: boolean
  versao: number
  onSalvo: () => void
  onErro: (m: string) => void
}) {
  const { p_competencia: pCompetencia, p_cenario_id: pCenario } = parametros
  const linhaId = linha.linha_id
  const chave = `${linhaId}|${pCompetencia}|${pCenario}|${versao}`
  const [carga, setCarga] = useState<{ chave: string; partes: Parte[] } | null>(null)
  // Centavos digitados, por parte; vazio = o que veio do banco.
  const [editados, setEditados] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('orcamento_detalhe', { p_linha_id: linhaId, p_competencia: pCompetencia, p_cenario_id: pCenario })
      .then(({ data }) => {
        if (cancelado) return
        setCarga({ chave, partes: (data ?? []) as Parte[] })
        setEditados({})
      })
    return () => {
      cancelado = true
    }
  }, [chave, linhaId, pCompetencia, pCenario])

  if (!carga) return <p className="itens-orc-carregando">Carregando…</p>
  const partes = carga.partes
  const centavos = (p: Parte) => editados[chaveParte(p)] ?? Math.round(p.orcado * 100)
  const sugestoes = partes.filter((p) => p.sugerido !== null && p.sugerido > 0)

  async function gravar(valores: Record<string, number>) {
    const lista = partes.map((p) => ({
      tipo: p.tipo,
      id: p.ref_id,
      valor: (valores[chaveParte(p)] ?? Math.round(p.orcado * 100)) / 100,
    }))
    const { error } = await supabase.rpc('orcar_linha', { p_linha_id: linhaId, p_valores: lista, ...parametros })
    if (error) onErro('Não foi possível salvar. Nada foi alterado.')
    else onSalvo()
  }

  function sair(p: Parte) {
    const k = chaveParte(p)
    if (editados[k] !== undefined && editados[k] !== Math.round(p.orcado * 100)) gravar(editados)
  }

  return (
    <ul className="itens-orc">
      {partes.map((p) => {
        const orcado = centavos(p) / 100
        const estourou = GASTO.has(linha.destino) && orcado > 0 && (p.realizado ?? 0) > orcado
        const nome = p.tipo === 'outros' && partes.length === 1 ? 'Valor (sem detalhe)' : p.nome
        return (
          <li key={chaveParte(p)}>
            <span className="nome-item">
              {nome}
              {p.sugerido !== null && p.sugerido > 0 && <small>sugerido {reais(p.sugerido)}</small>}
            </span>
            <span className="numeros-item">
              {podeEditar ? (
                <input
                  className="valor-item"
                  inputMode="numeric"
                  placeholder="0,00"
                  value={centavos(p) ? centavosTexto(centavos(p)) : ''}
                  onChange={(e) => {
                    const lido = lerDigitado(e.target.value)
                    if (lido) setEditados((v) => ({ ...v, [chaveParte(p)]: lido.centavos ?? 0 }))
                  }}
                  onBlur={() => sair(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  aria-label={`Orçado para ${p.nome} em ${linha.nome}`}
                />
              ) : (
                <span className="valor-item">{orcado ? reais(orcado) : '–'}</span>
              )}
              {mostrarRealizado && p.realizado !== null && (
                <small className={orcado > 0 ? (estourou ? 'estourou' : 'no-limite') : undefined}>{reais(p.realizado)}</small>
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
            onClick={() =>
              gravar({
                ...editados,
                ...Object.fromEntries(sugestoes.map((p) => [chaveParte(p), Math.ceil(p.sugerido ?? 0) * 100])),
              })
            }
          >
            Usar o aporte necessário de cada projeto
          </button>
        </li>
      )}
    </ul>
  )
}

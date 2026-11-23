import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { competenciaAtual, nomeDoMes, paraNumero, reais, somarMeses } from '../lib/formato'

// Destinos em que passar do orçado é ruim (gasto e desconto).
const GASTO = new Set(['gasto_do_mes', 'desconto'])

/**
 * Orçamento do mês: realizado × orçado nas linhas da aba Resultados.
 * Cada linha recebe um valor cheio ou é detalhada por item (ou bolso), e o total
 * é a soma. Cenários são modelos com a mesma forma, usados para preencher o mês.
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
type Contexto = { competencia: string } | { cenarioId: number }

const paraTexto = (v: number) => (v ? v.toFixed(2).replace('.', ',') : '')
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
  const [aberta, setAberta] = useState<Linha | null>(null)
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
  const contexto: Contexto | null =
    modo === 'mes' ? { competencia } : cenarioEscolhido !== null ? { cenarioId: cenarioEscolhido } : null
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
    const grupos: { nome: string; linhas: Linha[] }[] = []
    for (const l of linhas) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo.nome === l.bloco) ultimo.linhas.push(l)
      else grupos.push({ nome: l.bloco, linhas: [l] })
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

      {!atual && <p className="vazio">Carregando…</p>}

      <div className="blocos-orc">
        {blocos.map((b) => {
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
                        disabled={!podeEditar}
                        onClick={() => setAberta(l)}
                      >
                        <span className="nome">
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
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      {aberta && contexto && (
        <EditorLinha
          linha={aberta}
          contexto={contexto}
          parametros={parametrosDe(modo, competencia, cenarioEscolhido)}
          mostrarRealizado={mostrarRealizado}
          onFechar={() => setAberta(null)}
          onSalvo={() => {
            setAberta(null)
            setVersao((v) => v + 1)
            avisar('Orçamento salvo.')
          }}
        />
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
function EditorLinha({
  linha,
  contexto,
  parametros,
  mostrarRealizado,
  onFechar,
  onSalvo,
}: {
  linha: Linha
  contexto: Contexto
  parametros: { p_competencia: string | null; p_cenario_id: number | null }
  mostrarRealizado: boolean
  onFechar: () => void
  onSalvo: () => void
}) {
  const [partes, setPartes] = useState<Parte[] | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [cheio, setCheio] = useState(paraTexto(linha.orcado))
  const [modoDetalhe, setModoDetalhe] = useState(linha.detalhado)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const { p_competencia: pCompetencia, p_cenario_id: pCenario } = parametros
  const linhaId = linha.linha_id

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('orcamento_detalhe', { p_linha_id: linhaId, p_competencia: pCompetencia, p_cenario_id: pCenario })
      .then(({ data }) => {
      if (cancelado) return
      const lista = (data ?? []) as Parte[]
      setPartes(lista)
      setValores(Object.fromEntries(lista.map((p) => [chaveParte(p), paraTexto(p.orcado)])))
    })
    return () => {
      cancelado = true
    }
  }, [linhaId, pCompetencia, pCenario])

  const temDetalhe = (partes ?? []).some((p) => p.tipo !== 'outros')
  const comSugestao = (partes ?? []).filter((p) => p.sugerido !== null && p.sugerido > 0)
  function usarSugestoes() {
    setModoDetalhe(true)
    setValores((v) => ({
      ...v,
      ...Object.fromEntries(comSugestao.map((p) => [chaveParte(p), paraTexto(Math.ceil(p.sugerido ?? 0))])),
    }))
  }
  const totalDetalhe = (partes ?? []).reduce((s, p) => s + (paraNumero(valores[chaveParte(p)] ?? '') ?? 0), 0)

  async function salvar() {
    setErro(null)
    let lista: { tipo: string; id: number | null; valor: number }[]
    if (modoDetalhe && temDetalhe) {
      lista = (partes ?? []).map((p) => ({ tipo: p.tipo, id: p.ref_id, valor: paraNumero(valores[chaveParte(p)] ?? '') ?? 0 }))
    } else {
      const v = cheio.trim() ? paraNumero(cheio) : 0
      if (v === null) return setErro('Valor inválido.')
      lista = [{ tipo: 'outros', id: null, valor: v }]
    }
    setSalvando(true)
    const { error } = await supabase.rpc('orcar_linha', { p_linha_id: linha.linha_id, p_valores: lista, ...parametros })
    setSalvando(false)
    if (error) setErro('Não foi possível salvar. Nada foi alterado.')
    else onSalvo()
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={`Orçamento de ${linha.nome}`}>
      <div className="folha">
        <header>
          <h2>{linha.nome}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        <p className="origem">
          {'competencia' in contexto ? nomeDoMes(contexto.competencia) : 'Cenário'}
          {mostrarRealizado && linha.destino !== 'desconto' && ` · realizado até agora ${reais(linha.realizado ?? 0)}`}
        </p>

        {partes === null && <p className="vazio">Carregando…</p>}

        {partes !== null && temDetalhe && (
          <div className="segmentos pequenos">
            <button type="button" className={!modoDetalhe ? 'ativo' : undefined} onClick={() => setModoDetalhe(false)}>
              Valor cheio
            </button>
            <button type="button" className={modoDetalhe ? 'ativo' : undefined} onClick={() => setModoDetalhe(true)}>
              Detalhar
            </button>
          </div>
        )}

        {comSugestao.length > 0 && (
          <button type="button" className="discreto" onClick={usarSugestoes}>
            Usar o aporte necessário de cada projeto
          </button>
        )}

        {partes !== null && (!modoDetalhe || !temDetalhe) && (
          <label className="campo-valor">
            <span>R$</span>
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={cheio}
              onChange={(e) => setCheio(e.target.value)}
              aria-label="Valor orçado"
              autoFocus
            />
          </label>
        )}

        {partes !== null && modoDetalhe && temDetalhe && (
          <>
            <ul className="detalhe-orc">
              {partes.map((p) => (
                <li key={chaveParte(p)}>
                  <span className="texto">
                    <span className="nome">{p.nome}</span>
                    {mostrarRealizado && p.realizado !== null && (
                      <span className="detalhe">realizado {reais(p.realizado)}</span>
                    )}
                    {p.sugerido !== null && p.sugerido > 0 && (
                      <span className="detalhe">sugerido {reais(p.sugerido)}</span>
                    )}
                  </span>
                  <input
                    className="campo"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valores[chaveParte(p)] ?? ''}
                    onChange={(e) => setValores((v) => ({ ...v, [chaveParte(p)]: e.target.value }))}
                    aria-label={`Orçado para ${p.nome}`}
                  />
                </li>
              ))}
            </ul>
            <p className="total-orc">
              Total <strong>{reais(totalDetalhe)}</strong>
            </p>
          </>
        )}

        {erro && <p className="erro">{erro}</p>}
        <button type="button" className="principal" disabled={salvando || partes === null} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

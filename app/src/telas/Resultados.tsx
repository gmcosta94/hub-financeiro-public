import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { competenciaAtual, reais } from '../lib/formato'

// Uma célula do relatório: uma linha (categoria, bloco ou total) num mês, ou no total
// do ano (competencia nula). Regras e somas vêm prontas de resultados_ano().
type Celula = {
  competencia: string | null
  tipo: 'linha' | 'bloco' | 'total'
  chave: string
  bloco: string | null
  posicao: number
  nome: string
  ordem: number
  sentido: number // 1: mais é melhor; -1: menos é melhor; 0: sem juízo
  orcado: number | null // nulo quando filtrado por meio de pagamento
  realizado: number | null
  anterior: number | null
  ganhos: number | null
}

type Linha = {
  chave: string
  tipo: Celula['tipo']
  bloco: string | null
  posicao: number
  nome: string
  sentido: number
  porMes: Map<string, Celula>
  total: Celula | null
}

type Modo = 'orcado' | 'horizontal' | 'vertical'

const MODOS: { id: Modo; nome: string; explica: string }[] = [
  {
    id: 'orcado',
    nome: 'vs orçado',
    explica: 'Variação do realizado sobre o orçado. Verde quando entrou ou foi guardado mais, ou gasto menos, do que o orçado.',
  },
  {
    id: 'horizontal',
    nome: 'vs mês anterior',
    explica:
      'Análise horizontal: variação sobre o mês anterior (no total, sobre os mesmos meses do ano anterior). Verde quando entrou ou foi guardado mais, ou gasto menos.',
  },
  {
    id: 'vertical',
    nome: '% dos ganhos',
    explica: 'Análise vertical: quanto cada linha representa dos ganhos do período. Sem cor: é composição, não é bom nem ruim.',
  },
]

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const valor = (v: number) => (Math.round(v) < 0 ? `−${inteiro.format(-v)}` : inteiro.format(v))

/** Texto e cor do percentual ao lado do realizado, conforme a comparação escolhida. */
function comparar(c: Celula | undefined | null, modo: Modo): { texto: string; classe: string } | null {
  if (!c || c.realizado === null) return null
  if (modo === 'vertical') {
    if (!c.ganhos) return { texto: '–', classe: 'neutro' }
    const p = (c.realizado / c.ganhos) * 100
    return { texto: `${p.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 })}%`, classe: 'neutro' }
  }
  const base = modo === 'orcado' ? c.orcado : c.anterior
  if (base === null) return { texto: '–', classe: 'neutro' }
  if (base === 0) return { texto: c.realizado === 0 ? '0%' : '–', classe: 'neutro' }
  const v = (c.realizado - base) / Math.abs(base)
  const r = Math.round(v * 100)
  const texto = Math.abs(r) > 999 ? (r > 0 ? '>+999%' : '<−999%') : r === 0 ? '0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`
  const classe = r === 0 || c.sentido === 0 ? 'neutro' : v * c.sentido > 0 ? 'bom' : 'ruim'
  return { texto, classe }
}

/** Dica ao passar o mouse: os três números de referência da célula. */
function dica(c: Celula | undefined | null, rotulo: string): string | undefined {
  if (!c || c.realizado === null) return undefined
  const partes = [`${rotulo}: ${reais(c.realizado)}`]
  if (c.orcado !== null) partes.push(`orçado ${reais(c.orcado)}`)
  if (c.anterior !== null) partes.push(`${c.competencia ? 'mês anterior' : 'ano anterior'} ${reais(c.anterior)}`)
  return partes.join(' · ')
}

export function Resultados() {
  const [ano, setAno] = useState(() => new Date().getFullYear())
  const [anos, setAnos] = useState<number[]>(() => [new Date().getFullYear()])
  const [modoEscolhido, setModo] = useState<Modo>('orcado')
  // Meio de pagamento (conta ou cartão): o demonstrativo só com o que passou por ele.
  const [conta, setConta] = useState<number | null>(null)
  const [contas, setContas] = useState<{ id: number; nome: string; ativa: boolean }[]>([])
  // Filtrado não há orçado: "vs orçado" vira "vs mês anterior".
  const modo: Modo = conta !== null && modoEscolhido === 'orcado' ? 'horizontal' : modoEscolhido
  const [mesAtual] = useState(competenciaAtual)
  const [recolhidos, setRecolhidos] = useState<Set<string>>(() => new Set())
  const [dados, setDados] = useState<{ ano: number; conta: number | null; celulas: Celula[]; erro: string | null } | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('conta')
      .select('id,nome,ativa')
      .order('id')
      .then(({ data }) => {
        if (!cancelado) setContas((data ?? []) as { id: number; nome: string; ativa: boolean }[])
      })
    return () => {
      cancelado = true
    }
  }, [])
  const tabela = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('lancamento')
      .select('competencia')
      .order('competencia')
      .limit(1)
      .then(({ data }) => {
        const primeiro = Number(((data ?? [])[0] as { competencia?: string } | undefined)?.competencia?.slice(0, 4))
        const atual = new Date().getFullYear()
        if (!cancelado && primeiro && primeiro <= atual) setAnos(Array.from({ length: atual - primeiro + 1 }, (_, i) => primeiro + i))
      })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    let cancelado = false
    supabase.rpc('resultados_ano', conta === null ? { p_ano: ano } : { p_ano: ano, p_conta_id: conta }).then(({ data, error }) => {
      if (cancelado) return
      setDados({
        ano,
        conta,
        celulas: ((data ?? []) as Celula[]).map((c) => ({
          ...c,
          orcado: c.orcado === null ? null : Number(c.orcado),
          realizado: c.realizado === null ? null : Number(c.realizado),
          anterior: c.anterior === null ? null : Number(c.anterior),
          ganhos: c.ganhos === null ? null : Number(c.ganhos),
        })),
        erro: error ? 'Não foi possível carregar os resultados.' : null,
      })
    })
    return () => {
      cancelado = true
    }
  }, [ano, conta])

  // Meses com realizado (os que entram no relatório) e as linhas na ordem da planilha.
  const { meses, linhas } = useMemo(() => {
    const celulas = dados?.celulas ?? []
    const meses = [...new Set(celulas.filter((c) => c.competencia && c.realizado !== null).map((c) => c.competencia as string))].sort()
    const porChave = new Map<string, Linha>()
    for (const c of celulas) {
      let l = porChave.get(c.chave)
      if (!l) {
        l = { chave: c.chave, tipo: c.tipo, bloco: c.bloco, posicao: c.posicao, nome: c.nome, sentido: c.sentido, porMes: new Map(), total: null }
        porChave.set(c.chave, l)
      }
      if (c.competencia) l.porMes.set(c.competencia, c)
      else l.total = c
    }
    const todas = [...porChave.values()]
    const ordem = new Map(celulas.map((c) => [c.chave, c.ordem]))
    todas.sort((a, b) => a.posicao - b.posicao || (ordem.get(a.chave) ?? 0) - (ordem.get(b.chave) ?? 0) || a.nome.localeCompare(b.nome))
    // Linha sem nada no ano some; bloco de uma linha só mostra o próprio bloco.
    const vazia = (l: Linha) => meses.every((m) => !l.porMes.get(m)?.realizado && !l.porMes.get(m)?.orcado)
    const linhasDoBloco = (b: string | null) => todas.filter((l) => l.tipo === 'linha' && l.bloco === b && !vazia(l))
    // Filtrado por meio de pagamento, some também o bloco ou total sem nada no ano
    // (Ganhos e Descontos num cartão, por exemplo).
    const filtrado = dados?.conta !== null && dados?.conta !== undefined
    const zerada = (l: Linha) => meses.every((m) => !l.porMes.get(m)?.realizado)
    const linhas = todas.filter(
      (l) => (l.tipo !== 'linha' || (!vazia(l) && linhasDoBloco(l.bloco).length > 1)) && !(filtrado && l.tipo !== 'linha' && zerada(l)),
    )
    return { meses, linhas }
  }, [dados])

  // No celular a tabela não cabe: abre rolada até os meses mais recentes e o total.
  const anoCarregado = dados?.ano
  useEffect(() => {
    const t = tabela.current
    if (t) t.scrollLeft = t.scrollWidth
  }, [anoCarregado, meses.length])

  const blocosComLinhas = new Set(linhas.filter((l) => l.tipo === 'linha').map((l) => l.bloco))
  const nomeConta = contas.find((c) => c.id === conta)?.nome
  const explicacao = MODOS.find((m) => m.id === modo)?.explica
  const atualizado = dados?.ano === ano && dados?.conta === conta

  function alternar(bloco: string) {
    setRecolhidos((r) => {
      const n = new Set(r)
      if (n.has(bloco)) n.delete(bloco)
      else n.add(bloco)
      return n
    })
  }

  return (
    <main className="resultados">
      <div className="controles-resultados">
        {anos.length > 1 && (
          <div className="segmentos pequenos" role="tablist" aria-label="Ano">
            {anos.map((a) => (
              <button key={a} type="button" role="tab" aria-selected={a === ano} className={a === ano ? 'ativo' : undefined} onClick={() => setAno(a)}>
                {a}
              </button>
            ))}
          </div>
        )}
        <select
          className="campo filtro-conta"
          aria-label="Meio de pagamento"
          value={conta ?? ''}
          onChange={(e) => setConta(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Todos os meios de pagamento</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
              {c.ativa ? '' : ' (inativa)'}
            </option>
          ))}
        </select>
        <div className="segmentos comparacao" role="tablist" aria-label="Percentual ao lado do realizado">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === modo}
              className={m.id === modo ? 'ativo' : undefined}
              disabled={m.id === 'orcado' && conta !== null}
              title={m.id === 'orcado' && conta !== null ? 'O orçamento não é por meio de pagamento' : undefined}
              onClick={() => setModo(m.id)}
            >
              {m.nome}
            </button>
          ))}
        </div>
      </div>
      <p className="origem">
        {conta !== null &&
          `Só o que passou por ${nomeConta ?? 'este meio de pagamento'}: lançamentos e aportes ou resgates dele, sem orçado. `}
        {explicacao}
      </p>

      {dados?.erro && <p className="erro">{dados.erro}</p>}
      {!dados && <p className="vazio">Carregando…</p>}
      {dados && !dados.erro && meses.length === 0 && <p className="vazio">Nenhum lançamento em {ano}.</p>}

      {meses.length > 0 && (
        <div ref={tabela} className={atualizado ? 'tabela-resultados' : 'tabela-resultados recarregando'}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="nome">
                  R$ · {dados?.ano}
                </th>
                {meses.map((m) => (
                  <th key={m} scope="col">
                    {MESES[Number(m.slice(5, 7)) - 1]}
                    {m === mesAtual && (
                      <small className="parcial" title="Mês em andamento">
                        parcial
                      </small>
                    )}
                  </th>
                ))}
                <th scope="col" className="col-total">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                if (l.tipo === 'linha' && l.bloco && recolhidos.has(l.bloco)) return null
                const recolhivel = l.tipo === 'bloco' && blocosComLinhas.has(l.bloco)
                const aberto = !(l.bloco && recolhidos.has(l.bloco))
                return (
                  <tr key={l.chave} className={`tipo-${l.tipo}`}>
                    <th scope="row" className="nome">
                      {recolhivel ? (
                        <button type="button" aria-expanded={aberto} onClick={() => alternar(l.bloco as string)}>
                          <span className="seta" aria-hidden="true">
                            {aberto ? '▾' : '▸'}
                          </span>
                          {l.nome}
                        </button>
                      ) : (
                        l.nome
                      )}
                    </th>
                    {meses.map((m) => (
                      <CelulaValor key={m} c={l.porMes.get(m)} modo={modo} rotulo={`${l.nome}, ${MESES[Number(m.slice(5, 7)) - 1]}`} />
                    ))}
                    <CelulaValor c={l.total} modo={modo} rotulo={`${l.nome}, total`} total />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

function CelulaValor({ c, modo, rotulo, total }: { c: Celula | undefined | null; modo: Modo; rotulo: string; total?: boolean }) {
  const comp = comparar(c, modo)
  return (
    <td className={total ? 'col-total' : undefined} title={dica(c, rotulo)}>
      {c && c.realizado !== null ? (
        <>
          <span className="valor">{valor(c.realizado)}</span>
          {comp && <small className={comp.classe}>{comp.texto}</small>}
        </>
      ) : (
        <span className="valor vazio-celula">–</span>
      )}
    </td>
  )
}

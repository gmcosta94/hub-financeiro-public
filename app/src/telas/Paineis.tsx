import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { compacto, hojeISO, mesCurto, nomeDoMes, paraNumero, reais } from '../lib/formato'
import { Cartao, Colunas, Linhas, Segmentos } from '../lib/graficos'
import { useLargo } from '../lib/tela'
import type { Objetivo } from '../lib/investimentos'

/**
 * Painéis: patrimônio de hoje e a evolução, projetos, e o ano (realizado × orçado por
 * bloco, taxa de poupança, gastos por categoria e item). Leitura para os dois; quem
 * edita também atualiza bens e dívidas. Conta no banco: patrimonio_atual,
 * fotografar_patrimonio, patrimonio_evolucao, projetos_situacao, resultado_ano,
 * poupanca_ano, itens_ano.
 */

type Patrimonio = { grupo: string; grupo_ordem: number; bolso_id: number | null; bem_id: number | null; nome: string; valor: number }
type Evolucao = { competencia: string; patrimonio: number | null; investimentos: number | null; aportado: number }
type Projeto = {
  projeto_id: number
  nome: string
  status: string
  valor_alvo: number
  saldo: number
  falta: number
  fim: string
  aporte_necessario: number | null
}
type LinhaAno = {
  competencia: string
  bloco: string
  bloco_ordem: number
  linha_id: number
  nome: string
  destino: string
  orcado: number
  realizado: number | null
}
type PoupancaAno = {
  competencia: string
  taxa_orcada: number | null
  taxa_realizada: number | null
  taxa_acumulada: number | null
  taxa_orcada_acumulada: number | null
  poupanca_realizado: number | null
  ganhos_realizado: number | null
}
type ItemAno = { competencia: string; tipo: string; ref_id: number | null; nome: string; ordem: number; orcado: number; realizado: number | null }
type Bem = { id: number; nome: string; natureza: 'bem' | 'divida'; ativo: boolean; valor: number | null; em: string | null }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1).replace('.', ',')}%`)
const pctEixo = (v: number) => `${Math.round(v * 100)}%`
const reaisInteiros = (v: number) => reais(Math.round(v)).replace(/,00$/, '')
// Composição com as cores das áreas do app: investimentos e reserva na família índigo
// (aba Investimentos), projetos no azul-marinho (aba Projetos), bens em grafite.
const SERIE_GRUPO: Record<string, string> = {
  Investimentos: 'cor-carteira',
  'Reserva de emergência': 'cor-reserva',
  Projetos: 'cor-projetos',
  Bens: 'cor-geral',
}

export function Paineis({ podeEditar }: { podeEditar: boolean }) {
  const [versao, setVersao] = useState(0)
  const [ano, setAno] = useState(() => new Date().getFullYear())
  const [anos, setAnos] = useState<number[]>(() => [new Date().getFullYear()])
  const [hoje, setHoje] = useState<{
    patrimonio: Patrimonio[]
    evolucao: Evolucao[]
    projetos: Projeto[]
    reserva: Projeto | null
  } | null>(null)
  // A aposentadoria vem à parte: a conta (rentabilidade realizada) leva uns segundos.
  const [objetivos, setObjetivos] = useState<Objetivo[] | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase.rpc('objetivo_situacao').then(({ data }) => {
      if (!cancelado) setObjetivos((data ?? []) as Objetivo[])
    })
    return () => {
      cancelado = true
    }
  }, [versao])
  const [doAno, setDoAno] = useState<{ ano: number; linhas: LinhaAno[]; poupanca: PoupancaAno[] } | null>(null)
  const [bensAberto, setBensAberto] = useState(false)

  // Patrimônio, evolução e projetos (de hoje). Quem edita refaz a foto do mês antes.
  useEffect(() => {
    let cancelado = false
    const foto = podeEditar ? supabase.rpc('fotografar_patrimonio') : Promise.resolve(null)
    foto
      .then(() =>
        Promise.all([
          supabase.rpc('patrimonio_atual'),
          supabase.rpc('patrimonio_evolucao'),
          supabase.rpc('projetos_situacao'),
          supabase.from('lancamento').select('competencia').order('competencia').limit(1),
          supabase.from('bolso').select('projeto_id').eq('tipo', 'reserva'),
        ]),
      )
      .then(([p, e, s, l, r]) => {
        if (cancelado) return
        // A reserva de emergência fica na aba Investimentos, não entre os projetos.
        const reserva = new Set(((r.data ?? []) as { projeto_id: number | null }[]).map((b) => b.projeto_id))
        setHoje({
          patrimonio: (p.data ?? []) as Patrimonio[],
          evolucao: (e.data ?? []) as Evolucao[],
          projetos: ((s.data ?? []) as Projeto[]).filter((x) => x.status === 'ativo' && !reserva.has(x.projeto_id)),
          reserva: ((s.data ?? []) as Projeto[]).find((x) => reserva.has(x.projeto_id)) ?? null,
        })
        const primeiro = Number(((l.data ?? [])[0] as { competencia?: string } | undefined)?.competencia?.slice(0, 4))
        const atual = new Date().getFullYear()
        if (primeiro && primeiro <= atual) setAnos(Array.from({ length: atual - primeiro + 1 }, (_, i) => primeiro + i))
      })
    return () => {
      cancelado = true
    }
  }, [podeEditar, versao])

  useEffect(() => {
    let cancelado = false
    Promise.all([supabase.rpc('resultado_ano', { p_ano: ano }), supabase.rpc('poupanca_ano', { p_ano: ano })]).then(
      ([r, p]) => {
        if (!cancelado) setDoAno({ ano, linhas: (r.data ?? []) as LinhaAno[], poupanca: (p.data ?? []) as PoupancaAno[] })
      },
    )
    return () => {
      cancelado = true
    }
  }, [ano, versao])

  if (!hoje) return <main className="paineis" />

  return (
    <main className="paineis">
      {hoje && <PainelPatrimonio dados={hoje} podeEditar={podeEditar} onBens={() => setBensAberto(true)} />}
      {hoje && <PainelObjetivos projetos={hoje.projetos} reserva={hoje.reserva} objetivos={objetivos} />}

      <div className="filtro-ano">
        <span>Ano</span>
        <div className="segmentos pequenos" role="tablist" aria-label="Ano dos painéis">
          {anos.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={a === ano} className={a === ano ? 'ativo' : undefined} onClick={() => setAno(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>

      {doAno && (
        <div className={doAno.ano === ano ? 'paineis-ano' : 'paineis-ano recarregando'}>
          <PainelResultado linhas={doAno.linhas} />
          <PainelPoupanca poupanca={doAno.poupanca} />
          <PainelGastos ano={doAno.ano} linhas={doAno.linhas} />
        </div>
      )}

      {bensAberto && (
        <FolhaBens
          onFechar={() => setBensAberto(false)}
          onSalvo={() => setVersao((v) => v + 1)}
        />
      )}
    </main>
  )
}

/* ------------------------------------------------------------------ Patrimônio */

function PainelPatrimonio({
  dados,
  podeEditar,
  onBens,
}: {
  dados: { patrimonio: Patrimonio[]; evolucao: Evolucao[] }
  podeEditar: boolean
  onBens: () => void
}) {
  const total = dados.patrimonio.reduce((s, p) => s + p.valor, 0)
  const grupos = useMemo(() => {
    const g: { nome: string; ordem: number; valor: number; itens: Patrimonio[] }[] = []
    for (const p of dados.patrimonio) {
      const ultimo = g.find((x) => x.nome === p.grupo)
      if (ultimo) {
        ultimo.valor += p.valor
        ultimo.itens.push(p)
      } else g.push({ nome: p.grupo, ordem: p.grupo_ordem, valor: p.valor, itens: [p] })
    }
    return g.sort((a, b) => a.ordem - b.ordem)
  }, [dados.patrimonio])

  const fotos = dados.evolucao.filter((e) => e.patrimonio !== null)
  const anterior = fotos.length >= 2 ? fotos[fotos.length - 2] : null
  const evolucao = dados.evolucao

  return (
    <>
      <section className="heroi">
        <span>Patrimônio líquido</span>
        <strong>{reais(total)}</strong>
        <small>
          {anterior?.patrimonio != null
            ? `${total >= anterior.patrimonio ? '▲' : '▼'} ${reais(Math.abs(total - anterior.patrimonio))} desde ${mesCurto(anterior.competencia)}`
            : 'hoje · a foto de cada mês fica guardada a partir de agora'}
        </small>
      </section>

      <Cartao
        titulo="Composição"
        extra={
          podeEditar ? (
            <button type="button" className="link" onClick={onBens}>
              Bens e dívidas
            </button>
          ) : undefined
        }
      >
        <Segmentos
          partes={grupos.filter((g) => g.valor > 0).map((g) => ({ nome: g.nome, valor: g.valor, serie: SERIE_GRUPO[g.nome] ?? 4 }))}
          formato={reais}
        />
        <ul className="lista-painel">
          {grupos.map((g) => (
            <li key={g.nome}>
              <div className="linha-painel grupo">
                <span>{g.nome}</span>
                <strong>{reais(g.valor)}</strong>
              </div>
              {g.itens.map((i) => (
                <div key={`${i.bolso_id}-${i.bem_id}`} className="linha-painel">
                  <span>{i.nome}</span>
                  <span>{reais(i.valor)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
        {!grupos.some((g) => g.nome === 'Bens' || g.nome === 'Dívidas') && (
          <p className="origem">Apartamento, carro e saldo devedor entram em “Bens e dívidas”.</p>
        )}
      </Cartao>

      {evolucao.length > 0 && (
        <Cartao titulo="Evolução">
          <Linhas
            rotulos={evolucao.map((e) => (e.competencia.slice(5, 7) === '01' ? e.competencia.slice(0, 4) : ''))}
            titulos={evolucao.map((e) => nomeDoMes(e.competencia))}
            passoRotulo={1}
            series={[
              { nome: 'Aportado (compras − vendas)', valores: evolucao.map((e) => e.aportado), serie: 1 },
              { nome: 'Valor de mercado', valores: evolucao.map((e) => e.investimentos), serie: 2 },
              { nome: 'Patrimônio líquido', valores: evolucao.map((e) => e.patrimonio), serie: 3 },
            ]}
            formato={reais}
          />
          <p className="origem">
            Aportado vem do histórico do MyProfit e das operações lançadas. O valor de mercado e o patrimônio líquido
            só existem a partir das fotos mensais (desde {mesCurto(fotos[0]?.competencia ?? evolucao[evolucao.length - 1].competencia)}).
          </p>
        </Cartao>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ Projetos */

/**
 * Objetivos e quanto poupar por mês para cada um: projetos (curto e médio prazo), a
 * reserva de emergência e a aposentadoria, e o total do mês somando os três.
 */
function PainelObjetivos({
  projetos,
  reserva,
  objetivos,
}: {
  projetos: Projeto[]
  reserva: Projeto | null
  objetivos: Objetivo[] | null
}) {
  const saldo = projetos.reduce((s, p) => s + p.saldo, 0)
  const alvo = projetos.reduce((s, p) => s + p.valor_alvo, 0)
  const aporteProjetos = projetos.reduce((s, p) => s + (p.aporte_necessario ?? 0), 0)
  const aporteReserva = reserva?.aporte_necessario ?? 0
  const aporteAposentadoria = (objetivos ?? []).reduce((s, o) => s + o.aporte_premissa, 0)
  const total = aporteProjetos + aporteReserva + aporteAposentadoria
  const progresso = (v: number, a: number) => (a > 0 ? Math.min(v / a, 1) : 0)

  return (
    <Cartao titulo="Objetivos · quanto poupar por mês" extra={`${reaisInteiros(total)} por mês`} classe="painel-largo">
      <section className="secao-objetivo area-projetos">
        <h3>
          <span>Projetos</span>
          <span>{reaisInteiros(aporteProjetos)} por mês</span>
        </h3>
        {projetos.length === 0 ? (
          <p className="origem">Nenhum projeto ativo.</p>
        ) : (
          <>
            <ul className="lista-painel duas-colunas">
              {projetos.map((p) => {
                const prog = progresso(p.saldo, p.valor_alvo)
                return (
                  <li key={p.projeto_id} className="linha-projeto-painel">
                    <div className="linha-painel">
                      <span>{p.nome}</span>
                      <span>
                        {reaisInteiros(p.saldo)} <small>de {reaisInteiros(p.valor_alvo)}</small>
                      </span>
                    </div>
                    <span className="barra" aria-hidden="true">
                      <span style={{ width: `${prog * 100}%` }} />
                    </span>
                    <small className="sub">
                      {pct(prog)} · {p.aporte_necessario ? `${reaisInteiros(p.aporte_necessario)} por mês` : 'sem aporte'} · até{' '}
                      {mesCurto(p.fim)}
                    </small>
                  </li>
                )
              })}
            </ul>
            <p className="origem">
              Juntos: {reaisInteiros(saldo)} de {reaisInteiros(alvo)} ({pct(alvo ? saldo / alvo : null)}). Saldo estimado com o
              CDI; inclui o aporte dos projetos que ainda vão começar.
            </p>
          </>
        )}
      </section>

      <div className="objetivos-dupla area-carteira">
        <section className="secao-objetivo">
          <h3>
            <span>Reserva de emergência</span>
            <span>{reaisInteiros(aporteReserva)} por mês</span>
          </h3>
          {reserva ? (
            <div className="linha-projeto-painel">
              <div className="linha-painel">
                <span>{reaisInteiros(reserva.saldo)}</span>
                <span>
                  <small>de</small> {reaisInteiros(reserva.valor_alvo)}
                </span>
              </div>
              <span className="barra" aria-hidden="true">
                <span style={{ width: `${progresso(reserva.saldo, reserva.valor_alvo) * 100}%` }} />
              </span>
              <small className="sub">
                {pct(progresso(reserva.saldo, reserva.valor_alvo))} · falta {reaisInteiros(reserva.falta)} · até{' '}
                {mesCurto(reserva.fim)}
              </small>
            </div>
          ) : (
            <p className="origem">Sem objetivo definido (aba Investimentos).</p>
          )}
        </section>

        <section className="secao-objetivo">
          <h3>
            <span>Investimentos · aposentadoria</span>
            <span>{objetivos ? `${reaisInteiros(aporteAposentadoria)} por mês` : 'calculando…'}</span>
          </h3>
          {objetivos === null ? (
            <p className="origem">Calculando…</p>
          ) : objetivos.length === 0 ? (
            <p className="origem">Sem objetivo definido.</p>
          ) : (
            objetivos.map((o) => (
              <div key={o.objetivo_id} className="linha-projeto-painel">
                <div className="linha-painel">
                  <span>{reaisInteiros(o.valor_atual)}</span>
                  <span>
                    <small>de</small> {reaisInteiros(o.alvo)}
                  </span>
                </div>
                <span className="barra" aria-hidden="true">
                  <span style={{ width: `${Math.min(o.progresso, 1) * 100}%` }} />
                </span>
                <small className="sub">
                  {pct(o.progresso)} · renda de {reaisInteiros(o.renda_mensal_alvo)}/mês · até {mesCurto(o.data_alvo)}
                  {o.aporte_realizada !== null ? ` · ${reaisInteiros(o.aporte_realizada)}/mês pelo rendimento realizado` : ''}
                </small>
              </div>
            ))
          )}
        </section>
      </div>

      <div className="consolidado-objetivos">
        <span>
          <small>Projetos</small>
          {reaisInteiros(aporteProjetos)}
        </span>
        <span className="sinal" aria-hidden="true">
          +
        </span>
        <span>
          <small>Reserva</small>
          {reaisInteiros(aporteReserva)}
        </span>
        <span className="sinal" aria-hidden="true">
          +
        </span>
        <span>
          <small>Aposentadoria</small>
          {objetivos ? reaisInteiros(aporteAposentadoria) : '…'}
        </span>
        <span className="sinal" aria-hidden="true">
          =
        </span>
        <span className="total">
          <small>Poupar por mês</small>
          {reaisInteiros(total)}
        </span>
      </div>
      <p className="origem">Aposentadoria pela premissa de rentabilidade; valores em reais de hoje.</p>
    </Cartao>
  )
}

/* ------------------------------------------------------------------ Ano */

function porMes<T extends { competencia: string }>(linhas: T[], valor: (l: T[]) => number | null): (number | null)[] {
  const ano = linhas[0]?.competencia.slice(0, 4)
  return MESES.map((_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, '0')}-01`
    const doMes = linhas.filter((l) => l.competencia === mes)
    return doMes.length ? valor(doMes) : null
  })
}
const somaOuNulo = (vs: (number | null)[]) => (vs.every((v) => v === null) ? null : vs.reduce<number>((s, v) => s + (v ?? 0), 0))
const titulosAno = (linhas: { competencia: string }[]) => {
  const ano = linhas[0]?.competencia.slice(0, 4) ?? ''
  return MESES.map((m) => `${m}/${ano}`)
}

function PainelResultado({ linhas }: { linhas: LinhaAno[] }) {
  const blocos = useMemo(() => {
    const vistos = new Map<string, number>()
    for (const l of linhas) if (l.destino !== 'desconto') vistos.set(l.bloco, l.bloco_ordem)
    return [...vistos.entries()].sort((a, b) => a[1] - b[1]).map(([nome]) => nome)
  }, [linhas])
  const [escolhido, setEscolhido] = useState('Custo de Vida')
  const bloco = blocos.includes(escolhido) ? escolhido : blocos[0]
  const doBloco = linhas.filter((l) => l.bloco === bloco)
  const realizado = porMes(doBloco, (ls) => somaOuNulo(ls.map((l) => l.realizado)))
  const orcado = porMes(doBloco, (ls) => ls.reduce((s, l) => s + l.orcado, 0))
  const passados = realizado.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0)
  const reaAno = passados.reduce((s, i) => s + (realizado[i] ?? 0), 0)
  const orcAte = passados.reduce((s, i) => s + (orcado[i] ?? 0), 0)
  const orcAno = orcado.reduce<number>((s, v) => s + (v ?? 0), 0)

  if (!bloco) return null
  return (
    <Cartao titulo="Realizado × orçado" classe="painel-resultado">
      <div className="fichas rolam" role="tablist" aria-label="Bloco do orçamento">
        {blocos.map((b) => (
          <button key={b} type="button" role="tab" aria-selected={b === bloco} className={b === bloco ? 'ativo' : undefined} onClick={() => setEscolhido(b)}>
            {b}
          </button>
        ))}
      </div>
      <div className="numeros-painel">
        <span>
          <small>Realizado</small>
          {reaisInteiros(reaAno)}
        </span>
        <span>
          <small>Orçado até {passados.length ? MESES[passados[passados.length - 1]] : '–'}</small>
          {reaisInteiros(orcAte)}
        </span>
        <span>
          <small>Diferença</small>
          {orcAte ? `${reaAno >= orcAte ? '+' : '−'}${pct(Math.abs(reaAno / orcAte - 1))}` : '–'}
        </span>
        <span>
          <small>Orçado no ano</small>
          {reaisInteiros(orcAno)}
        </span>
      </div>
      <Colunas rotulos={MESES} titulos={titulosAno(doBloco)} realizado={realizado} orcado={orcado} formato={reais} />
    </Cartao>
  )
}

function PainelPoupanca({ poupanca }: { poupanca: PoupancaAno[] }) {
  const passados = poupanca.filter((p) => p.taxa_acumulada !== null)
  const ultimo = passados[passados.length - 1]
  return (
    <Cartao titulo="Taxa de poupança" extra={ultimo ? `${pct(ultimo.taxa_acumulada)} no ano` : undefined} classe="painel-poupanca">
      <div className="numeros-painel">
        <span>
          <small>No ano (realizada)</small>
          {pct(ultimo?.taxa_acumulada)}
        </span>
        <span>
          <small>No ano (orçada)</small>
          {pct(ultimo?.taxa_orcada_acumulada)}
        </span>
        <span>
          <small>Poupado</small>
          {reaisInteiros(passados.reduce((s, p) => s + (p.poupanca_realizado ?? 0), 0))}
        </span>
        <span>
          <small>Ganhos</small>
          {reaisInteiros(passados.reduce((s, p) => s + (p.ganhos_realizado ?? 0), 0))}
        </span>
      </div>
      <Linhas
        rotulos={MESES}
        titulos={titulosAno(poupanca)}
        series={[
          { nome: 'Realizada', valores: poupanca.map((p) => p.taxa_realizada), serie: 1 },
          { nome: 'Orçada', valores: poupanca.map((p) => p.taxa_orcada), serie: 2 },
        ]}
        formato={pct}
        formatoEixo={pctEixo}
      />
      <p className="origem">Aportes menos resgates nos bolsos que contam na poupança, divididos pelos ganhos do mês.</p>
    </Cartao>
  )
}

function PainelGastos({ ano, linhas }: { ano: number; linhas: LinhaAno[] }) {
  const gastos = useMemo(() => linhas.filter((l) => l.bloco_ordem >= 5), [linhas])
  const meses = new Set(gastos.filter((l) => l.realizado !== null).map((l) => l.competencia)).size
  const ranking = useMemo(() => {
    const m = new Map<number, { id: number; nome: string; bloco: string; realizado: number; orcado: number }>()
    for (const l of gastos) {
      const r = m.get(l.linha_id) ?? { id: l.linha_id, nome: l.nome, bloco: l.bloco, realizado: 0, orcado: 0 }
      if (l.realizado !== null) {
        r.realizado += l.realizado
        r.orcado += l.orcado
      }
      m.set(l.linha_id, r)
    }
    return [...m.values()].filter((r) => r.realizado !== 0 || r.orcado !== 0).sort((a, b) => b.realizado - a.realizado)
  }, [gastos])
  const [escolhida, setEscolhida] = useState<number | null>(null)
  const [todas, setTodas] = useState(false)
  // No computador o detalhe fica ao lado da lista, sempre aberto (na maior categoria
  // até alguém escolher outra); no celular abre embaixo da categoria tocada.
  const largo = useLargo()
  const aberta = largo ? (ranking.some((r) => r.id === escolhida) ? escolhida : (ranking[0]?.id ?? null)) : escolhida
  const maior = Math.max(1, ...ranking.map((r) => r.realizado))
  const categoria = ranking.find((r) => r.id === aberta) ?? null
  const detalhe = categoria && (
    <DetalheCategoria key={categoria.id} ano={ano} linhaId={categoria.id} linhas={gastos.filter((l) => l.linha_id === categoria.id)} />
  )

  const lista = (
    <>
      <ul className="lista-painel ranking">
        {(todas ? ranking : ranking.slice(0, 8)).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`linha-ranking${r.id === aberta ? ' escolhida' : ''}`}
              aria-expanded={r.id === aberta}
              onClick={() => setEscolhida(largo ? r.id : r.id === aberta ? null : r.id)}
            >
              <span className="linha-painel">
                <span>{r.nome}</span>
                <span>
                  {reaisInteiros(r.realizado)} <small>{meses ? `${compacto(r.realizado / meses)}/mês` : ''}</small>
                </span>
              </span>
              <span className="barra" aria-hidden="true">
                <span style={{ width: `${Math.max(0, r.realizado / maior) * 100}%` }} />
              </span>
              <small className="sub">
                {r.orcado ? `${pct(r.realizado / r.orcado)} do orçado (${reaisInteiros(r.orcado)})` : 'sem orçado'} · {r.bloco}
              </small>
            </button>
            {!largo && r.id === aberta && detalhe}
          </li>
        ))}
      </ul>
      {ranking.length > 8 && (
        <button type="button" className="link" onClick={() => setTodas((t) => !t)}>
          {todas ? 'Mostrar menos' : `Ver todas (${ranking.length})`}
        </button>
      )}
    </>
  )

  return (
    <Cartao
      titulo="Gastos por categoria"
      extra={meses ? `média de ${meses} ${meses === 1 ? 'mês' : 'meses'}` : undefined}
      classe="painel-largo"
    >
      {largo ? (
        <div className="lista-e-detalhe">
          <div className="lista">{lista}</div>
          <div className="detalhe">
            {categoria && <h3>{categoria.nome}</h3>}
            {detalhe}
          </div>
        </div>
      ) : (
        lista
      )}
    </Cartao>
  )
}

function DetalheCategoria({ ano, linhaId, linhas }: { ano: number; linhaId: number; linhas: LinhaAno[] }) {
  const [itens, setItens] = useState<{ chave: string; dados: ItemAno[] } | null>(null)
  const [item, setItem] = useState<string | null>(null)
  const chave = `${ano}|${linhaId}`

  useEffect(() => {
    let cancelado = false
    const pedido = `${ano}|${linhaId}`
    supabase.rpc('itens_ano', { p_ano: ano, p_linha_id: linhaId }).then(({ data }) => {
      if (!cancelado) setItens({ chave: pedido, dados: (data ?? []) as ItemAno[] })
    })
    return () => {
      cancelado = true
    }
  }, [ano, linhaId])

  const dados = useMemo(() => (itens?.chave === chave ? itens.dados : []), [itens, chave])
  const resumo = useMemo(() => {
    const m = new Map<string, { chave: string; nome: string; realizado: number; orcado: number; ordem: number }>()
    for (const d of dados) {
      const k = `${d.tipo}:${d.ref_id}`
      const r = m.get(k) ?? { chave: k, nome: d.nome, realizado: 0, orcado: 0, ordem: d.ordem }
      if (d.realizado !== null) {
        r.realizado += d.realizado
        r.orcado += d.orcado
      }
      m.set(k, r)
    }
    return [...m.values()].filter((r) => r.realizado !== 0 || r.orcado !== 0).sort((a, b) => b.realizado - a.realizado)
  }, [dados])

  const doItem = item ? dados.filter((d) => `${d.tipo}:${d.ref_id}` === item) : null
  const nomeItem = resumo.find((r) => r.chave === item)?.nome
  const realizado = doItem
    ? porMes(doItem, (ls) => somaOuNulo(ls.map((l) => l.realizado)))
    : porMes(linhas, (ls) => somaOuNulo(ls.map((l) => l.realizado)))
  const orcado = doItem ? porMes(doItem, (ls) => ls.reduce((s, l) => s + l.orcado, 0)) : porMes(linhas, (ls) => ls.reduce((s, l) => s + l.orcado, 0))

  return (
    <div className="detalhe-painel">
      <p className="rotulo">{nomeItem ? `${nomeItem} mês a mês` : 'Mês a mês'}</p>
      <Colunas rotulos={MESES} titulos={MESES.map((m) => `${m}/${ano}`)} realizado={realizado} orcado={orcado} formato={reais} />
      {resumo.length > 0 && (
        <div className="fichas">
          <button type="button" className={item === null ? 'ativo' : undefined} onClick={() => setItem(null)}>
            Todos
          </button>
          {resumo.map((r) => (
            <button key={r.chave} type="button" className={item === r.chave ? 'ativo' : undefined} onClick={() => setItem(r.chave)}>
              {r.nome} · {compacto(r.realizado)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Bens e dívidas */

function FolhaBens({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const [bens, setBens] = useState<Bem[] | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [editando, setEditando] = useState<Partial<Bem> | null>(null)
  const [valor, setValor] = useState('')
  const [em, setEm] = useState(hojeISO())
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('bem')
      .select('id,nome,natureza,ativo,bem_valor(valor,em)')
      .order('natureza')
      .order('ordem')
      .order('nome')
      .order('em', { referencedTable: 'bem_valor', ascending: false })
      .limit(1, { referencedTable: 'bem_valor' })
      .then(({ data }) => {
        if (cancelado) return
        type Linha = { id: number; nome: string; natureza: 'bem' | 'divida'; ativo: boolean; bem_valor: { valor: number; em: string }[] }
        setBens(
          ((data ?? []) as Linha[]).map((b) => ({
            id: b.id,
            nome: b.nome,
            natureza: b.natureza,
            ativo: b.ativo,
            valor: b.bem_valor[0]?.valor ?? null,
            em: b.bem_valor[0]?.em ?? null,
          })),
        )
      })
    return () => {
      cancelado = true
    }
  }, [recarga])

  function abrir(b: Partial<Bem>) {
    setErro(null)
    setEditando(b)
    setValor(b.valor != null ? b.valor.toFixed(2).replace('.', ',') : '')
    setEm(hojeISO())
  }

  async function salvar() {
    if (!editando) return
    setErro(null)
    const v = paraNumero(valor)
    const nome = (editando.nome ?? '').trim()
    if (!nome) return setErro('Dê um nome.')
    if (v === null || v < 0) return setErro('Valor inválido.')
    let id = editando.id
    if (id === undefined) {
      const { data, error } = await supabase
        .from('bem')
        .insert({ nome, natureza: editando.natureza ?? 'bem' })
        .select('id')
        .single()
      if (error || !data) return setErro('Não foi possível criar (nome repetido?).')
      id = data.id as number
    } else {
      const { error } = await supabase.from('bem').update({ nome, natureza: editando.natureza, ativo: editando.ativo ?? true }).eq('id', id)
      if (error) return setErro('Não foi possível salvar.')
    }
    const { error } = await supabase.from('bem_valor').upsert({ bem_id: id, em, valor: v }, { onConflict: 'bem_id,em' })
    if (error) return setErro('Não foi possível gravar o valor.')
    setEditando(null)
    setRecarga((r) => r + 1)
    onSalvo()
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label="Bens e dívidas">
      <div className="folha">
        <header>
          <h2>{editando ? (editando.id ? editando.nome : 'Novo') : 'Bens e dívidas'}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={editando ? () => setEditando(null) : onFechar}>
            ×
          </button>
        </header>
        {editando ? (
          <>
            <div className="linha-dupla">
              <label>
                Nome
                <input value={editando.nome ?? ''} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} placeholder="Apartamento, Carro, Financiamento" />
              </label>
            </div>
            <div className="segmentos" role="tablist" aria-label="Natureza">
              {(['bem', 'divida'] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={(editando.natureza ?? 'bem') === n}
                  className={(editando.natureza ?? 'bem') === n ? 'ativo' : undefined}
                  onClick={() => setEditando({ ...editando, natureza: n })}
                >
                  {n === 'bem' ? 'Bem' : 'Dívida'}
                </button>
              ))}
            </div>
            <div className="linha-dupla">
              <label>
                {(editando.natureza ?? 'bem') === 'bem' ? 'Quanto vale (R$)' : 'Saldo devedor (R$)'}
                <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
              </label>
              <label>
                Em
                <input type="date" value={em} onChange={(e) => setEm(e.target.value)} />
              </label>
            </div>
            {editando.id !== undefined && (
              <label className="marcar">
                <input type="checkbox" checked={editando.ativo === false} onChange={(e) => setEditando({ ...editando, ativo: !e.target.checked })} />
                Não tenho mais (sai do patrimônio)
              </label>
            )}
            {editando.em && <p className="origem">Último valor: {reais(editando.valor ?? 0)} em {editando.em.split('-').reverse().join('/')}. O novo fica guardado junto, com a data.</p>}
            {erro && <p className="erro">{erro}</p>}
            <button type="button" className="principal" onClick={salvar}>
              Salvar
            </button>
          </>
        ) : (
          <>
            <p className="origem">Valores que você atualiza de vez em quando. Dívida entra negativa no patrimônio.</p>
            <ul className="lista-painel">
              {(bens ?? []).map((b) => (
                <li key={b.id}>
                  <button type="button" className="linha-ranking" onClick={() => abrir(b)}>
                    <span className="linha-painel">
                      <span>
                        {b.nome} <small>{b.natureza === 'bem' ? 'bem' : 'dívida'}{b.ativo ? '' : ' · fora'}</small>
                      </span>
                      <span>{b.valor !== null ? reais(b.natureza === 'divida' ? -b.valor : b.valor) : '–'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {bens && bens.length === 0 && <p className="origem">Nenhum ainda.</p>}
            <button type="button" className="principal" onClick={() => abrir({ natureza: 'bem' })}>
              Adicionar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

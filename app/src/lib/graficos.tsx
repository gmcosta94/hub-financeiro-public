import { compacto } from './formato'
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

/**
 * Gráficos dos painéis, em SVG desenhado à mão (sem biblioteca).
 * Cores por papel em index.css (--serie-1..3, --grade, --eixo, --mudo); texto nunca
 * usa a cor da série. Toda coluna e todo ponto mostram o valor ao passar o dedo ou o
 * mouse, e cada gráfico tem a tabela com os mesmos números.
 */

const ALTURA = 180
const MARGEM = { topo: 8, dir: 8, base: 22, esq: 44 }

function useLargura() {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(320)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(240, Math.floor(e.contentRect.width))))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return [ref, largura] as const
}

/** Marcas redondas do eixo: 0, 5 mil, 10 mil... (ou percentuais). */
function marcas(min: number, max: number, n = 4): number[] {
  if (min === max) max = min + 1
  const passoBruto = (max - min) / n
  const pot = 10 ** Math.floor(Math.log10(passoBruto))
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= passoBruto) ?? passoBruto
  const ini = Math.floor(min / passo) * passo
  const fim = Math.ceil(max / passo) * passo
  const out: number[] = []
  for (let v = ini; v <= fim + passo / 2; v += passo) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

type Dica = { x: number; titulo: string; linhas: { nome: string; valor: string; serie: number; tipo: 'barra' | 'linha' }[] }

function Tooltip({ dica, largura }: { dica: Dica | null; largura: number }) {
  if (!dica) return null
  const esquerda = Math.min(Math.max(dica.x - 92, 0), largura - 184)
  return (
    <div className="dica" style={{ left: esquerda }} role="status">
      <span className="dica-titulo">{dica.titulo}</span>
      {dica.linhas.map((l) => (
        <span key={l.nome} className="dica-linha">
          <i className={`chave chave-${l.tipo} s${l.serie}`} aria-hidden="true" />
          <strong>{l.valor}</strong>
          <span>{l.nome}</span>
        </span>
      ))}
    </div>
  )
}

/** Classe da cor de uma série: número da paleta (s1…s4) ou uma cor nomeada (cor-carteira…). */
const classeSerie = (serie: number | string) => (typeof serie === 'number' ? `s${serie}` : serie)

export function Legenda({ itens }: { itens: { nome: string; serie: number | string; tipo: 'barra' | 'linha' }[] }) {
  return (
    <div className="legenda">
      {itens.map((i) => (
        <span key={i.nome}>
          <i className={`chave chave-${i.tipo} ${classeSerie(i.serie)}`} aria-hidden="true" />
          {i.nome}
        </span>
      ))}
    </div>
  )
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: string[][] }) {
  return (
    <details className="tabela-grafico">
      <summary>Ver tabela</summary>
      <table>
        <thead>
          <tr>
            {cabecalho.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>
              {l.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Coluna com a ponta arredondada (4px) e a base reta, para cima ou para baixo. */
function coluna(x: number, largura: number, yBase: number, yPonta: number): string {
  const h = Math.abs(yBase - yPonta)
  const r = Math.min(4, h, largura / 2)
  if (h < 0.5) return ''
  if (yPonta < yBase) {
    return `M${x},${yBase}V${yPonta + r}Q${x},${yPonta} ${x + r},${yPonta}H${x + largura - r}Q${x + largura},${yPonta} ${x + largura},${yPonta + r}V${yBase}Z`
  }
  return `M${x},${yBase}V${yPonta - r}Q${x},${yPonta} ${x + r},${yPonta}H${x + largura - r}Q${x + largura},${yPonta} ${x + largura},${yPonta - r}V${yBase}Z`
}

/**
 * Colunas do realizado mês a mês, com o orçado como um traço sobre cada mês.
 * Mês sem realizado (futuro) mostra só o traço.
 */
export function Colunas({
  rotulos,
  realizado,
  orcado,
  formato,
  titulos,
  nomes = { realizado: 'Realizado', orcado: 'Orçado' },
}: {
  rotulos: string[]
  realizado: (number | null)[]
  orcado?: (number | null)[]
  formato: (v: number) => string
  titulos?: string[]
  nomes?: { realizado: string; orcado: string }
}) {
  const [ref, largura] = useLargura()
  const [foco, setFoco] = useState<number | null>(null)
  const valores = [...realizado, ...(orcado ?? [])].filter((v): v is number => v !== null)
  const ticks = marcas(Math.min(0, ...valores), Math.max(0, ...valores))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const areaL = largura - MARGEM.esq - MARGEM.dir
  const areaA = ALTURA - MARGEM.topo - MARGEM.base
  const banda = areaL / rotulos.length
  const larg = Math.min(24, banda * 0.6)
  const y = (v: number) => MARGEM.topo + ((yMax - v) / (yMax - yMin || 1)) * areaA
  const x0 = (i: number) => MARGEM.esq + i * banda
  const passoRotulo = banda < 26 ? 2 : 1

  const dica: Dica | null =
    foco === null
      ? null
      : {
          x: x0(foco) + banda / 2,
          titulo: titulos?.[foco] ?? rotulos[foco],
          linhas: [
            ...(realizado[foco] !== null
              ? [{ nome: nomes.realizado, valor: formato(realizado[foco]!), serie: 1, tipo: 'barra' as const }]
              : []),
            ...(orcado && orcado[foco] !== null
              ? [{ nome: nomes.orcado, valor: formato(orcado[foco]!), serie: 2, tipo: 'linha' as const }]
              : []),
          ],
        }

  return (
    <div className="grafico">
      {orcado && (
        <Legenda
          itens={[
            { nome: nomes.realizado, serie: 1, tipo: 'barra' },
            { nome: nomes.orcado, serie: 2, tipo: 'linha' },
          ]}
        />
      )}
      <div className="area-grafico" ref={ref} onPointerLeave={() => setFoco(null)}>
        <svg width={largura} height={ALTURA} role="img" aria-label={`${nomes.realizado} por mês`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGEM.esq} x2={largura - MARGEM.dir} y1={y(t)} y2={y(t)} className={t === 0 ? 'eixo' : 'grade'} />
              <text x={MARGEM.esq - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {compacto(t)}
              </text>
            </g>
          ))}
          {rotulos.map((r, i) => (
            <g key={r + i}>
              {realizado[i] !== null && (
                <path
                  d={coluna(x0(i) + (banda - larg) / 2, larg, y(0), y(realizado[i]!))}
                  className={`marca s1${foco === i ? ' em-foco' : ''}`}
                />
              )}
              {orcado && orcado[i] !== null && (
                <line
                  x1={x0(i) + banda * 0.12}
                  x2={x0(i) + banda * 0.88}
                  y1={y(orcado[i]!)}
                  y2={y(orcado[i]!)}
                  className="traco s2"
                />
              )}
              {i % passoRotulo === 0 && (
                <text x={x0(i) + banda / 2} y={ALTURA - 6} className="tick" textAnchor="middle">
                  {r}
                </text>
              )}
              <rect
                x={x0(i)}
                y={MARGEM.topo}
                width={banda}
                height={areaA}
                className="alvo"
                tabIndex={0}
                aria-label={`${titulos?.[i] ?? r}: ${realizado[i] !== null ? formato(realizado[i]!) : 'sem realizado'}`}
                onPointerEnter={() => setFoco(i)}
                onPointerDown={() => setFoco(i)}
                onFocus={() => setFoco(i)}
                onBlur={() => setFoco(null)}
              />
            </g>
          ))}
        </svg>
        <Tooltip dica={dica} largura={largura} />
      </div>
      <Tabela
        cabecalho={['Mês', nomes.realizado, ...(orcado ? [nomes.orcado] : [])]}
        linhas={rotulos.map((r, i) => [
          titulos?.[i] ?? r,
          realizado[i] !== null ? formato(realizado[i]!) : '–',
          ...(orcado ? [orcado[i] !== null ? formato(orcado[i]!) : '–'] : []),
        ])}
      />
    </div>
  )
}

/**
 * Linhas no tempo, com a linha vertical que acompanha o dedo e mostra todas as séries
 * do mês. Valor nulo interrompe a linha; ponto isolado vira um marcador.
 */
export function Linhas({
  rotulos,
  titulos,
  series,
  formato,
  formatoEixo = compacto,
  passoRotulo,
}: {
  rotulos: string[]
  titulos?: string[]
  series: { nome: string; valores: (number | null)[]; serie: number }[]
  formato: (v: number) => string
  formatoEixo?: (v: number) => string
  passoRotulo?: number
}) {
  const [ref, largura] = useLargura()
  const [foco, setFoco] = useState<number | null>(null)
  const valores = series.flatMap((s) => s.valores).filter((v): v is number => v !== null)
  const ticks = marcas(Math.min(0, ...valores), Math.max(0, ...valores))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const areaL = largura - MARGEM.esq - MARGEM.dir
  const areaA = ALTURA - MARGEM.topo - MARGEM.base
  const n = rotulos.length
  const x = (i: number) => MARGEM.esq + (n === 1 ? areaL / 2 : (i / (n - 1)) * areaL)
  const y = (v: number) => MARGEM.topo + ((yMax - v) / (yMax - yMin || 1)) * areaA
  const passo = passoRotulo ?? Math.max(1, Math.ceil(n / Math.max(2, Math.floor(areaL / 48))))
  // Rótulos do eixo x: um a cada `passo`, pulando os que encostariam no anterior.
  const rotulosVisiveis: number[] = []
  for (let i = 0; i < n; i += passo) {
    if (!rotulos[i]) continue
    const ant = rotulosVisiveis[rotulosVisiveis.length - 1]
    if (ant === undefined || x(i) - x(ant) >= 8 * Math.max(rotulos[i].length, rotulos[ant].length)) rotulosVisiveis.push(i)
  }

  function caminho(vs: (number | null)[]) {
    let d = ''
    let aberto = false
    vs.forEach((v, i) => {
      if (v === null) {
        aberto = false
        return
      }
      d += `${aberto ? 'L' : 'M'}${x(i)},${y(v)}`
      aberto = true
    })
    return d
  }
  const isolados = (vs: (number | null)[]) =>
    vs.map((v, i) => (v !== null && (vs[i - 1] ?? null) === null && (vs[i + 1] ?? null) === null ? i : -1)).filter((i) => i >= 0)
  const ultimo = (vs: (number | null)[]) => vs.reduce<number>((u, v, i) => (v !== null ? i : u), -1)

  function mover(e: PointerEvent<SVGRectElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - caixa.left
    setFoco(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / caixa.width) * (n - 1)))))
  }

  const dica: Dica | null =
    foco === null
      ? null
      : {
          x: x(foco),
          titulo: titulos?.[foco] ?? rotulos[foco],
          linhas: series
            .filter((s) => s.valores[foco] !== null)
            .map((s) => ({ nome: s.nome, valor: formato(s.valores[foco]!), serie: s.serie, tipo: 'linha' as const })),
        }

  return (
    <div className="grafico">
      {series.length > 1 && <Legenda itens={series.map((s) => ({ nome: s.nome, serie: s.serie, tipo: 'linha' }))} />}
      <div className="area-grafico" ref={ref} onPointerLeave={() => setFoco(null)}>
        <svg width={largura} height={ALTURA} role="img" aria-label={series.map((s) => s.nome).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGEM.esq} x2={largura - MARGEM.dir} y1={y(t)} y2={y(t)} className={t === 0 ? 'eixo' : 'grade'} />
              <text x={MARGEM.esq - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {formatoEixo(t)}
              </text>
            </g>
          ))}
          {rotulosVisiveis.map((i) => (
            <text key={i} x={x(i)} y={ALTURA - 6} className="tick" textAnchor="middle">
              {rotulos[i]}
            </text>
          ))}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={MARGEM.topo} y2={MARGEM.topo + areaA} className="mira" />}
          {series.map((s) => (
            <g key={s.nome}>
              <path d={caminho(s.valores)} className={`linha s${s.serie}`} />
              {[...new Set([...isolados(s.valores), ultimo(s.valores), ...(foco !== null && s.valores[foco] !== null ? [foco] : [])])]
                .filter((i) => i >= 0)
                .map((i) => (
                  <circle key={i} cx={x(i)} cy={y(s.valores[i]!)} r={4} className={`ponto s${s.serie}`} />
                ))}
            </g>
          ))}
          <rect
            x={MARGEM.esq - 8}
            y={MARGEM.topo}
            width={areaL + 16}
            height={areaA}
            className="alvo"
            tabIndex={0}
            aria-label="Passe o dedo para ver os valores de cada mês"
            onPointerMove={mover}
            onPointerDown={mover}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setFoco((f) => Math.min(n - 1, (f ?? -1) + 1))
              if (e.key === 'ArrowLeft') setFoco((f) => Math.max(0, (f ?? n) - 1))
            }}
            onBlur={() => setFoco(null)}
          />
        </svg>
        <Tooltip dica={dica} largura={largura} />
      </div>
      <Tabela
        cabecalho={['Mês', ...series.map((s) => s.nome)]}
        linhas={rotulos
          .map((r, i) => [titulos?.[i] ?? r, ...series.map((s) => (s.valores[i] !== null ? formato(s.valores[i]!) : '–'))])
          .filter((l) => l.slice(1).some((c) => c !== '–'))}
      />
    </div>
  )
}

/** Barra segmentada (um todo dividido em partes), com a legenda e o valor de cada parte. */
export function Segmentos({
  partes,
  formato,
}: {
  partes: { nome: string; valor: number; serie: number | string }[]
  formato: (v: number) => string
}) {
  const positivas = partes.filter((p) => p.valor > 0)
  const total = positivas.reduce((s, p) => s + p.valor, 0)
  if (total <= 0) return null
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`
  return (
    <div className="segmentado">
      <div className="barra-segmentada" role="img" aria-label={positivas.map((p) => `${p.nome} ${formato(p.valor)} (${pct(p.valor)})`).join('; ')}>
        {positivas.map((p) => (
          <span key={p.nome} className={classeSerie(p.serie)} style={{ flexGrow: p.valor }} title={`${p.nome}: ${formato(p.valor)}`}>
            {p.valor / total >= 0.12 ? pct(p.valor) : ''}
          </span>
        ))}
      </div>
      <Legenda itens={positivas.map((p) => ({ nome: p.nome, serie: p.serie, tipo: 'barra' }))} />
    </div>
  )
}

export function Cartao({
  titulo,
  extra,
  classe,
  children,
}: {
  titulo: string
  extra?: ReactNode
  classe?: string
  children: ReactNode
}) {
  return (
    <section className={classe ? `painel ${classe}` : 'painel'}>
      <h2>
        <span>{titulo}</span>
        {extra && <span>{extra}</span>}
      </h2>
      <div className="painel-corpo">{children}</div>
    </section>
  )
}

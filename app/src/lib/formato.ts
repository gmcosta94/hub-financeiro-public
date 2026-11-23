const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const diaSemana = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

export const reais = (valor: number) => moeda.format(valor)

/** '2026-11-01' -> 'novembro de 2026' */
export const nomeDoMes = (competencia: string) => mesAno.format(new Date(competencia + 'T00:00:00Z'))

/** '2026-11-12' -> 'qui., 12 de nov.' */
export const nomeDoDia = (data: string) => diaSemana.format(new Date(data + 'T00:00:00Z'))

/** '2026-11-01' -> 'nov/26' */
export function mesCurto(competencia: string): string {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const [ano, mes] = competencia.split('-').map(Number)
  return `${meses[mes - 1]}/${String(ano).slice(2)}`
}

/** Competência (dia 1) do mês de hoje, no fuso local. */
export function competenciaAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`
}

/** Data de hoje no fuso local, 'AAAA-MM-DD'. */
export function hojeISO(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
}

/**
 * Converte o que foi digitado em número: aceita '12,50', '12.50', '1.234,56' e 'R$ 22,00'.
 * Devolve null se não for um valor.
 */
export function paraNumero(texto: string): number | null {
  let t = texto.replace(/[^\d,.-]/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Soma (ou subtrai) meses de uma competência 'AAAA-MM-01'. */
export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Eixo em reais: 950, 1,5 mil, 20 mil, 1,2 mi. */
export function compacto(v: number): string {
  const a = Math.abs(v)
  const f = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (a >= 1e6) return `${f(v / 1e6)} mi`
  if (a >= 1e3) return `${f(v / 1e3)} mil`
  return f(v)
}

const CENTAVOS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Centavos (inteiro) no formato do campo de valor: 123456 -> '1.234,56'. */
export const centavosTexto = (centavos: number) => CENTAVOS.format(centavos / 100)

/**
 * Valor digitado como numa maquininha: os dígitos entram pelos centavos
 * ("59821" vira 598,21). Um "-" em qualquer lugar deixa o valor negativo (estorno).
 * Devolve null quando passa de 11 dígitos (a tecla é ignorada).
 */
export function lerDigitado(texto: string): { centavos: number | null; negativo: boolean } | null {
  const digitos = texto.replace(/\D/g, '').replace(/^0+/, '')
  if (digitos.length > 11) return null
  return { centavos: digitos ? Number(digitos) : null, negativo: texto.includes('-') }
}

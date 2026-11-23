import { supabase } from './supabase'
import { competenciaAtual, somarMeses } from './formato'

/**
 * Mantém a série mensal do CDI (Banco Central, SGS 4391, % ao mês) no banco.
 * Busca só os meses que faltam e grava só meses fechados (o do mês corrente vem
 * parcial). Quem pode gravar é o editor; para os outros, nada acontece.
 * A chamada ao Banco Central leva só a série e a data: nenhum dado do hub.
 * Devolve quantos meses gravou.
 */
export async function atualizarCdi(): Promise<number> {
  return atualizarSerie('CDI', 4391)
}

/** IPCA mensal (Banco Central, SGS 433, % ao mês), para a rentabilidade real. */
export async function atualizarIpca(): Promise<number> {
  return atualizarSerie('IPCA', 433)
}

async function atualizarSerie(nome: string, codigo: number): Promise<number> {
  const { data } = await supabase
    .from('indice')
    .select('competencia')
    .eq('nome', nome)
    .order('competencia', { ascending: false })
    .limit(1)
  const ultimo = (data?.[0] as { competencia: string } | undefined)?.competencia ?? null
  const mesAtual = competenciaAtual()
  if (ultimo && ultimo >= somarMeses(mesAtual, -1)) return 0

  const desde = ultimo ? somarMeses(ultimo, 1) : '2017-01-01'
  const [ano, mes] = desde.split('-')
  try {
    const resposta = await fetch(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=01/${mes}/${ano}`,
    )
    if (!resposta.ok) return 0
    const lista = (await resposta.json()) as { data: string; valor: string }[]
    const valores = lista
      .map((x) => ({ competencia: `${x.data.slice(6, 10)}-${x.data.slice(3, 5)}-01`, valor: Number(x.valor) }))
      .filter((v) => v.competencia < mesAtual && Number.isFinite(v.valor))
    if (valores.length === 0) return 0
    const { data: gravados } = await supabase.rpc('gravar_indice', { p_nome: nome, p_valores: valores })
    return typeof gravados === 'number' ? gravados : 0
  } catch {
    return 0 // sem rede ou fonte fora do ar: a conta usa o último mês que já está no banco
  }
}

/**
 * Câmbio USD/BRL do dia (Banco Central, SGS 1: dólar comercial, venda). Busca os
 * últimos dias úteis quando o banco ainda não tem o de hoje. Um câmbio digitado à
 * mão não é sobrescrito. Devolve quantos dias gravou.
 */
export async function atualizarCambio(): Promise<number> {
  const { data } = await supabase.from('cambio').select('data').order('data', { ascending: false }).limit(1)
  const ultimo = (data?.[0] as { data: string } | undefined)?.data ?? null
  const hoje = new Date().toISOString().slice(0, 10)
  if (ultimo && ultimo >= hoje) return 0
  try {
    const resposta = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/5?formato=json')
    if (!resposta.ok) return 0
    const lista = (await resposta.json()) as { data: string; valor: string }[]
    const valores = lista
      .map((x) => ({ data: `${x.data.slice(6, 10)}-${x.data.slice(3, 5)}-${x.data.slice(0, 2)}`, valor: Number(x.valor) }))
      .filter((v) => Number.isFinite(v.valor) && (!ultimo || v.data > ultimo))
    if (valores.length === 0) return 0
    const { data: gravados } = await supabase.rpc('gravar_cambio', { p_valores: valores })
    return typeof gravados === 'number' ? gravados : 0
  } catch {
    return 0
  }
}

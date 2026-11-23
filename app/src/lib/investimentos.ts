import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { atualizarIpca } from './indices'
import type { Projeto } from '../telas/Projetos'

/**
 * Dados da aba Investimentos que mais de um cartão usa: a rentabilidade de cada
 * bolso e o objetivo aposentadoria (rentabilidade_investimentos, objetivo_situacao)
 * e a reserva de emergência (projetos_situacao do bolso da reserva).
 */

export type BolsoInvest = { id: number; nome: string; tipo: string }
export type Rent = {
  inicio: string | null
  aportado: number | null
  proventos: number | null
  valor_atual: number | null
  ganho: number | null
  taxa_nominal: number | null
  taxa_real: number | null
}
export type Objetivo = {
  objetivo_id: number
  nome: string
  renda_mensal_alvo: number
  taxa_retirada_anual: number
  taxa_real_anual: number
  data_alvo: string
  bolsos: string | null
  alvo: number
  valor_atual: number
  progresso: number
  meses: number
  aporte_premissa: number
  taxa_real_realizada: number | null
  aporte_realizada: number | null
}
export type DadosRentabilidade = {
  /** Uma linha por bolso de investimento e, por último, todos juntos (bolso nulo). */
  linhas: { nome: string; bolso: BolsoInvest | null; r: Rent | undefined }[]
  objetivos: Objetivo[]
  bolsos: BolsoInvest[]
}
export type SituacaoReserva = Projeto & { bolso_id: number }
export type DadosReserva = { reserva: SituacaoReserva | null; bolsoId: number | null }

const TIPOS = ['carteira_principal', 'carteira_satelite', 'previdencia']

/** Rentabilidade e objetivos; atualiza o IPCA (só quem edita) e recarrega quando muda. */
export function useRentabilidade(versao: number, podeEditar: boolean) {
  const [interna, setInterna] = useState(0)
  const [dados, setDados] = useState<DadosRentabilidade | null>(null)

  useEffect(() => {
    if (!podeEditar) return
    let cancelado = false
    atualizarIpca().then((n) => {
      if (!cancelado && n > 0) setInterna((v) => v + 1)
    })
    return () => {
      cancelado = true
    }
  }, [podeEditar])

  useEffect(() => {
    let cancelado = false
    supabase
      .from('bolso')
      .select('id,nome,tipo')
      .in('tipo', TIPOS)
      .order('id')
      .then(async ({ data }) => {
        // Principal, satélite e previdência, nessa ordem.
        const bolsos = ((data ?? []) as BolsoInvest[]).sort((x, y) => TIPOS.indexOf(x.tipo) - TIPOS.indexOf(y.tipo))
        const respostas = await Promise.all([
          ...bolsos.map((b) => supabase.rpc('rentabilidade_investimentos', { p_bolsos: [b.id] })),
          supabase.rpc('rentabilidade_investimentos', { p_bolsos: bolsos.map((b) => b.id) }),
          supabase.rpc('objetivo_situacao'),
        ])
        if (cancelado) return
        const primeira = (r: { data: unknown }) => ((r.data ?? []) as Rent[])[0]
        setDados({
          linhas: [
            ...bolsos.map((b, i) => ({ nome: b.nome, bolso: b, r: primeira(respostas[i]) })),
            { nome: 'Todos os investimentos', bolso: null, r: primeira(respostas[bolsos.length]) },
          ],
          objetivos: (respostas[bolsos.length + 1].data ?? []) as Objetivo[],
          bolsos,
        })
      })
    return () => {
      cancelado = true
    }
  }, [versao, interna])

  return { dados, recarregar: () => setInterna((v) => v + 1) }
}

/** A reserva de emergência: saldo estimado, objetivo e prazo. */
export function useReserva(versao: number) {
  const [interna, setInterna] = useState(0)
  const [dados, setDados] = useState<DadosReserva | null>(null)

  useEffect(() => {
    let cancelado = false
    Promise.all([
      supabase.rpc('projetos_situacao'),
      supabase.from('bolso').select('id,projeto_id').eq('tipo', 'reserva').limit(1).maybeSingle(),
    ]).then(([s, b]) => {
      if (cancelado) return
      const bolso = b.data as { id: number; projeto_id: number | null } | null
      const reserva = ((s.data ?? []) as SituacaoReserva[]).find((x) => bolso && x.projeto_id === bolso.projeto_id) ?? null
      setDados({ reserva, bolsoId: bolso?.id ?? null })
    })
    return () => {
      cancelado = true
    }
  }, [versao, interna])

  return { dados, recarregar: () => setInterna((v) => v + 1) }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Filtro de categorias com seleção múltipla, na ordem da demonstração de Resultados
 * (Ganhos, Descontos, Poupança e Investimentos, Metas, Custo de Vida, Fora do Custo de
 * Vida), agrupado pelos blocos. Marcar o bloco marca todas as categorias dele.
 * Nenhuma marcada = todas.
 */

type Categoria = { id: number; nome: string; grupo: string; ordem: number }

const ORDEM_GRUPO: Record<string, number> = {
  Ganhos: 1,
  Descontos: 2,
  'Poupança e Investimentos': 3,
  Metas: 4,
  'Custo de Vida': 5,
  'Fora do Custo de Vida': 6,
}
const SEM_CATEGORIA = 'Sem categoria' // o mesmo rótulo da lista de lançamentos

export function FiltroCategorias({
  escolhidas,
  contagem,
  onMudar,
}: {
  escolhidas: Set<string>
  /** Quantos lançamentos do mês há em cada categoria (pelo nome). */
  contagem: Map<string, number>
  onMudar: (escolhidas: Set<string>) => void
}) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('v_categoria')
      .select('id,nome,grupo,ordem')
      .then(({ data }) => {
        if (!cancelado) setCategorias((data ?? []) as Categoria[])
      })
    return () => {
      cancelado = true
    }
  }, [])

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  const grupos = useMemo(() => {
    const m = new Map<string, Categoria[]>()
    for (const c of [...categorias].sort((a, b) => (ORDEM_GRUPO[a.grupo] ?? 9) - (ORDEM_GRUPO[b.grupo] ?? 9) || a.ordem - b.ordem)) {
      m.set(c.grupo, [...(m.get(c.grupo) ?? []), c])
    }
    return [...m.entries()]
  }, [categorias])

  function alternar(nomes: string[], marcar: boolean) {
    const n = new Set(escolhidas)
    for (const nome of nomes) {
      if (marcar) n.add(nome)
      else n.delete(nome)
    }
    onMudar(n)
  }

  const rotulo =
    escolhidas.size === 0 ? 'Todas as categorias' : escolhidas.size === 1 ? [...escolhidas][0] : `${escolhidas.size} categorias`
  const semCategoria = contagem.get(SEM_CATEGORIA) ?? 0

  return (
    <div className="filtro-multiplo" ref={caixa}>
      <button
        type="button"
        className={escolhidas.size ? 'filtro-botao com-filtro' : 'filtro-botao'}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        {rotulo}
      </button>
      {aberto && (
        <div className="filtro-lista" role="listbox" aria-multiselectable="true" aria-label="Categorias">
          <div className="filtro-topo">
            <span>{escolhidas.size ? `${escolhidas.size} marcadas` : 'Nenhuma marcada: todas aparecem'}</span>
            {escolhidas.size > 0 && (
              <button type="button" className="link" onClick={() => onMudar(new Set())}>
                Limpar
              </button>
            )}
          </div>
          {grupos.map(([grupo, lista]) => {
            const nomes = lista.map((c) => c.nome)
            const todas = nomes.every((n) => escolhidas.has(n))
            const algumas = !todas && nomes.some((n) => escolhidas.has(n))
            return (
              <div key={grupo} className="filtro-grupo">
                <label className="filtro-opcao grupo">
                  <input
                    type="checkbox"
                    checked={todas}
                    ref={(el) => {
                      if (el) el.indeterminate = algumas
                    }}
                    onChange={(e) => alternar(nomes, e.target.checked)}
                  />
                  {grupo}
                </label>
                {lista.map((c) => {
                  const n = contagem.get(c.nome) ?? 0
                  return (
                    <label key={c.id} className={n ? 'filtro-opcao' : 'filtro-opcao vazia'}>
                      <input
                        type="checkbox"
                        checked={escolhidas.has(c.nome)}
                        onChange={(e) => alternar([c.nome], e.target.checked)}
                      />
                      <span>{c.nome}</span>
                      {n > 0 && <small>{n}</small>}
                    </label>
                  )
                })}
              </div>
            )
          })}
          {semCategoria > 0 && (
            <div className="filtro-grupo">
              <label className="filtro-opcao">
                <input
                  type="checkbox"
                  checked={escolhidas.has(SEM_CATEGORIA)}
                  onChange={(e) => alternar([SEM_CATEGORIA], e.target.checked)}
                />
                <span>{SEM_CATEGORIA}</span>
                <small>{semCategoria}</small>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

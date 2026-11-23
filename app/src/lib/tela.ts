import { useSyncExternalStore } from 'react'

// Mesmo ponto de quebra do CSS (index.css, "Computador"): coluna lateral e telas em grade.
const LARGO = '(min-width: 1024px)'

function assinar(avisar: () => void) {
  const m = window.matchMedia(LARGO)
  m.addEventListener('change', avisar)
  return () => m.removeEventListener('change', avisar)
}

/** true quando a janela é de computador (layout largo). */
export function useLargo() {
  return useSyncExternalStore(assinar, () => window.matchMedia(LARGO).matches)
}

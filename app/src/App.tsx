import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Login } from './telas/Login'
import { Lancamentos } from './telas/Lancamentos'
import { Atalho } from './telas/Atalho'
import { Cadastros } from './telas/Cadastros'
import { Orcamento } from './telas/Orcamento'
import { Projetos } from './telas/Projetos'
import { Carteira } from './telas/Carteira'
import { Paineis } from './telas/Paineis'
import { Resultados } from './telas/Resultados'

type Tela = 'paineis' | 'lancamentos' | 'orcamento' | 'resultados' | 'projetos' | 'carteira' | 'cadastros'
// Cor de cada tela (index.css, "--area-*"): o horizonte de tempo do dinheiro.
const AREA: Record<Tela, string> = {
  paineis: 'area-geral',
  lancamentos: 'area-dia',
  orcamento: 'area-dia',
  resultados: 'area-dia',
  projetos: 'area-projetos',
  carteira: 'area-carteira',
  cadastros: 'area-geral',
}

const PRINCIPAIS: { id: Tela; nome: string }[] = [
  { id: 'paineis', nome: 'Painéis' },
  { id: 'lancamentos', nome: 'Lançamentos' },
  { id: 'orcamento', nome: 'Orçamento' },
  { id: 'resultados', nome: 'Resultados' },
  { id: 'projetos', nome: 'Projetos' },
  { id: 'carteira', nome: 'Investimentos' },
]

export default function App() {
  // undefined = ainda verificando; null = sem login.
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined)
  // Papel de quem entrou; o banco é quem de fato permite ou barra a escrita.
  const [papel, setPapel] = useState<{ userId: string; valor: string | null } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const [atalhoAberto, setAtalhoAberto] = useState(false)
  const [tela, setTela] = useState<Tela>('paineis')

  const userId = sessao?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelado = false
    supabase
      .from('membro')
      .select('papel')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) setPapel({ userId, valor: data?.papel ?? null })
      })
    return () => {
      cancelado = true
    }
  }, [userId])

  if (sessao === undefined) return null
  if (sessao === null) return <Login />

  const editor = papel?.userId === sessao.user.id && papel.valor === 'editor'

  const emCadastros = tela === 'cadastros' && editor

  // No celular: abas em cima, conteúdo e rodapé embaixo. No computador (CSS, a partir
  // de 1024px): abas e rodapé viram a coluna lateral fixa, e o conteúdo ocupa o resto.
  return (
    <div className="app">
      <nav className={emCadastros ? 'navegacao em-cadastros' : 'navegacao'}>
        <strong className="marca">Hub Financeiro</strong>
        <div className="segmentos abas" role="tablist">
          {PRINCIPAIS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tela === t.id}
              className={tela === t.id ? `${AREA[t.id]} ativo` : AREA[t.id]}
              onClick={() => setTela(t.id)}
            >
              {t.nome}
            </button>
          ))}
        </div>
      </nav>
      <div className={`conteudo ${AREA[emCadastros ? 'cadastros' : tela === 'cadastros' ? 'lancamentos' : tela]}`}>
        {emCadastros ? (
          <Cadastros onVoltar={() => setTela('lancamentos')} />
        ) : tela === 'paineis' ? (
          <Paineis podeEditar={editor} />
        ) : tela === 'orcamento' ? (
          <Orcamento podeEditar={editor} />
        ) : tela === 'resultados' ? (
          <Resultados />
        ) : tela === 'projetos' ? (
          <Projetos podeEditar={editor} />
        ) : tela === 'carteira' ? (
          <Carteira podeEditar={editor} />
        ) : (
          <Lancamentos podeEditar={editor} />
        )}
      </div>
      <footer className="rodape">
        <span className="email">{sessao.user.email}</span>
        <span className="acoes">
          {editor && (
            <button className={emCadastros ? 'ativo' : undefined} onClick={() => setTela('cadastros')}>
              Cadastros
            </button>
          )}
          {editor && <button onClick={() => setAtalhoAberto(true)}>Atalho</button>}
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </span>
      </footer>
      {atalhoAberto && <Atalho onFechar={() => setAtalhoAberto(false)} />}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Token = { id: number; nome: string; ativo: boolean; ultimo_uso: string | null; criado_em: string }

const URL_ATALHO = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/registrar_atalho`
const CHAVE_PUBLICA = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Um valor para copiar e colar no app Atalhos. */
function Copiavel({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // sem permissão de área de transferência: o texto continua selecionável
    }
  }
  return (
    <div className="copiavel">
      <span className="rotulo">{rotulo}</span>
      <code>{valor}</code>
      <button type="button" className="discreto" onClick={copiar}>
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

/**
 * Configuração do atalho do Apple Pay: gera o token e mostra o que colar no
 * app Atalhos. O token só aparece uma vez; o banco guarda apenas o hash.
 */
export function Atalho({ onFechar }: { onFechar: () => void }) {
  const [tokens, setTokens] = useState<Token[]>([])
  const [novo, setNovo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('token_atalho')
      .select('id,nome,ativo,ultimo_uso,criado_em')
      .order('id', { ascending: false })
      .then(({ data }) => {
        if (!cancelado) setTokens((data ?? []) as Token[])
      })
    return () => {
      cancelado = true
    }
  }, [versao])

  async function gerar() {
    setErro(null)
    const { data, error } = await supabase.rpc('criar_token_atalho', { p_nome: 'iPhone' })
    if (error || typeof data !== 'string') setErro('Não foi possível gerar o token.')
    else {
      setNovo(data)
      setVersao((v) => v + 1)
    }
  }

  async function desativar(id: number) {
    const { error } = await supabase.from('token_atalho').update({ ativo: false }).eq('id', id)
    if (error) setErro('Não foi possível desativar.')
    else setVersao((v) => v + 1)
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label="Atalho do Apple Pay">
      <div className="folha">
        <header>
          <h2>Atalho do Apple Pay</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>

        <p className="origem">
          Cada compra por aproximação entra aqui como lançamento para revisar. O token só permite
          isso: criar lançamentos pendentes. Ele não lê nem altera nada.
        </p>

        {novo ? (
          <>
            <p className="rotulo">Copie agora. O token não será mostrado de novo.</p>
            <Copiavel rotulo="Token" valor={novo} />
            <Copiavel rotulo="URL" valor={URL_ATALHO} />
            <Copiavel rotulo="Cabeçalho apikey" valor={CHAVE_PUBLICA} />
            <p className="origem">
              No atalho, a ação "Obter Conteúdo de URL" usa método POST, o cabeçalho <code>apikey</code>{' '}
              e um corpo JSON com os campos <code>p_token</code>, <code>p_comerciante</code>,{' '}
              <code>p_valor</code> e <code>p_cartao</code>.
            </p>
          </>
        ) : (
          <button type="button" className="principal" onClick={gerar}>
            Gerar token
          </button>
        )}

        {erro && <p className="erro">{erro}</p>}

        {tokens.length > 0 && (
          <>
            <p className="rotulo">Tokens</p>
            <ul className="tokens">
              {tokens.map((t) => (
                <li key={t.id}>
                  <span className="texto">
                    <span className="nome">
                      {t.nome} {t.ativo ? '' : '(desativado)'}
                    </span>
                    <span className="detalhe">
                      Criado em {quando.format(new Date(t.criado_em))}
                      {t.ultimo_uso ? ` · último uso ${quando.format(new Date(t.ultimo_uso))}` : ' · nunca usado'}
                    </span>
                  </span>
                  {t.ativo && (
                    <button type="button" className="perigo" onClick={() => desativar(t.id)}>
                      Desativar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { centavosTexto, hojeISO, lerDigitado, mesCurto, reais } from '../lib/formato'
import { Cartao } from '../lib/graficos'
import type { DadosReserva } from '../lib/investimentos'
import { EditorProjeto } from './Projetos'

/**
 * Reserva de emergência, na aba Investimentos ao lado da aposentadoria: quanto tem,
 * o objetivo e até quando, e o aporte mensal para chegar lá. No banco ela tem alvo e
 * prazo como um projeto (projetos_situacao estima o saldo pelo CDI), mas não aparece
 * em Projetos. Aplicar e resgatar gravam um "Guardar" no bolso da reserva, que
 * aparece na lista do mês em Lançamentos.
 */

const pct = (v: number, casas = 0) => `${(v * 100).toFixed(casas).replace('.', ',')}%`

export function Reserva({
  dados,
  podeEditar,
  onMudou,
}: {
  dados: DadosReserva
  podeEditar: boolean
  onMudou: (aviso: string) => void
}) {
  const [folha, setFolha] = useState<'aporte' | 'resgate' | 'editar' | 'definir' | null>(null)
  if (dados.bolsoId === null) return null
  const r = dados.reserva

  function salvo(m: string) {
    setFolha(null)
    onMudou(m)
  }

  return (
    <Cartao
      titulo="Reserva de emergência"
      extra={r && r.valor_alvo > 0 ? `${pct(Math.min(r.saldo / r.valor_alvo, 9.99))} do objetivo` : undefined}
      classe="cartao-objetivo"
    >
      {r ? (
        <button type="button" className="objetivo-corpo" disabled={!podeEditar} onClick={() => setFolha('editar')}>
          <span className="objetivo-topo">
            <strong>{reais(r.saldo)}</strong>
            <small>
              de {reais(r.valor_alvo)} até {mesCurto(r.fim)}
            </small>
          </span>
          <span className="barra" aria-hidden="true">
            <span style={{ width: `${Math.min(r.valor_alvo ? r.saldo / r.valor_alvo : 0, 1) * 100}%` }} />
          </span>
          <span className="numeros-projeto">
            <span>
              <small>Falta</small>
              {reais(r.falta)}
            </span>
            <span>
              <small>Rende</small>
              {pct(r.pct_cdi)} do CDI
            </span>
            <span>
              <small>Faltam</small>
              {r.meses_restantes} {r.meses_restantes === 1 ? 'mês' : 'meses'}
            </span>
          </span>
          <span className="aportes-objetivo">
            <span>
              <small>Aporte para chegar lá</small>
              {r.aporte_necessario > 0 ? (
                <span>
                  <strong>{reais(r.aporte_necessario)}</strong>/mês
                </span>
              ) : (
                <strong>objetivo atingido</strong>
              )}
            </span>
          </span>
          <small className="sub">Saldo estimado pelo CDI · toque para corrigir com o do banco</small>
        </button>
      ) : (
        <div className="sem-objetivo">
          <p className="origem">
            Sem objetivo definido: diga quanto quer ter, até quando e quanto a reserva tem hoje, e o app passa a estimar o
            saldo pelo CDI e o aporte mensal.
          </p>
          {podeEditar && (
            <button type="button" className="secundario" onClick={() => setFolha('definir')}>
              Definir objetivo
            </button>
          )}
        </div>
      )}
      {podeEditar && (
        <div className="acoes-reserva">
          <button type="button" className="principal" onClick={() => setFolha('aporte')}>
            Aplicar
          </button>
          <button type="button" className="secundario" onClick={() => setFolha('resgate')}>
            Resgatar
          </button>
        </div>
      )}

      {folha === 'editar' && r && <EditorProjeto projeto={r} reserva onFechar={() => setFolha(null)} onSalvo={salvo} />}
      {folha === 'definir' && !r && (
        <EditorProjeto
          projeto={null}
          reserva
          bolsoReserva={dados.bolsoId}
          onFechar={() => setFolha(null)}
          onSalvo={() => salvo('Objetivo da reserva definido.')}
        />
      )}
      {(folha === 'aporte' || folha === 'resgate') && (
        <FolhaMovimento tipo={folha} bolsoId={dados.bolsoId} onFechar={() => setFolha(null)} onSalvo={salvo} />
      )}
    </Cartao>
  )
}

/** Aplicar na reserva ou resgatar dela: valor e data, gravados como um "Guardar". */
function FolhaMovimento({
  tipo,
  bolsoId,
  onFechar,
  onSalvo,
}: {
  tipo: 'aporte' | 'resgate'
  bolsoId: number
  onFechar: () => void
  onSalvo: (mensagem: string) => void
}) {
  const [centavos, setCentavos] = useState<number | null>(null)
  const [data, setData] = useState(hojeISO)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const titulo = tipo === 'aporte' ? 'Aplicar na reserva' : 'Resgatar da reserva'

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!centavos) return
    setSalvando(true)
    setErro(null)
    const { error } = await supabase.rpc('guardar', {
      p_valor: centavos / 100,
      p_bolso_id: bolsoId,
      p_tipo: tipo,
      p_data: data,
    })
    setSalvando(false)
    if (error) setErro('Não foi possível salvar. Nada foi gravado.')
    else onSalvo(tipo === 'aporte' ? 'Aplicação na reserva salva.' : 'Resgate da reserva salvo.')
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={titulo}>
      <form className="folha folha-estreita" onSubmit={salvar}>
        <header>
          <h2>{titulo}</h2>
          <label htmlFor="reserva-data" className="rotulo-data">
            Data:
          </label>
          <input
            id="reserva-data"
            className="data-cabecalho"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            aria-label="Data"
          />
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        <div className="campo-valor">
          <span>R$</span>
          <input
            id="reserva-valor"
            inputMode="numeric"
            placeholder="0,00"
            autoFocus
            value={centavos ? centavosTexto(centavos) : ''}
            onChange={(e) => {
              const lido = lerDigitado(e.target.value)
              if (lido) setCentavos(lido.centavos)
            }}
            aria-label="Valor"
          />
          {centavos !== null && centavos > 0 && centavos < 1e9 && (
            <button
              type="button"
              className="zeros"
              aria-label="Acrescentar ,00"
              onClick={() => {
                setCentavos((c) => (c === null ? c : c * 100))
                document.getElementById('reserva-valor')?.focus()
              }}
            >
              ,00
            </button>
          )}
        </div>
        <p className="origem">Entra em Lançamentos, na lista "Guardado e resgatado no mês".</p>
        {erro && <p className="erro">{erro}</p>}
        <button type="submit" className="principal" disabled={!centavos || salvando}>
          {salvando ? 'Salvando…' : tipo === 'aporte' ? 'Aplicar' : 'Resgatar'}
        </button>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { mesCurto, paraNumero, reais } from '../lib/formato'
import { Cartao } from '../lib/graficos'
import type { BolsoInvest, DadosRentabilidade, Objetivo } from '../lib/investimentos'

/**
 * Aposentadoria (objetivo: alvo, quanto já tem, aporte mensal pela premissa e pela
 * rentabilidade realizada) e a rentabilidade de cada bolso desde o primeiro aporte
 * (taxa interna de retorno, nominal e real). Conta no banco: objetivo_situacao,
 * rentabilidade_investimentos. Os dados vêm de useRentabilidade (lib/investimentos).
 */

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1).replace('.', ',')}%`)

/** Cartão de cada objetivo (hoje, a aposentadoria), ao lado da reserva de emergência. */
export function Aposentadoria({
  dados,
  podeEditar,
  onSalvo,
}: {
  dados: DadosRentabilidade
  podeEditar: boolean
  onSalvo: () => void
}) {
  const [editando, setEditando] = useState<Objetivo | null>(null)
  return (
    <>
      {dados.objetivos.map((o) => (
        <Cartao key={o.objetivo_id} titulo={o.nome} extra={`${pct(o.progresso)} do alvo`} classe="cartao-objetivo">
          <button type="button" className="objetivo-corpo" disabled={!podeEditar} onClick={() => setEditando(o)}>
            <span className="objetivo-topo">
              <strong>{reais(o.valor_atual)}</strong>
              <small>
                de {reais(o.alvo)} até {mesCurto(o.data_alvo)}
              </small>
            </span>
            <span className="barra" aria-hidden="true">
              <span style={{ width: `${Math.min(o.progresso * 100, 100)}%` }} />
            </span>
            <span className="numeros-projeto">
              <span>
                <small>Renda alvo</small>
                {reais(o.renda_mensal_alvo)}/mês
              </span>
              <span>
                <small>Retirada</small>
                {pct(o.taxa_retirada_anual)} a.a.
              </span>
              <span>
                <small>Faltam</small>
                {Math.floor(o.meses / 12)} anos
              </span>
            </span>
            <span className="aportes-objetivo">
              <span>
                <small>Aporte pela premissa ({pct(o.taxa_real_anual)} real a.a.)</small>
                <span>
                  <strong>{reais(o.aporte_premissa)}</strong>/mês
                </span>
              </span>
              {o.aporte_realizada !== null && (
                <span>
                  <small>Pelo realizado ({pct(o.taxa_real_realizada)} real a.a.)</small>
                  <span>
                    <strong>{reais(o.aporte_realizada)}</strong>/mês
                  </span>
                </span>
              )}
            </span>
            <small className="sub">Em reais de hoje · conta {o.bolsos}</small>
          </button>
        </Cartao>
      ))}
      {editando && (
        <EditorObjetivo
          objetivo={editando}
          bolsos={dados.bolsos}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            onSalvo()
          }}
        />
      )}
    </>
  )
}

/** Rentabilidade desde o início, por carteira e no total, em tabela. */
export function TabelaRentabilidade({ dados }: { dados: DadosRentabilidade }) {
  return (
    <Cartao titulo="Rentabilidade desde o início" extra="ao ano" classe="painel-largo">
      <div className="tabela-rolavel">
        <table className="tabela-simples">
          <thead>
            <tr>
              <th scope="col">Carteira</th>
              <th scope="col">Desde</th>
              <th scope="col">Nominal</th>
              <th scope="col">Real</th>
              <th scope="col">Ganho</th>
              <th scope="col">Proventos</th>
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map(({ nome, bolso, r }) => (
              <tr key={nome} className={bolso ? undefined : 'total'}>
                <th scope="row">{nome}</th>
                <td>{r?.inicio ? mesCurto(r.inicio) : '–'}</td>
                <td>{pct(r?.taxa_nominal)}</td>
                <td className={r?.taxa_real !== null && r?.taxa_real !== undefined ? (r.taxa_real >= 0 ? 'bom' : 'ruim') : undefined}>
                  {pct(r?.taxa_real)}
                </td>
                <td>{r?.ganho !== null && r?.ganho !== undefined ? reais(r.ganho) : '–'}</td>
                <td>{r?.proventos ? reais(r.proventos) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="origem">
        Taxa interna de retorno: cada compra conta como dinheiro posto, cada venda e provento como dinheiro tirado, e o
        valor de hoje fecha a conta. Real = descontado o IPCA. Histórico do MyProfit até a posição de partida.
      </p>
    </Cartao>
  )
}

function EditorObjetivo({
  objetivo,
  bolsos,
  onFechar,
  onSalvo,
}: {
  objetivo: Objetivo
  bolsos: BolsoInvest[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const fmt = (v: number) => String(Math.round(v * 1000) / 10).replace('.', ',')
  const [renda, setRenda] = useState(objetivo.renda_mensal_alvo.toFixed(2).replace('.', ','))
  const [retirada, setRetirada] = useState(fmt(objetivo.taxa_retirada_anual))
  const [real, setReal] = useState(fmt(objetivo.taxa_real_anual))
  const [data, setData] = useState(objetivo.data_alvo.slice(0, 7))
  const [escolhidos, setEscolhidos] = useState<number[]>(
    bolsos.filter((b) => (objetivo.bolsos ?? '').split(', ').includes(b.nome)).map((b) => b.id),
  )
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setErro(null)
    const r = paraNumero(renda)
    const ret = paraNumero(retirada)
    const tr = paraNumero(real)
    if (r === null || r <= 0 || ret === null || ret <= 0 || tr === null || !data) return setErro('Preencha todos os campos.')
    if (escolhidos.length === 0) return setErro('Escolha ao menos um bolso.')
    const { error } = await supabase
      .from('objetivo')
      .update({
        renda_mensal_alvo: r,
        taxa_retirada_anual: ret / 100,
        taxa_real_anual: tr / 100,
        data_alvo: `${data}-01`,
      })
      .eq('id', objetivo.objetivo_id)
    if (error) return setErro('Não foi possível salvar.')
    const { error: e2 } = await supabase.rpc('definir_bolsos_objetivo', {
      p_objetivo_id: objetivo.objetivo_id,
      p_bolsos: escolhidos,
    })
    if (e2) return setErro('Não foi possível salvar os bolsos.')
    onSalvo()
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={`Editar ${objetivo.nome}`}>
      <div className="folha">
        <header>
          <h2>{objetivo.nome}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        <p className="origem">Tudo em reais de hoje. O alvo é a renda mensal × 12 ÷ a taxa de retirada.</p>
        <div className="linha-dupla">
          <label>
            Renda mensal alvo (R$)
            <input inputMode="decimal" value={renda} onChange={(e) => setRenda(e.target.value)} />
          </label>
          <label>
            Retirada (% ao ano)
            <input inputMode="decimal" value={retirada} onChange={(e) => setRetirada(e.target.value)} />
          </label>
        </div>
        <div className="linha-dupla">
          <label>
            Rentabilidade real (% a.a.)
            <input inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} />
          </label>
          <label>
            Data alvo
            <input type="month" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        <p className="rotulo">Bolsos que contam</p>
        {bolsos.map((b) => (
          <label key={b.id} className="marcar">
            <input
              type="checkbox"
              checked={escolhidos.includes(b.id)}
              onChange={(e) =>
                setEscolhidos((l) => (e.target.checked ? [...l, b.id] : l.filter((x) => x !== b.id)))
              }
            />
            {b.nome}
          </label>
        ))}
        {erro && <p className="erro">{erro}</p>}
        <button type="button" className="principal" onClick={salvar}>
          Salvar
        </button>
      </div>
    </div>
  )
}

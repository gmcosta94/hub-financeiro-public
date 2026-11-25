import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { competenciaAtual, mesCurto, paraNumero, reais } from '../lib/formato'
import { atualizarCdi } from '../lib/indices'
import { Cartao, Linhas } from '../lib/graficos'

/**
 * Projetos: alvo, já separado (saldo estimado pelo CDI), já gasto, quanto falta e
 * o aporte mensal necessário até a data final. A conta toda está no banco
 * (projetos_situacao, projecao_projetos). Aportes e resgates são o "Guardar" da
 * tela de lançamento; gastos do projeto, um lançamento em Projetos Realizados.
 */

export type Projeto = {
  projeto_id: number
  nome: string
  status: 'ativo' | 'realizado' | 'cancelado'
  bolso_id: number
  conta_na_poupanca: boolean
  valor_alvo: number
  inicio: string
  fim: string
  pct_cdi: number
  saldo: number
  rendimento: number
  gasto: number
  gasto_com_projeto: number
  falta: number
  taxa_mensal: number
  meses_restantes: number
  aporte_necessario: number
  horizonte: 'curto' | 'medio' | 'longo'
}
// Bolso para onde pode ir o saldo de um projeto que acabou (outro projeto ativo ou a reserva).
type Destino = { projeto_id: number; bolso_id: number; nome: string }
type Projecao = { projeto_id: number; competencia: string; aporte: number; horizonte: 'curto' | 'medio' | 'longo' }

const HORIZONTE = { curto: 'curto prazo', medio: 'médio prazo', longo: 'longo prazo' }
const pct = (v: number) => `${(v * 100).toFixed(2).replace('.', ',')}%`

export function Projetos({ podeEditar }: { podeEditar: boolean }) {
  const [versao, setVersao] = useState(0)
  const [dados, setDados] = useState<{ projetos: Projeto[]; projecao: Projecao[]; destinos: Destino[] } | null>(null)
  const [aberto, setAberto] = useState<Projeto | 'novo' | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // A série do CDI se atualiza sozinha quando falta algum mês fechado.
  useEffect(() => {
    if (!podeEditar) return
    let cancelado = false
    atualizarCdi().then((n) => {
      if (!cancelado && n > 0) setVersao((v) => v + 1)
    })
    return () => {
      cancelado = true
    }
  }, [podeEditar])

  useEffect(() => {
    let cancelado = false
    Promise.all([
      supabase.rpc('projetos_situacao'),
      supabase.rpc('projecao_projetos', { p_de: competenciaAtual(), p_meses: 12 }),
      supabase.from('bolso').select('projeto_id').eq('tipo', 'reserva'),
    ]).then(([s, p, r]) => {
      if (cancelado) return
      // A reserva de emergência tem alvo e prazo como um projeto, mas mora na aba
      // Investimentos: fica fora desta tela e das somas dela.
      const reserva = new Set(((r.data ?? []) as { projeto_id: number | null }[]).map((b) => b.projeto_id))
      const todos = (s.data ?? []) as Projeto[]
      setDados({
        destinos: todos.filter((x) => x.status === 'ativo'),
        projetos: ((s.data ?? []) as Projeto[]).filter((x) => !reserva.has(x.projeto_id)),
        projecao: ((p.data ?? []) as Projecao[]).filter((x) => !reserva.has(x.projeto_id)),
      })
    })
    return () => {
      cancelado = true
    }
  }, [versao])

  const ativos = (dados?.projetos ?? []).filter((p) => p.status === 'ativo')
  const encerrados = (dados?.projetos ?? []).filter((p) => p.status !== 'ativo')
  const meses = useMemo(() => [...new Set((dados?.projecao ?? []).map((x) => x.competencia))].sort(), [dados])
  const somaMes = (filtro: (x: Projecao) => boolean) =>
    meses.map((m) => (dados?.projecao ?? []).filter((x) => x.competencia === m && filtro(x)).reduce((t, x) => t + x.aporte, 0))
  const totalPorMes = somaMes(() => true)
  const aporteDoMes = totalPorMes[0] ?? 0
  const alvoTotal = ativos.reduce((t, p) => t + p.valor_alvo, 0)
  const separado = ativos.reduce((t, p) => t + p.saldo, 0)
  const gasto = ativos.reduce((t, p) => t + p.gasto, 0)
  const falta = ativos.reduce((t, p) => t + p.falta, 0)
  const taxa = ativos[0]?.taxa_mensal

  function avisar(m: string) {
    setAviso(m)
    setTimeout(() => setAviso(null), 2500)
  }

  return (
    <main className="projetos">
      {/* 1. Quanto está separado e quanto falta, no total. */}
      <section className="heroi">
        <span>Separado para projetos</span>
        <strong>{reais(separado)}</strong>
        <small>
          de {reais(alvoTotal)} em {ativos.length} {ativos.length === 1 ? 'projeto' : 'projetos'} ativos
          {taxa !== undefined ? ` · rendendo ${pct(taxa)} ao mês (CDI)` : ''}
        </small>
        <BarraProjeto alvo={alvoTotal} separado={separado} gasto={gasto} grande />
        <div className="numeros-heroi">
          <span>
            <small>Aporte em {mesCurto(competenciaAtual())}</small>
            <strong>{reais(aporteDoMes)}</strong>
          </span>
          <span>
            <small>Já gasto</small>
            <strong>{reais(gasto)}</strong>
          </span>
          <span>
            <small>Falta</small>
            <strong>{reais(falta)}</strong>
          </span>
        </div>
      </section>

      {!dados && <p className="vazio">Carregando…</p>}

      {/* 2. Cada projeto. */}
      <ul className="cartoes-projeto">
        {ativos.map((p) => {
          const comeca = p.inicio > competenciaAtual()
          const feito = p.valor_alvo ? (p.saldo + p.gasto) / p.valor_alvo : 0
          return (
            <li key={p.projeto_id}>
              <button type="button" className="cartao-projeto" disabled={!podeEditar} onClick={() => setAberto(p)}>
                <span className="topo">
                  <strong>{p.nome}</strong>
                  <small className={`parcela horizonte-${p.horizonte}`}>{HORIZONTE[p.horizonte]}</small>
                </span>
                <span className="objetivo-topo">
                  <strong>{reais(p.saldo + p.gasto)}</strong>
                  <small>
                    de {reais(p.valor_alvo)} · {Math.round(Math.min(feito, 9.99) * 100)}%
                  </small>
                </span>
                <BarraProjeto alvo={p.valor_alvo} separado={p.saldo} gasto={p.gasto} />
                <span className="numeros-projeto">
                  <span>
                    <small>Separado</small>
                    {reais(p.saldo)}
                  </span>
                  <span>
                    <small>Já gasto</small>
                    {reais(p.gasto)}
                  </span>
                  <span>
                    <small>Falta</small>
                    {reais(p.falta)}
                  </span>
                  <span>
                    <small>Até</small>
                    {mesCurto(p.fim)}
                  </span>
                </span>
                <span className="aporte-projeto">
                  {p.aporte_necessario > 0 ? (
                    <>
                      <strong>{reais(p.aporte_necessario)}</strong> por mês
                      {comeca ? ` a partir de ${mesCurto(p.inicio)}` : ''}, {p.meses_restantes}{' '}
                      {p.meses_restantes === 1 ? 'mês' : 'meses'}
                    </>
                  ) : (
                    <>Alvo coberto</>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {podeEditar && (
        <button type="button" className="discreto" onClick={() => setAberto('novo')}>
          + Novo projeto
        </button>
      )}

      {/* 3. Aportes previstos e linha do tempo. */}
      <div className="grade-projetos">
        {meses.length > 0 && (
          <Cartao titulo="Aportes nos próximos 12 meses" extra={`${reais(totalPorMes.reduce((t, v) => t + v, 0))} no total`}>
            <Linhas
              rotulos={meses.map((m) => mesCurto(m))}
              titulos={meses.map((m) => mesCurto(m))}
              series={[
                { nome: 'Total', valores: totalPorMes, serie: 1 },
                { nome: 'Curto prazo', valores: somaMes((x) => x.horizonte === 'curto'), serie: 2 },
                { nome: 'Médio prazo', valores: somaMes((x) => x.horizonte === 'medio'), serie: 3 },
                { nome: 'Longo prazo', valores: somaMes((x) => x.horizonte === 'longo'), serie: 4 },
              ]}
              formato={reais}
            />
            <p className="origem">Quanto guardar em cada mês para chegar aos alvos no prazo, com o rendimento do CDI.</p>
          </Cartao>
        )}
        {ativos.length > 0 && <LinhaDoTempo projetos={ativos} />}
      </div>

      {/* 4. Encerrados. */}
      {encerrados.length > 0 && (
        <Cartao titulo="Realizados e cancelados">
          <ul className="lista-painel">
            {encerrados.map((p) => (
              <li key={p.projeto_id}>
                <button type="button" className="linha-grupo" disabled={!podeEditar} onClick={() => setAberto(p)}>
                  <span>{p.nome}</span>
                  <span>
                    {reais(p.gasto)} <small>{p.status === 'realizado' ? 'realizado' : 'cancelado'}</small>
                    {p.saldo >= 1 && <small className="saldo-esquecido">{reais(p.saldo)} ainda no bolso</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <p className="origem">
        Aportes e resgates: "Guardar" no lançamento. Gasto do projeto: lançamento em Projetos Realizados, escolhendo o
        projeto; marque "pago com o dinheiro do projeto" quando sair do cofrinho (não entra no mês).
      </p>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      {aberto && (
        <EditorProjeto
          projeto={aberto === 'novo' ? null : aberto}
          destinos={(dados?.destinos ?? []).filter((d) => aberto === 'novo' || d.projeto_id !== aberto.projeto_id)}
          onFechar={() => setAberto(null)}
          onSalvo={(m) => {
            setAberto(null)
            setVersao((v) => v + 1)
            avisar(m)
          }}
        />
      )}
    </main>
  )
}

/** Barra de um projeto: já gasto (escuro), separado (cor da área) e o que falta (trilho). */
function BarraProjeto({ alvo, separado, gasto, grande }: { alvo: number; separado: number; gasto: number; grande?: boolean }) {
  const p = (v: number) => `${alvo > 0 ? Math.min(Math.max(v / alvo, 0), 1) * 100 : 0}%`
  return (
    <span className={grande ? 'barra-projeto grande' : 'barra-projeto'} aria-hidden="true">
      <span className="gasto" style={{ width: p(gasto) }} />
      <span className="separado" style={{ width: p(separado) }} />
    </span>
  )
}

/** Linha do tempo: cada projeto do início ao fim, com o "hoje" marcado. */
function LinhaDoTempo({ projetos }: { projetos: Projeto[] }) {
  const hoje = competenciaAtual()
  const ordenados = [...projetos].sort((a, b) => a.fim.localeCompare(b.fim))
  const meses = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1
  const ini = Math.min(meses(hoje), ...ordenados.map((p) => meses(p.inicio)))
  const fim = Math.max(...ordenados.map((p) => meses(p.fim)))
  const fracao = (d: string) => (meses(d) - ini) / Math.max(fim - ini, 1)
  const pos = (d: string) => `${fracao(d) * 100}%`
  const anoIni = Math.floor(ini / 12)
  const anoFim = Math.floor(fim / 12)
  const passo = Math.max(1, Math.ceil((anoFim - anoIni) / 6))
  const anos: number[] = []
  // Os anos do eixo, menos os que encostariam no "hoje".
  for (let a = anoIni + 1; a <= anoFim; a += passo)
    if (Math.abs(fracao(`${a}-01-01`) - fracao(hoje)) > 0.06) anos.push(a)
  return (
    <Cartao titulo="Linha do tempo">
      <div className="linha-do-tempo">
        {ordenados.map((p) => {
          const feito = p.valor_alvo ? Math.min((p.saldo + p.gasto) / p.valor_alvo, 1) : 0
          return (
            <div key={p.projeto_id} className="ldt-linha">
              <span className="ldt-nome">{p.nome}</span>
              <span className="ldt-trilho">
                <span
                  className={`ldt-barra horizonte-${p.horizonte}`}
                  style={{ left: pos(p.inicio), width: `calc(${pos(p.fim)} - ${pos(p.inicio)})` }}
                  title={`${p.nome}: ${mesCurto(p.inicio)} a ${mesCurto(p.fim)} · ${Math.round(feito * 100)}% do alvo`}
                >
                  <span className="ldt-feito" style={{ width: `${feito * 100}%` }} />
                </span>
                <span className="ldt-marca-hoje" style={{ left: pos(hoje) }} aria-hidden="true" />
              </span>
            </div>
          )
        })}
        <div className="ldt-linha ldt-eixo">
          <span className="ldt-nome" />
          <span className="ldt-trilho">
            {anos.map((a) => (
              <span key={a} className="ldt-ano" style={{ left: pos(`${a}-01-01`) }}>
                {a}
              </span>
            ))}
            <span className="ldt-hoje" style={{ left: pos(hoje) }}>
              hoje
            </span>
          </span>
        </div>
      </div>
      <p className="origem">Cada barra vai do início ao fim do projeto; a parte cheia é o quanto do alvo já foi juntado.</p>
    </Cartao>
  )
}

const mesInput = (d: string) => d.slice(0, 7) // 'AAAA-MM-DD' -> 'AAAA-MM'
const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const paraTexto = (v: number) => v.toFixed(2).replace('.', ',')

/**
 * Editor de projeto. Com `reserva`, só alvo, prazo, rendimento e saldo (sem nome,
 * situação nem apagar); sem projeto e com `bolsoReserva`, define o objetivo da reserva.
 */
export function EditorProjeto({
  projeto,
  reserva = false,
  bolsoReserva,
  destinos = [],
  onFechar,
  onSalvo,
}: {
  projeto: Projeto | null
  reserva?: boolean
  bolsoReserva?: number
  destinos?: Destino[]
  onFechar: () => void
  onSalvo: (mensagem: string) => void
}) {
  const [nome, setNome] = useState(projeto?.nome ?? (reserva ? 'Reserva de Emergência' : ''))
  const [alvo, setAlvo] = useState(projeto ? paraTexto(projeto.valor_alvo) : '')
  const [inicio, setInicio] = useState(projeto ? mesInput(projeto.inicio) : mesInput(competenciaAtual()))
  const [fim, setFim] = useState(projeto ? mesInput(projeto.fim) : '')
  const [pctCdi, setPctCdi] = useState(projeto ? String(Math.round(projeto.pct_cdi * 100)) : '100')
  const [status, setStatus] = useState(projeto?.status ?? 'ativo')
  const [saldoInicial, setSaldoInicial] = useState('')
  const [saldoReal, setSaldoReal] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)
  // Projeto que acaba com dinheiro no bolso: o que foi feito com ele. Ao encerrar agora,
  // a pergunta é obrigatória; num projeto já encerrado, o padrão é deixar como está.
  const [fimSaldo, setFimSaldo] = useState<'liquidar' | 'transferir' | 'manter' | null>(
    projeto && projeto.status !== 'ativo' ? 'manter' : null,
  )
  const [bolsoDestino, setBolsoDestino] = useState<number | null>(null)
  const [dataSaldo, setDataSaldo] = useState(hojeIso)
  const perguntaSaldo = !reserva && !!projeto && status !== 'ativo' && projeto.saldo >= 0.01

  async function salvar() {
    setErro(null)
    const valorAlvo = paraNumero(alvo)
    const percentual = Number(pctCdi.replace(',', '.')) / 100
    if (!nome.trim()) return setErro('Dê um nome ao projeto.')
    if (valorAlvo === null || valorAlvo <= 0) return setErro('Alvo inválido.')
    if (!inicio || !fim || fim <= inicio) return setErro('O mês final precisa vir depois do início.')
    if (!Number.isFinite(percentual) || percentual <= 0) return setErro('Percentual do CDI inválido.')
    if (perguntaSaldo && fimSaldo === null) return setErro('Diga o que foi feito com o saldo do projeto.')
    if (perguntaSaldo && fimSaldo === 'transferir' && bolsoDestino === null) return setErro('Escolha para qual projeto o saldo foi.')
    if (perguntaSaldo && fimSaldo !== 'manter' && (!dataSaldo || dataSaldo > hojeIso())) return setErro('Data inválida.')
    setSalvando(true)
    // Primeiro o saldo: se o banco recusar (data antes do saldo de partida, por exemplo),
    // nada muda.
    let movido: number | null = null
    if (projeto && perguntaSaldo && fimSaldo !== 'manter') {
      const r = await supabase.rpc('liquidar_projeto', {
        p_id: projeto.projeto_id,
        p_data: dataSaldo,
        p_bolso_destino: fimSaldo === 'transferir' ? bolsoDestino : null,
      })
      if (r.error) {
        setSalvando(false)
        return setErro(r.error.message.startsWith('A data') ? `${r.error.message}.` : 'Não foi possível mexer no saldo. Nada foi alterado.')
      }
      movido = r.data as number
    }
    const resposta = projeto
      ? await supabase.rpc('editar_projeto', {
          p_id: projeto.projeto_id,
          p_nome: nome,
          p_valor_alvo: valorAlvo,
          p_inicio: `${inicio}-01`,
          p_fim: `${fim}-01`,
          p_pct_cdi: percentual,
          p_status: status,
        })
      : await supabase.rpc('criar_projeto', {
          p_nome: nome,
          p_valor_alvo: valorAlvo,
          p_inicio: `${inicio}-01`,
          p_fim: `${fim}-01`,
          p_saldo_inicial: paraNumero(saldoInicial) ?? 0,
          p_pct_cdi: percentual,
          // Reserva: o objetivo se liga ao bolso que já existe, em vez de criar outro.
          ...(reserva && bolsoReserva ? { p_bolso_id: bolsoReserva } : {}),
        })
    setSalvando(false)
    const destino = destinos.find((d) => d.bolso_id === bolsoDestino)?.nome
    const doSaldo =
      movido === null ? '' : fimSaldo === 'liquidar' ? ` ${reais(movido)} liquidados.` : ` ${reais(movido)} passados para ${destino}.`
    if (resposta.error) setErro(`Não foi possível salvar o projeto.${doSaldo}`)
    else
      onSalvo(
        reserva
          ? 'Reserva atualizada.'
          : projeto
            ? `Projeto atualizado.${doSaldo}`
            : 'Projeto criado. Os aportes vão pelo "Guardar".',
      )
  }

  async function corrigirSaldo() {
    if (!projeto) return
    const v = paraNumero(saldoReal)
    if (v === null || v < 0) return setErro('Saldo inválido.')
    setSalvando(true)
    const { error } = await supabase.rpc('corrigir_saldo_projeto', { p_id: projeto.projeto_id, p_saldo: v })
    setSalvando(false)
    if (error) setErro('Não foi possível corrigir o saldo.')
    else onSalvo('Saldo corrigido: a estimativa parte deste valor a partir de hoje.')
  }

  async function apagar() {
    if (!projeto) return
    setSalvando(true)
    setErro(null)
    const { error } = await supabase.rpc('apagar_projeto', { p_id: projeto.projeto_id })
    setSalvando(false)
    if (error)
      setErro(
        error.message.includes('aportes ou resgates')
          ? 'Este projeto tem aportes ou resgates registrados. Apague-os antes (na lista do mês) ou marque como cancelado.'
          : 'Não foi possível apagar. Nada foi alterado.',
      )
    else onSalvo('Projeto apagado.')
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={projeto ? `Editar ${projeto.nome}` : 'Novo projeto'}>
      <div className="folha">
        <header>
          <h2>{projeto ? projeto.nome : reserva ? 'Objetivo da reserva' : 'Novo projeto'}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>

        {!reserva && (
          <label className="campo-rotulado">
            Nome
            <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
        )}
        <div className="linha-dupla">
          <label>
            {reserva ? 'Objetivo (R$)' : 'Alvo (R$)'}
            <input inputMode="decimal" value={alvo} onChange={(e) => setAlvo(e.target.value)} />
          </label>
          <label>
            Rende (% do CDI)
            <input inputMode="decimal" value={pctCdi} onChange={(e) => setPctCdi(e.target.value)} />
          </label>
        </div>
        <div className="linha-dupla">
          <label>
            Começa em
            <input type="month" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </label>
          <label>
            {reserva ? 'Atingir até' : 'Termina em'}
            <input type="month" value={fim} onChange={(e) => setFim(e.target.value)} />
          </label>
        </div>

        {reserva ? null : projeto ? (
          <label className="campo-rotulado">
            Situação
            <select className="campo" value={status} onChange={(e) => setStatus(e.target.value as Projeto['status'])}>
              <option value="ativo">Ativo</option>
              <option value="realizado">Realizado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
        ) : (
          <label className="campo-rotulado">
            {reserva ? 'Quanto a reserva tem hoje (R$)' : 'Já separado hoje (R$, opcional)'}
            <input className="campo" inputMode="decimal" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} />
          </label>
        )}

        {perguntaSaldo && projeto && (
          <fieldset className="fim-saldo">
            <legend>O que foi feito com os {reais(projeto.saldo)} do bolso?</legend>
            <div className="opcoes-saldo">
              {(
                [
                  ['liquidar', 'Liquidar', 'foi resgatado e já gasto'],
                  ['transferir', 'Passou para outro projeto', 'resgate deste e aporte no outro'],
                  ['manter', 'Continua guardado', 'segue no patrimônio'],
                ] as const
              ).map(([v, titulo, detalhe]) => (
                <button
                  key={v}
                  type="button"
                  className={fimSaldo === v ? 'ativo' : undefined}
                  aria-pressed={fimSaldo === v}
                  onClick={() => setFimSaldo(v)}
                >
                  <strong>{titulo}</strong>
                  <small>{detalhe}</small>
                </button>
              ))}
            </div>
            {fimSaldo === 'transferir' && (
              <label className="campo-rotulado">
                Para
                <select
                  className="campo"
                  value={bolsoDestino ?? ''}
                  onChange={(e) => setBolsoDestino(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Escolha o projeto</option>
                  {destinos.map((d) => (
                    <option key={d.bolso_id} value={d.bolso_id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(fimSaldo === 'liquidar' || fimSaldo === 'transferir') && (
              <>
                <label className="campo-rotulado">
                  Em
                  <input className="campo" type="date" max={hojeIso()} value={dataSaldo} onChange={(e) => setDataSaldo(e.target.value)} />
                </label>
                <p className="origem">
                  {fimSaldo === 'liquidar'
                    ? 'Vira um gasto em Projetos Realizados pago com o dinheiro do projeto: zera o bolso e não entra no resultado do mês.'
                    : 'O valor é o saldo estimado no dia escolhido.'}{' '}
                  Para desfazer, apague o registro na aba Lançamentos.
                </p>
              </>
            )}
          </fieldset>
        )}

        {erro && <p className="erro">{erro}</p>}
        <button type="button" className="principal" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>

        {projeto && projeto.status === 'ativo' && (
          <>
            <p className="rotulo">Corrigir o saldo com o valor do banco</p>
            <p className="origem">
              Estimado hoje: {reais(projeto.saldo)} (rendimento estimado {reais(projeto.rendimento)}). O valor informado
              vira o novo ponto de partida.
            </p>
            <div className="linha-dupla">
              <input
                className="campo"
                inputMode="decimal"
                placeholder="saldo real hoje"
                value={saldoReal}
                onChange={(e) => setSaldoReal(e.target.value)}
                aria-label="Saldo real hoje"
              />
              <button type="button" className="discreto" disabled={salvando || !saldoReal.trim()} onClick={corrigirSaldo}>
                Corrigir saldo
              </button>
            </div>
          </>
        )}

        {projeto &&
          !reserva &&
          (confirmandoApagar ? (
            <div className="confirmar-apagar">
              <p>
                Apagar {projeto.nome} não pode ser desfeito. Gastos ligados a ele continuam lançados, sem o projeto (os
                pagos com o dinheiro dele passam a contar no mês), e o que estava orçado para ele sai do orçamento.
                {projeto.conta_na_poupanca && ' A reserva continua: só somem o alvo e o prazo.'}
              </p>
              <button type="button" className="perigo" disabled={salvando} onClick={apagar}>
                Apagar projeto
              </button>
              <button type="button" className="discreto" onClick={() => setConfirmandoApagar(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="discreto" onClick={() => setConfirmandoApagar(true)}>
              Apagar projeto…
            </button>
          ))}
      </div>
    </div>
  )
}

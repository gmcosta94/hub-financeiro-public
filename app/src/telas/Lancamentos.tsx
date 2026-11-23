import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { competenciaAtual, nomeDoDia, nomeDoMes, reais, somarMeses } from '../lib/formato'
import { NovoLancamento, type LancamentoEditavel } from './NovoLancamento'
import { FiltroCategorias } from './FiltroCategorias'

// Linha da view v_lancamento.
type Lancamento = LancamentoEditavel & {
  conta: string
  categoria: string | null
}

// Linha da view v_transferencia.
type Transferencia = {
  id: number
  data: string
  valor: number
  tipo: string
  bolso: string | null
  descricao: string | null
}

const COLUNAS =
  'id,data,competencia,valor,status,descricao_original,origem_input,conta_id,conta,categoria_id,categoria,' +
  'natureza,item,observacao,compra_parcelada_id,parcela_numero,n_parcelas,recorrencia_id,projeto_id,pago_com_projeto'

const ROTULO_TRANSFERENCIA: Record<string, string> = {
  aporte: 'Aporte',
  resgate: 'Resgate',
  pagamento_fatura: 'Pagamento de fatura',
  amortizacao: 'Amortização',
  entre_contas: 'Entre contas',
}

type Resultado = {
  chave: string
  linhas: Lancamento[] | null
  transferencias: Transferencia[]
  pendentes: number
  erro: string | null
}

export function Lancamentos({ podeEditar }: { podeEditar: boolean }) {
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [soPendentes, setSoPendentes] = useState(false)
  const [folha, setFolha] = useState<{ editar?: Lancamento } | null>(null)
  const [versao, setVersao] = useState(0) // muda a cada gravação, para recarregar
  const [aviso, setAviso] = useState<string | null>(null)
  const [apagando, setApagando] = useState<number | null>(null) // transferência aguardando confirmação
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [conta, setConta] = useState('')
  const [categorias, setCategorias] = useState<Set<string>>(() => new Set())

  // A chave identifica o que está na tela; enquanto o resultado guardado for
  // de outra chave, a tela mostra "Carregando".
  const chave = `${soPendentes ? 'pendentes' : competencia}|${versao}`

  useEffect(() => {
    let cancelado = false
    const consulta = supabase.from('v_lancamento').select(COLUNAS)
    const lancamentos = (
      soPendentes ? consulta.eq('status', 'pendente') : consulta.eq('competencia', competencia)
    )
      .order('data', { ascending: false })
      .order('id', { ascending: false })

    Promise.all([
      lancamentos,
      soPendentes
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('v_transferencia')
            .select('id,data,valor,tipo,bolso,descricao')
            .eq('competencia', competencia)
            .order('data', { ascending: false }),
      supabase.from('lancamento').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
    ]).then(([l, t, p]) => {
      if (cancelado) return
      const falhou = l.error || t.error
      setResultado({
        chave: `${soPendentes ? 'pendentes' : competencia}|${versao}`,
        linhas: falhou ? null : (l.data as unknown as Lancamento[]),
        transferencias: falhou ? [] : (t.data as Transferencia[]),
        pendentes: p.count ?? 0,
        erro: falhou ? 'Não foi possível carregar os lançamentos.' : null,
      })
    })
    return () => {
      cancelado = true
    }
  }, [competencia, soPendentes, versao])

  // Recorrentes: ao abrir, cria os pendentes do mês que ainda não existem (só quem edita)
  // e recarrega a lista. Recarrega sempre, e não só quando a contagem vem > 0: uma
  // chamada repetida (o React em desenvolvimento roda o efeito duas vezes) devolve 0
  // depois que a primeira já criou.
  useEffect(() => {
    if (!podeEditar) return
    let cancelado = false
    supabase.rpc('gerar_recorrentes').then(() => {
      if (!cancelado) setVersao((v) => v + 1)
    })
    return () => {
      cancelado = true
    }
  }, [podeEditar])

  const atual = resultado?.chave === chave ? resultado : null
  const linhas = atual?.linhas ?? null
  const transferencias = atual?.transferencias ?? []
  const pendentes = resultado?.pendentes ?? 0 // mantém o último número enquanto recarrega
  const carregando = atual === null

  const contas = useMemo(() => [...new Set((linhas ?? []).map((l) => l.conta))].sort(), [linhas])
  // Quantos lançamentos do mês em cada categoria (o filtro mostra ao lado do nome).
  const contagem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of linhas ?? []) m.set(l.categoria ?? 'Sem categoria', (m.get(l.categoria ?? 'Sem categoria') ?? 0) + 1)
    return m
  }, [linhas])

  const visiveis = useMemo(
    () =>
      (linhas ?? []).filter(
        (l) =>
          (!conta || l.conta === conta) &&
          (categorias.size === 0 || categorias.has(l.categoria ?? 'Sem categoria')),
      ),
    [linhas, conta, categorias],
  )

  // Pendente ainda não vale, e gasto pago com o dinheiro de um projeto não passa pelo
  // mês: os dois ficam fora dos totais.
  const confirmados = visiveis.filter((l) => l.status === 'confirmado' && !l.pago_com_projeto)
  const despesas = confirmados.filter((l) => l.natureza !== 'receita').reduce((s, l) => s + l.valor, 0)
  const receitas = confirmados.filter((l) => l.natureza === 'receita').reduce((s, l) => s + l.valor, 0)

  // Agrupa por dia, mantendo a ordem (mais recente primeiro).
  const porDia = useMemo(() => {
    const grupos: { data: string; itens: Lancamento[] }[] = []
    for (const l of visiveis) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo.data === l.data) ultimo.itens.push(l)
      else grupos.push({ data: l.data, itens: [l] })
    }
    return grupos
  }, [visiveis])

  function avisar(mensagem: string) {
    setAviso(mensagem)
    setTimeout(() => setAviso(null), 2500)
  }

  async function confirmar(id: number) {
    const { error } = await supabase.rpc('confirmar_lancamento', { p_id: id })
    if (error) avisar('Abra o lançamento para revisar.')
    else {
      setVersao((v) => v + 1)
      avisar('Confirmado.')
    }
  }

  async function apagarTransferencia(id: number) {
    const { error } = await supabase.from('transferencia').delete().eq('id', id)
    setApagando(null)
    if (error) avisar('Não foi possível apagar.')
    else {
      setVersao((v) => v + 1)
      avisar('Transferência apagada.')
    }
  }

  return (
    <main className="lancamentos">
      <div className="lanc-controles">
        {soPendentes ? (
          <header className="mes">
            <button aria-label="Voltar ao mês" onClick={() => setSoPendentes(false)}>
              ‹
            </button>
            <h1>Para revisar</h1>
            <span className="espaco" />
          </header>
        ) : (
          <header className="mes">
            <button aria-label="Mês anterior" onClick={() => setCompetencia((c) => somarMeses(c, -1))}>
              ‹
            </button>
            <h1>{nomeDoMes(competencia)}</h1>
            <button aria-label="Mês seguinte" onClick={() => setCompetencia((c) => somarMeses(c, 1))}>
              ›
            </button>
          </header>
        )}

        {!soPendentes && pendentes > 0 && (
          <button className="faixa-pendentes" onClick={() => setSoPendentes(true)}>
            {pendentes === 1 ? '1 lançamento para revisar' : `${pendentes} lançamentos para revisar`}
            <span aria-hidden="true">›</span>
          </button>
        )}

        {!soPendentes && (
          <>
            <section className="resumo">
              <div>
                <span>Despesas</span>
                <strong>{reais(despesas)}</strong>
              </div>
              <div>
                <span>Receitas</span>
                <strong>{reais(receitas)}</strong>
              </div>
              <div>
                <span>Lançamentos</span>
                <strong>{visiveis.length}</strong>
              </div>
            </section>

            <section className="filtros">
              <select aria-label="Conta" value={conta} onChange={(e) => setConta(e.target.value)}>
                <option value="">Todas as contas</option>
                {contas.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <FiltroCategorias escolhidas={categorias} contagem={contagem} onMudar={setCategorias} />
            </section>
          </>
        )}
      </div>

      <div className="lanc-lista">
        {atual?.erro && <p className="erro">{atual.erro}</p>}
        {carregando && <p className="vazio">Carregando…</p>}
        {linhas !== null && visiveis.length === 0 && (
          <p className="vazio">{soPendentes ? 'Nada para revisar.' : 'Nenhum lançamento neste mês.'}</p>
        )}

        {porDia.map((dia) => (
          <section key={dia.data} className="dia">
            <h2>{nomeDoDia(dia.data)}</h2>
            <ul>
              {dia.itens.map((l) => (
                <li key={l.id} className={l.status === 'pendente' ? 'pendente' : undefined}>
                  <div className="linha-com-acao">
                    <button
                      type="button"
                      className="linha"
                      disabled={!podeEditar}
                      onClick={() => setFolha({ editar: l })}
                    >
                      <span className="texto">
                        {/* Como num extrato: o detalhe (o comerciante) no título, o item embaixo. */}
                        <span className="nome">
                          {l.observacao ?? l.item ?? l.descricao_original ?? 'Sem descrição'}
                          {l.parcela_numero && l.n_parcelas && (
                            <small className="parcela">
                              {l.parcela_numero}/{l.n_parcelas}
                            </small>
                          )}
                          {l.status === 'pendente' && <small className="parcela">revisar</small>}
                          {l.pago_com_projeto && <small className="parcela">pago pelo projeto</small>}
                        </span>
                        <span className="detalhe">
                          {(l.observacao && l.item) || l.categoria || 'Sem categoria'} · {l.conta}
                        </span>
                      </span>
                      <span
                        className={
                          'valor ' + (l.natureza === 'receita' ? 'receita' : l.valor < 0 ? 'estorno' : '')
                        }
                      >
                        {l.natureza === 'receita' ? '+' : ''}
                        {reais(l.valor)}
                      </span>
                    </button>
                    {/* Pendente que já está certo (recorrente, sugestão do atalho): confirma sem abrir. */}
                    {podeEditar && l.status === 'pendente' && l.categoria_id !== null && (
                      <button
                        type="button"
                        className="confirmar"
                        aria-label="Confirmar lançamento"
                        onClick={() => confirmar(l.id)}
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {transferencias.length > 0 && (
          <section className="dia">
            <h2>Guardado e resgatado no mês</h2>
            <ul>
              {transferencias.map((t) => (
                <li key={t.id}>
                  <div className="linha">
                    <span className="texto">
                      <span className="nome">{t.bolso ?? t.descricao ?? 'Sem destino'}</span>
                      <span className="detalhe">
                        {ROTULO_TRANSFERENCIA[t.tipo] ?? t.tipo} · {nomeDoDia(t.data)}
                      </span>
                    </span>
                    <span className="valor">
                      {t.tipo === 'resgate' ? '−' : ''}
                      {reais(t.valor)}
                    </span>
                    {podeEditar &&
                      (apagando === t.id ? (
                        <span className="acoes">
                          <button type="button" className="perigo" onClick={() => apagarTransferencia(t.id)}>
                            Apagar
                          </button>
                          <button type="button" className="discreto" onClick={() => setApagando(null)}>
                            Não
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="discreto"
                          aria-label="Apagar transferência"
                          onClick={() => setApagando(t.id)}
                        >
                          ×
                        </button>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      {podeEditar && (
        <button className="novo" aria-label="Novo lançamento" onClick={() => setFolha({})}>
          +
        </button>
      )}

      {folha && (
        <NovoLancamento
          editar={folha.editar}
          onFechar={() => setFolha(null)}
          onSalvo={(mensagem) => {
            setFolha(null)
            setVersao((v) => v + 1)
            avisar(mensagem)
          }}
        />
      )}
    </main>
  )
}

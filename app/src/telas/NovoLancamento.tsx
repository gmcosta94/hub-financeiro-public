import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { centavosTexto, hojeISO, lerDigitado, mesCurto, reais, somarMeses } from '../lib/formato'

type Tipo = 'gasto' | 'renda' | 'guardar'

type Categoria = {
  id: number
  nome: string
  grupo: string
  natureza: 'receita' | 'despesa'
  destino: string
  grupo_ordem: number
  ordem: number
  usos_recentes: number
}
type Conta = { id: number; nome: string; tipo: string }
type Bolso = { id: number; nome: string; tipo: string; projeto: { status: string; fim: string } | null }

// Ordem dos destinos ao guardar: reserva, carteiras e previdência, amortização e, por
// fim, os projetos (do que termina antes para o que termina depois). O grupo é o
// subtítulo da lista.
const GRUPO_BOLSO: Record<string, string> = {
  reserva: 'Reserva',
  carteira_principal: 'Investimentos',
  carteira_satelite: 'Investimentos',
  previdencia: 'Investimentos',
  amortizacao: 'Investimentos',
  projeto: 'Projetos',
}
const ORDEM_BOLSO: Record<string, number> = {
  reserva: 0,
  carteira_principal: 1,
  carteira_satelite: 2,
  previdencia: 3,
  amortizacao: 4,
  projeto: 5,
}
type ProjetoOpcao = { id: number; nome: string; status: string }
type Item = { id: number; nome: string }

/** Lançamento existente, quando a folha abre para editar ou revisar. */
export type LancamentoEditavel = {
  id: number
  data: string
  competencia: string
  valor: number
  status: 'pendente' | 'confirmado'
  descricao_original: string | null
  origem_input: string
  conta_id: number
  categoria_id: number | null
  natureza: 'receita' | 'despesa' | null
  item: string | null
  observacao: string | null
  compra_parcelada_id: number | null
  parcela_numero: number | null
  n_parcelas: number | null
  recorrencia_id: number | null
  projeto_id: number | null
  pago_com_projeto: boolean
}

const ROTULO: Record<Tipo, string> = { gasto: 'Gasto', renda: 'Renda', guardar: 'Guardar' }
// Fora do custo de vida, mas na linha das especiais (não é consumo do dia a dia).
const PRIMEIRA_LINHA = ['Caridade']
const PARCELAS = Array.from({ length: 24 }, (_, i) => i + 1)

/**
 * Folha de lançamento: cria (valor → categoria → item) ou edita um existente.
 * Toda a regra de gravação está no banco (lancar, lancar_parcelado, guardar,
 * editar_lancamento, apagar_*); esta tela só coleta o que foi digitado.
 */
export function NovoLancamento({
  editar,
  onFechar,
  onSalvo,
}: {
  editar?: LancamentoEditavel
  onFechar: () => void
  onSalvo: (mensagem: string) => void
}) {
  const chaveInicial = editar ? `${editar.conta_id}|${editar.data}` : null

  const [tipo, setTipo] = useState<Tipo>(editar?.natureza === 'receita' ? 'renda' : 'gasto')
  // Valor em centavos (inteiro) e o sinal, à parte: o campo mostra sempre "1.234,56".
  const [centavos, setCentavos] = useState<number | null>(editar ? Math.round(Math.abs(editar.valor) * 100) : null)
  const [negativo, setNegativo] = useState(editar ? editar.valor < 0 : false)
  const [categoriaId, setCategoriaId] = useState<number | null>(editar?.categoria_id ?? null)
  // Item = o tipo de gasto ("Refeições Fora"); observação = o detalhe ("Mamma Jamma").
  const [descricao, setDescricao] = useState(editar?.item ?? '')
  // Pendente do atalho ou da fatura: o texto de origem (o comerciante) já vem como
  // observação; confirmar com um item ensina a regra texto -> item.
  const [observacao, setObservacao] = useState(
    editar?.observacao ?? (editar?.status === 'pendente' ? (editar.descricao_original ?? '') : ''),
  )
  const [contaId, setContaId] = useState<number | null>(editar?.conta_id ?? null)
  // Gasto de projeto (Projetos Realizados): qual projeto e se saiu do dinheiro dele.
  const [projetoId, setProjetoId] = useState<number | null>(editar?.projeto_id ?? null)
  const [pagoComProjeto, setPagoComProjeto] = useState(editar?.pago_com_projeto ?? false)
  const [projetos, setProjetos] = useState<ProjetoOpcao[]>([])
  // Quanto do valor vai para (ou sai de) cada bolso, em centavos.
  const [partes, setPartes] = useState<Record<number, number>>({})
  const [sentido, setSentido] = useState<'aporte' | 'resgate'>('aporte')
  const [data, setData] = useState(editar?.data ?? hojeISO)
  const [parcelas, setParcelas] = useState(1)
  // Competência: o banco sugere (regra do fechamento do cartão) e a pessoa pode trocar.
  const [sugerida, setSugerida] = useState<{ chave: string; competencia: string } | null>(null)
  const [competenciaManual, setCompetenciaManual] = useState<{ chave: string; competencia: string } | null>(
    editar && chaveInicial ? { chave: chaveInicial, competencia: editar.competencia } : null,
  )

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [bolsos, setBolsos] = useState<Bolso[]>([])
  const [itens, setItens] = useState<{ categoriaId: number; lista: Item[] } | null>(null)
  const [observacoes, setObservacoes] = useState<{ itemId: number; lista: string[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)

  // Cadastros: carregados uma vez ao abrir.
  useEffect(() => {
    let cancelado = false
    Promise.all([
      supabase.from('v_categoria').select('id,nome,grupo,natureza,destino,grupo_ordem,ordem,usos_recentes'),
      supabase.from('conta').select('id,nome,tipo,ativa').order('id'),
      supabase.from('bolso').select('id,nome,tipo,projeto:projeto_id(status,fim)').order('id'),
      supabase.from('projeto').select('id,nome,status').order('fim'),
    ]).then(([cat, con, bol, pro]) => {
      if (cancelado) return
      if (cat.error || con.error || bol.error || pro.error) {
        setErro('Não foi possível carregar os cadastros.')
        return
      }
      setCategorias(cat.data as Categoria[])
      // Contas inativas só aparecem se o lançamento em edição já estiver nelas.
      setContas(
        (con.data as (Conta & { ativa: boolean })[]).filter((c) => c.ativa || c.id === editar?.conta_id),
      )
      // Projeto encerrado não recebe aporte.
      setBolsos(
        (bol.data as unknown as Bolso[])
          .filter((b) => !b.projeto || b.projeto.status === 'ativo')
          .sort(
            (a, b) =>
              (ORDEM_BOLSO[a.tipo] ?? 9) - (ORDEM_BOLSO[b.tipo] ?? 9) ||
              (a.projeto?.fim ?? '').localeCompare(b.projeto?.fim ?? '') ||
              a.id - b.id,
          ),
      )
      setProjetos(
        (pro.data as ProjetoOpcao[]).filter((p) => p.status === 'ativo' || p.id === editar?.projeto_id),
      )
    })
    return () => {
      cancelado = true
    }
  }, [editar?.conta_id, editar?.projeto_id])

  // Sugestões de item: as mais usadas da categoria escolhida.
  useEffect(() => {
    if (categoriaId === null) return
    let cancelado = false
    supabase
      .from('item')
      .select('id,nome')
      .eq('categoria_id', categoriaId)
      .eq('ativo', true)
      .order('usos', { ascending: false })
      .limit(12)
      .then(({ data: lista }) => {
        if (!cancelado) setItens({ categoriaId, lista: (lista ?? []) as Item[] })
      })
    return () => {
      cancelado = true
    }
  }, [categoriaId])

  // Observações mais usadas do item escolhido ("Mamma Jamma", "Outback" em Refeições Fora).
  const sugestoes = itens && itens.categoriaId === categoriaId ? itens.lista : []
  const ehMetas = categorias.find((c) => c.id === categoriaId)?.destino === 'metas'
  const itemEscolhidoId = sugestoes.find((i) => i.nome === descricao)?.id ?? null
  useEffect(() => {
    if (itemEscolhidoId === null) return
    let cancelado = false
    supabase
      .from('v_observacao')
      .select('observacao')
      .eq('item_id', itemEscolhidoId)
      .order('usos', { ascending: false })
      .order('ultima', { ascending: false })
      .limit(8)
      .then(({ data: lista }) => {
        if (!cancelado)
          setObservacoes({
            itemId: itemEscolhidoId,
            lista: ((lista ?? []) as { observacao: string }[]).map((o) => o.observacao),
          })
      })
    return () => {
      cancelado = true
    }
  }, [itemEscolhidoId])
  const observacoesSugeridas = observacoes && observacoes.itemId === itemEscolhidoId ? observacoes.lista : []

  const natureza = tipo === 'renda' ? 'receita' : 'despesa'
  const opcoesCategoria = useMemo(
    () =>
      categorias
        .filter((c) => c.natureza === natureza)
        // Ordem fixa, a mesma da planilha (categoria.ordem).
        .sort((a, b) => a.ordem - b.ordem),
    [categorias, natureza],
  )

  // Gastos em três linhas: as especiais (projetos, caridade, seguro), o custo de vida e o
  // resto do que fica fora dele. Renda numa linha só.
  const linhasCategoria = useMemo(() => {
    if (natureza !== 'despesa') return [opcoesCategoria]
    const custo = opcoesCategoria.filter((c) => c.grupo === 'Custo de Vida')
    const fora = opcoesCategoria.filter((c) => c.grupo === 'Fora do Custo de Vida' && !PRIMEIRA_LINHA.includes(c.nome))
    const especiais = opcoesCategoria.filter((c) => !custo.includes(c) && !fora.includes(c))
    return [especiais, custo, fora].filter((l) => l.length > 0)
  }, [opcoesCategoria, natureza])

  // Conta padrão: cartão para gasto, conta corrente para renda.
  const contaPadrao = useMemo(() => {
    const querCartao = tipo === 'gasto'
    return (contas.find((c) => (c.tipo === 'cartao') === querCartao) ?? contas[0])?.id ?? null
  }, [contas, tipo])
  const contaEscolhida = contaId ?? contaPadrao

  // A sugestão vale para um par conta + data; ao mudar um dos dois, pergunta de novo ao banco.
  const chaveCompetencia = `${contaEscolhida}|${data}`
  useEffect(() => {
    if (contaEscolhida === null || !data) return
    let cancelado = false
    const chave = `${contaEscolhida}|${data}`
    supabase.rpc('competencia_de', { p_conta_id: contaEscolhida, p_data: data }).then(({ data: comp }) => {
      if (!cancelado && typeof comp === 'string') setSugerida({ chave, competencia: comp })
    })
    return () => {
      cancelado = true
    }
  }, [contaEscolhida, data])

  const mesDaData = data ? data.slice(0, 7) + '-01' : null
  const competenciaSugerida = sugerida?.chave === chaveCompetencia ? sugerida.competencia : mesDaData
  const competencia =
    competenciaManual?.chave === chaveCompetencia ? competenciaManual.competencia : competenciaSugerida
  const opcoesCompetencia = useMemo(() => {
    if (!mesDaData) return []
    const base = [mesDaData, somarMeses(mesDaData, 1)]
    // Ao editar, a competência gravada sempre aparece, mesmo fora das duas opções padrão.
    return competencia && !base.includes(competencia) ? [competencia, ...base].sort() : base
  }, [mesDaData, competencia])

  const numero = centavos === null ? null : ((negativo ? -1 : 1) * centavos) / 100
  // O "-" fica à vista mesmo antes do primeiro dígito, senão some ao digitar o número.
  const valorMostrado = (negativo ? '-' : '') + (centavos === null ? '' : centavosTexto(centavos))
  // Estorno ou reembolso (valor negativo) é sempre à vista.
  const parcelado = !editar && tipo === 'gasto' && parcelas > 1 && !negativo
  const pronto =
    numero !== null &&
    numero !== 0 &&
    (tipo === 'guardar'
      ? !negativo && centavos === Object.values(partes).reduce((a, b) => a + b, 0)
      : categoriaId !== null && contaEscolhida !== null)

  function trocarTipo(novo: Tipo) {
    setTipo(novo)
    setCategoriaId(null)
    setContaId(null)
    setDescricao('')
    setParcelas(1)
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!pronto || numero === null) return
    setSalvando(true)
    setErro(null)

    const comum = {
      p_categoria_id: categoriaId,
      p_descricao: descricao,
      p_conta_id: contaEscolhida,
      p_data: data,
      // Texto vazio apaga a observação ao editar; o banco guarda null.
      p_observacao: observacao.trim(),
      p_projeto_id: ehMetas ? projetoId : null,
      p_pago_com_projeto: ehMetas && projetoId !== null ? pagoComProjeto : false,
    }
    let resposta
    let mensagem = 'Lançamento salvo.'
    if (editar) {
      resposta = await supabase.rpc('editar_lancamento', {
        p_id: editar.id,
        p_valor: numero,
        ...comum,
        p_competencia: competencia,
      })
      mensagem = editar.status === 'pendente' ? 'Lançamento confirmado.' : 'Lançamento atualizado.'
    } else if (tipo === 'guardar') {
      // Um aporte (ou resgate) por bolso, tudo numa transação só.
      const itens = Object.entries(partes)
        .filter(([, c]) => c > 0)
        .map(([id, c]) => ({ bolso_id: Number(id), valor: c / 100 }))
      resposta = await supabase.rpc('guardar_varios', { p_itens: itens, p_tipo: sentido, p_data: data })
      const n = itens.length
      mensagem =
        sentido === 'aporte'
          ? n === 1 ? 'Aporte salvo.' : `${n} aportes salvos.`
          : n === 1 ? 'Resgate salvo.' : `${n} resgates salvos.`
    } else if (parcelado) {
      resposta = await supabase.rpc('lancar_parcelado', {
        p_valor_total: numero,
        p_n_parcelas: parcelas,
        ...comum,
        p_primeira_competencia: competencia,
      })
      mensagem = `Compra em ${parcelas}x salva.`
    } else {
      resposta = await supabase.rpc('lancar', { p_valor: numero, ...comum, p_competencia: competencia })
    }

    setSalvando(false)
    if (resposta.error) setErro('Não foi possível salvar. Nada foi gravado.')
    else onSalvo(mensagem)
  }

  async function apagar(todasAsParcelas: boolean) {
    if (!editar) return
    setSalvando(true)
    setErro(null)
    const { error } =
      todasAsParcelas && editar.compra_parcelada_id
        ? await supabase.rpc('apagar_compra_parcelada', { p_id: editar.compra_parcelada_id })
        : await supabase.rpc('apagar_lancamento', { p_id: editar.id })
    setSalvando(false)
    if (error) setErro('Não foi possível apagar. Nada foi alterado.')
    else onSalvo(todasAsParcelas ? 'Compra parcelada apagada.' : 'Lançamento apagado.')
  }

  // Transforma este lançamento num modelo que se repete todo mês (criar_recorrencia).
  async function repetir() {
    if (!editar) return
    setSalvando(true)
    setErro(null)
    const { error } = await supabase.rpc('criar_recorrencia', { p_lancamento_id: editar.id })
    setSalvando(false)
    if (error)
      setErro(
        error.message.includes('Já existe')
          ? 'Já existe um recorrente igual a este (Cadastros › Recorrentes).'
          : 'Não foi possível criar o recorrente.',
      )
    else onSalvo('Pronto: vai aparecer para confirmar todo mês.')
  }
  const podeRepetir =
    editar && editar.status === 'confirmado' && !editar.compra_parcelada_id && !editar.recorrencia_id

  const titulo = !editar ? 'Novo lançamento' : editar.status === 'pendente' ? 'Revisar lançamento' : 'Editar lançamento'

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={titulo}>
      <form className="folha" onSubmit={salvar}>
        <header>
          <h2>{titulo}</h2>
          <label htmlFor="novo-data" className="rotulo-data">
            Data:
          </label>
          <input
            id="novo-data"
            className="data-cabecalho"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            aria-label={parcelado ? 'Data da compra' : 'Data'}
            title={parcelado ? 'Data da compra' : 'Data'}
          />
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>

        {!editar && (
          <div className="segmentos" role="tablist">
            {(Object.keys(ROTULO) as Tipo[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tipo === t}
                className={tipo === t ? 'ativo' : undefined}
                onClick={() => trocarTipo(t)}
              >
                {ROTULO[t]}
              </button>
            ))}
          </div>
        )}

        {editar && editar.origem_input !== 'manual' && editar.descricao_original && (
          <p className="origem">
            Texto de origem: <strong>{editar.descricao_original}</strong>
            {editar.parcela_numero && editar.n_parcelas
              ? ` · parcela ${editar.parcela_numero} de ${editar.n_parcelas}`
              : ''}
          </p>
        )}

        <div className={tipo === 'guardar' ? 'linha-valor' : 'linha-valor com-conta'}>
          <div className="campo-valor">
            <span>R$</span>
            <input
              id="novo-valor"
              inputMode="numeric"
              placeholder="0,00"
              autoFocus={!editar}
              value={valorMostrado}
              // Valor longo encolhe a fonte para caber ao lado da conta.
              className={valorMostrado.length >= 9 ? 'longo' : valorMostrado.length >= 7 ? 'medio' : undefined}
              onChange={(e) => {
                const lido = lerDigitado(e.target.value)
                if (!lido) return
                setCentavos(lido.centavos)
                setNegativo(lido.negativo)
              }}
              aria-label="Valor"
            />
            {/* Estorno ou reembolso: o teclado numérico do celular não tem o "-". */}
            {tipo !== 'guardar' && (
              <button
                type="button"
                className={negativo ? 'sinal ativo' : 'sinal'}
                aria-pressed={negativo}
                aria-label="Valor negativo (estorno ou reembolso)"
                title="Valor negativo: estorno ou reembolso"
                onClick={() => {
                  setNegativo((n) => !n)
                  document.getElementById('novo-valor')?.focus()
                }}
              >
                ±
              </button>
            )}
            {/* Valor redondo: "598" vira 598,00 sem digitar os zeros. */}
            {centavos !== null && centavos > 0 && centavos < 1e9 && (
              <button
                type="button"
                className="zeros"
                aria-label="Acrescentar ,00"
                title="Acrescentar ,00 (598 vira 598,00)"
                onClick={() => {
                  setCentavos((c) => (c === null ? c : c * 100))
                  document.getElementById('novo-valor')?.focus()
                }}
              >
                ,00
              </button>
            )}
          </div>
          {tipo !== 'guardar' && (
            <label className="conta-valor">
              Forma de pagamento
              <select
                id="novo-conta"
                className="campo"
                value={contaEscolhida ?? ''}
                onChange={(e) => setContaId(Number(e.target.value))}
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {negativo && tipo !== 'guardar' && (
          <p className="origem">
            {tipo === 'gasto'
              ? 'Valor negativo: estorno ou reembolso. Abate do gasto da categoria (e do item) na competência escolhida.'
              : 'Valor negativo: abate da renda da categoria na competência escolhida.'}
          </p>
        )}

        {tipo === 'guardar' ? (
          <>
            <div className="segmentos pequenos">
              <button
                type="button"
                className={sentido === 'aporte' ? 'ativo' : undefined}
                onClick={() => setSentido('aporte')}
              >
                Aporte
              </button>
              <button
                type="button"
                className={sentido === 'resgate' ? 'ativo' : undefined}
                onClick={() => setSentido('resgate')}
              >
                Resgate
              </button>
            </div>
            <p className="rotulo">{sentido === 'aporte' ? 'Para onde vai' : 'De onde sai'}</p>
            <Distribuicao
              bolsos={bolsos}
              total={centavos}
              partes={partes}
              onMudar={(id, c) => setPartes((p) => ({ ...p, [id]: c }))}
            />
          </>
        ) : (
          <>
            <p className="rotulo">Categoria</p>
            <div className="linhas-categorias">
              {linhasCategoria.map((linha, i) => (
                <div key={i} className="fichas categorias">
                  {linha.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={categoriaId === c.id ? 'ativo' : undefined}
                      onClick={() => {
                        // Ao criar, trocar de categoria limpa o item; ao revisar, a descrição fica.
                        if (!editar && c.id !== categoriaId) setDescricao('')
                        setCategoriaId(c.id)
                      }}
                    >
                      {c.nome}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {categoriaId !== null && (
              <>
                <p className="rotulo">{tipo === 'renda' ? 'Fonte' : 'Item'} (opcional)</p>
                {sugestoes.length > 0 && (
                  <div className="fichas suaves">
                    {sugestoes.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={descricao === i.nome ? 'ativo' : undefined}
                        onClick={() => setDescricao(i.nome)}
                      >
                        {i.nome}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  id="novo-descricao"
                  className="campo"
                  placeholder="ou crie um item novo"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  aria-label="Item"
                />

                <p className="rotulo">Observação (opcional)</p>
                {observacoesSugeridas.length > 0 && (
                  <div className="fichas suaves">
                    {observacoesSugeridas.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={observacao === o ? 'ativo' : undefined}
                        onClick={() => setObservacao(o)}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  id="novo-observacao"
                  className="campo"
                  placeholder="onde, o quê, para quem…"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  aria-label="Observação"
                />

                {ehMetas && (
                  <>
                    <label className="campo-rotulado">
                      Projeto
                      <select
                        className="campo"
                        value={projetoId ?? ''}
                        onChange={(e) => setProjetoId(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Nenhum</option>
                        {projetos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    {projetoId !== null && (
                      <label className="marcar">
                        <input
                          type="checkbox"
                          checked={pagoComProjeto}
                          onChange={(e) => setPagoComProjeto(e.target.checked)}
                        />
                        Pago com o dinheiro do projeto (baixa o saldo dele e não entra no mês)
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {tipo !== 'guardar' && (
          <div className="linha-dupla">
            <label>
              {parcelado ? '1ª fatura' : 'Competência'}
              <select
                id="novo-competencia"
                value={competencia ?? ''}
                onChange={(e) =>
                  setCompetenciaManual({ chave: chaveCompetencia, competencia: e.target.value })
                }
              >
                {opcoesCompetencia.map((c) => (
                  <option key={c} value={c}>
                    {mesCurto(c)}
                    {c === competenciaSugerida ? ' (sugerida)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!editar && tipo === 'gasto' && !negativo && (
              <label>
                Parcelas
                <select id="novo-parcelas" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
                  {PARCELAS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'À vista' : `${n}x`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {parcelado && numero !== null && competencia && (
          <p className="origem">
            {parcelas} parcelas de cerca de <strong>{reais(numero / parcelas)}</strong>, de{' '}
            {mesCurto(competencia)} a {mesCurto(somarMeses(competencia, parcelas - 1))}.
          </p>
        )}

        {erro && <p className="erro">{erro}</p>}

        <button type="submit" className="principal" disabled={!pronto || salvando}>
          {salvando ? 'Salvando…' : editar?.status === 'pendente' ? 'Confirmar' : 'Salvar'}
        </button>

        {editar?.recorrencia_id && (
          <p className="origem">Se repete todo mês. Valor, dia e conta do modelo ficam em Cadastros › Recorrentes.</p>
        )}
        {podeRepetir && (
          <button type="button" className="discreto" disabled={salvando} onClick={repetir}>
            Repetir todo mês
          </button>
        )}

        {editar &&
          (confirmandoApagar ? (
            <div className="confirmar-apagar">
              <p>Apagar não pode ser desfeito.</p>
              <button type="button" className="perigo" disabled={salvando} onClick={() => apagar(false)}>
                {editar.compra_parcelada_id ? 'Apagar só esta parcela' : 'Apagar lançamento'}
              </button>
              {editar.compra_parcelada_id && (
                <button type="button" className="perigo" disabled={salvando} onClick={() => apagar(true)}>
                  Apagar as {editar.n_parcelas} parcelas
                </button>
              )}
              <button type="button" className="discreto" onClick={() => setConfirmandoApagar(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="discreto" onClick={() => setConfirmandoApagar(true)}>
              Apagar…
            </button>
          ))}
      </form>
    </div>
  )
}

/**
 * Divide o valor entre os bolsos: um deslizador e um campo por bolso, e embaixo a
 * conferência com o total. O deslizador não deixa passar do que falta distribuir;
 * o campo aceita qualquer valor (e a conferência avisa se passou).
 */
function Distribuicao({
  bolsos,
  total,
  partes,
  onMudar,
}: {
  bolsos: Bolso[]
  total: number | null
  partes: Record<number, number>
  onMudar: (bolsoId: number, centavos: number) => void
}) {
  const soma = Object.values(partes).reduce((a, b) => a + b, 0)
  const resto = (total ?? 0) - soma
  // Passo do deslizador: R$ 10 até mil reais, R$ 50 até dez mil, R$ 100 acima.
  const passo = !total || total <= 100000 ? 1000 : total <= 1000000 ? 5000 : 10000
  const brl = (c: number) => reais(c / 100)

  let conferencia: { texto: string; classe: string }
  if (!total) conferencia = { texto: 'Digite o valor acima e divida entre os destinos.', classe: 'falta' }
  else if (resto > 0)
    conferencia = { texto: `Distribuído ${brl(soma)} de ${brl(total)} · falta ${brl(resto)}`, classe: 'falta' }
  else if (resto < 0) conferencia = { texto: `Passou ${brl(-resto)} do total de ${brl(total)}`, classe: 'passou' }
  else conferencia = { texto: `✓ ${brl(total)} distribuídos`, classe: 'confere' }

  return (
    <>
      <ul className="distribuicao">
        {bolsos.map((b, i) => {
          const v = partes[b.id] ?? 0
          const limite = v + Math.max(resto, 0)
          const grupo = GRUPO_BOLSO[b.tipo] ?? 'Outros'
          const novoGrupo = i === 0 || grupo !== (GRUPO_BOLSO[bolsos[i - 1].tipo] ?? 'Outros')
          return (
            <Fragment key={b.id}>
              {novoGrupo && (
                <li className="grupo-bolso" aria-hidden="true">
                  {grupo}
                </li>
              )}
              <li className={v > 0 ? 'com-valor' : undefined}>
                <span className="nome-bolso">{b.nome}</span>
                <input
                  type="range"
                  min={0}
                  max={total ?? 0}
                  step={passo}
                  value={v}
                  disabled={!total}
                  onChange={(e) => onMudar(b.id, Math.min(Number(e.target.value), limite))}
                  aria-label={`Quanto vai para ${b.nome}`}
                />
                {/* Põe aqui o que ainda não foi distribuído (todo o valor, se nada foi). */}
                <button
                  type="button"
                  className="resto"
                  disabled={!total || resto <= 0}
                  onClick={() => onMudar(b.id, v + resto)}
                  title={soma === 0 ? 'Tudo para este destino' : 'O que falta distribuir'}
                >
                  {soma === 0 ? 'tudo' : 'resto'}
                </button>
                <input
                  className="campo valor-parte"
                  inputMode="numeric"
                  placeholder="0,00"
                  value={v ? centavosTexto(v) : ''}
                  onChange={(e) => {
                    const lido = lerDigitado(e.target.value)
                    if (lido) onMudar(b.id, lido.centavos ?? 0)
                  }}
                  aria-label={`Valor para ${b.nome}`}
                />
              </li>
            </Fragment>
          )
        })}
      </ul>
      <p className={`conferencia ${conferencia.classe}`} role="status">
        {conferencia.texto}
      </p>
    </>
  )
}

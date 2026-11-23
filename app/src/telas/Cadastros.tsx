import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { paraNumero, reais } from '../lib/formato'

/**
 * Cadastros: editar o modelo sem abrir o banco.
 * Regra geral: o que tem histórico não é apagado, só inativado, renomeado,
 * movido ou mesclado. As operações que mexem em várias tabelas são funções
 * do banco (mover_item, mesclar_item).
 *
 * Modelo: categoria -> item (o tipo de gasto) -> observação (o detalhe de cada
 * lançamento, digitado ao lançar).
 */

type Aba = 'itens' | 'recorrentes' | 'categorias' | 'contas' | 'regras'
const ABAS: { id: Aba; nome: string }[] = [
  { id: 'itens', nome: 'Itens' },
  { id: 'recorrentes', nome: 'Recorrentes' },
  { id: 'categorias', nome: 'Categorias' },
  { id: 'contas', nome: 'Contas' },
  { id: 'regras', nome: 'Regras' },
]

type Categoria = {
  id: number
  pai_id: number | null
  nome: string
  natureza: string
  destino: string
  custo_de_vida: boolean
  ordem: number
  ativa: boolean
}
type ItemResumo = { id: number; categoria_id: number; nome: string; ativo: boolean }
type Item = {
  id: number
  nome: string
  categoria_id: number
  categoria: string
  natureza: string
  usos: number
  ativo: boolean
  lancamentos: number
}
type Conta = {
  id: number
  nome: string
  tipo: string
  dia_fechamento_padrao: number | null
  dia_vencimento: number | null
  apelido_carteira: string | null
  ativa: boolean
}
type Regra = { id: number; padrao: string; origem: string; item: string; categoria: string }
type Recorrencia = {
  id: number
  observacao: string | null
  item: string | null
  categoria: string
  conta_id: number
  conta: string
  valor_estimado: number
  dia_previsto: number | null
  periodicidade: 'mensal' | 'anual'
  inicio: string
  ativa: boolean
}
type SugestaoRecorrente = {
  ultimo_lancamento_id: number
  meses: number
  categoria: string
  item: string
  observacao: string | null
  ultimo_valor: number
  dia: number
  conta: string
}

const ERRO_PADRAO = 'Não foi possível salvar. Nada foi alterado.'

/** Texto que vira campo de edição ao tocar em "editar". */
function TextoEditavel({ valor, onSalvar }: { valor: string; onSalvar: (novo: string) => void }) {
  const [editando, setEditando] = useState<string | null>(null)
  if (editando === null) {
    return (
      <span className="editavel">
        <span>{valor}</span>
        <button type="button" className="discreto" onClick={() => setEditando(valor)}>
          editar
        </button>
      </span>
    )
  }
  return (
    <span className="editavel">
      <input className="campo" value={editando} onChange={(e) => setEditando(e.target.value)} autoFocus />
      <button
        type="button"
        className="discreto"
        onClick={() => {
          if (editando.trim() && editando.trim() !== valor) onSalvar(editando.trim())
          setEditando(null)
        }}
      >
        ok
      </button>
    </span>
  )
}

/** Campo + botão para criar algo pelo nome. */
function Adicionar({ rotulo, onCriar }: { rotulo: string; onCriar: (nome: string) => void }) {
  const [nome, setNome] = useState('')
  return (
    <span className="editavel">
      <input className="campo" placeholder={rotulo} value={nome} onChange={(e) => setNome(e.target.value)} />
      <button
        type="button"
        className="discreto"
        disabled={!nome.trim()}
        onClick={() => {
          onCriar(nome.trim())
          setNome('')
        }}
      >
        adicionar
      </button>
    </span>
  )
}

/** Carrega categorias e os itens de cada uma; recarrega quando `versao` muda. */
function useEstrutura(versao: number) {
  const [dados, setDados] = useState<{ categorias: Categoria[]; itens: ItemResumo[] }>({
    categorias: [],
    itens: [],
  })
  useEffect(() => {
    let cancelado = false
    Promise.all([
      supabase.from('categoria').select('id,pai_id,nome,natureza,destino,custo_de_vida,ordem,ativa').order('ordem'),
      supabase.from('item').select('id,categoria_id,nome,ativo').order('usos', { ascending: false }),
    ]).then(([c, i]) => {
      if (!cancelado)
        setDados({ categorias: (c.data ?? []) as Categoria[], itens: (i.data ?? []) as ItemResumo[] })
    })
    return () => {
      cancelado = true
    }
  }, [versao])
  return dados
}

// ---------------------------------------------------------------- Itens

function Itens({ avisar }: { avisar: (m: string) => void }) {
  const [busca, setBusca] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [versao, setVersao] = useState(0)
  const [itens, setItens] = useState<Item[]>([])
  const [aberto, setAberto] = useState<Item | null>(null)
  const { categorias } = useEstrutura(0)

  useEffect(() => {
    let cancelado = false
    let q = supabase
      .from('v_item')
      .select('id,nome,categoria_id,categoria,natureza,usos,ativo,lancamentos')
    if (busca.trim()) q = q.ilike('nome', `%${busca.trim()}%`)
    if (categoriaId) q = q.eq('categoria_id', Number(categoriaId))
    q.order('usos', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        if (!cancelado) setItens((data ?? []) as Item[])
      })
    return () => {
      cancelado = true
    }
  }, [busca, categoriaId, versao])

  return (
    <>
      <div className="filtros">
        <input
          className="campo"
          placeholder="Buscar item"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar item"
        />
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categorias
            .filter((c) => c.pai_id !== null)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
        </select>
      </div>
      <p className="origem">Os 60 mais usados que casam com a busca. Toque para editar, mover ou mesclar.</p>
      <ul className="lista-cadastro">
        {itens.map((i) => (
          <li key={i.id}>
            <button type="button" className="linha" onClick={() => setAberto(i)}>
              <span className="texto">
                <span className="nome">
                  {i.nome} {i.ativo ? '' : '(inativo)'}
                </span>
                <span className="detalhe">{i.categoria}</span>
              </span>
              <span className="valor">{i.lancamentos}</span>
            </button>
          </li>
        ))}
      </ul>
      {aberto && (
        <EditorItem
          item={aberto}
          categorias={categorias}
          onFechar={() => setAberto(null)}
          onFeito={(m) => {
            setAberto(null)
            setVersao((v) => v + 1)
            avisar(m)
          }}
        />
      )}
    </>
  )
}

function EditorItem({
  item,
  categorias,
  onFechar,
  onFeito,
}: {
  item: Item
  categorias: Categoria[]
  onFechar: () => void
  onFeito: (mensagem: string) => void
}) {
  const [nome, setNome] = useState(item.nome)
  const [categoriaId, setCategoriaId] = useState(item.categoria_id)
  const [ativo, setAtivo] = useState(item.ativo)
  const [erro, setErro] = useState<string | null>(null)
  const [buscaDestino, setBuscaDestino] = useState('')
  const [candidatos, setCandidatos] = useState<Item[]>([])
  const [destino, setDestino] = useState<Item | null>(null)
  // O que sobra do nome deste item tirando o nome do destino ("Estacionamento Shopping Centro"
  // em "Estacionamento" -> "Shopping Centro"); calculado pelo banco (resto_do_nome).
  const [resto, setResto] = useState<{ destinoId: number; texto: string | null } | null>(null)
  const [guardarManual, setGuardarManual] = useState<{ destinoId: number; valor: boolean } | null>(null)

  // Candidatos a receber a mesclagem: itens da mesma natureza que casam com a busca.
  useEffect(() => {
    if (!buscaDestino.trim()) return
    let cancelado = false
    supabase
      .from('v_item')
      .select('id,nome,categoria_id,categoria,natureza,usos,ativo,lancamentos')
      .ilike('nome', `%${buscaDestino.trim()}%`)
      .eq('natureza', item.natureza)
      .neq('id', item.id)
      .order('usos', { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (!cancelado) setCandidatos((data ?? []) as Item[])
      })
    return () => {
      cancelado = true
    }
  }, [buscaDestino, item.id, item.natureza])

  useEffect(() => {
    if (!destino) return
    let cancelado = false
    supabase.rpc('resto_do_nome', { p_nome: item.nome, p_base: destino.nome }).then(({ data }) => {
      if (!cancelado) setResto({ destinoId: destino.id, texto: typeof data === 'string' ? data : null })
    })
    return () => {
      cancelado = true
    }
  }, [destino, item.nome])

  const restoAtual = destino && resto?.destinoId === destino.id ? resto.texto : null
  // Marcado por padrão: juntar um item em outro normalmente quer dizer que o nome
  // dele vira o detalhe ("Netflix" em "Streamings e Assinaturas"). Para uma grafia
  // errada do mesmo item ("Uberr" em "Uber"), basta desmarcar.
  const guardarPadrao = restoAtual !== null
  const guardarNome =
    destino && guardarManual?.destinoId === destino.id ? guardarManual.valor : guardarPadrao

  const opcoesCategoria = categorias.filter((c) => c.pai_id !== null && c.natureza === item.natureza)
  const mudouCategoria = categoriaId !== item.categoria_id

  async function salvar() {
    setErro(null)
    const novoNome = nome.trim()
    if (novoNome && novoNome !== item.nome) {
      const { error } = await supabase.from('item').update({ nome: novoNome }).eq('id', item.id)
      if (error) {
        setErro('Já existe um item com esse nome nesta categoria. Use "Mesclar" para juntar os dois.')
        return
      }
    }
    if (ativo !== item.ativo) {
      const { error } = await supabase.from('item').update({ ativo }).eq('id', item.id)
      if (error) return setErro(ERRO_PADRAO)
    }
    if (mudouCategoria) {
      const { error } = await supabase.rpc('mover_item', { p_id: item.id, p_categoria_id: categoriaId })
      if (error) return setErro(ERRO_PADRAO)
    }
    onFeito('Item atualizado.')
  }

  async function mesclar() {
    if (!destino) return
    const { error } = await supabase.rpc('mesclar_item', {
      p_origem: item.id,
      p_destino: destino.id,
      p_guardar_nome: guardarNome && restoAtual !== null,
    })
    if (error) setErro(ERRO_PADRAO)
    else onFeito(`"${item.nome}" foi juntado a "${destino.nome}".`)
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label="Editar item">
      <div className="folha">
        <header>
          <h2>Editar item</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        <p className="origem">
          {item.lancamentos} {item.lancamentos === 1 ? 'lançamento usa' : 'lançamentos usam'} este item.
        </p>

        <label className="campo-rotulado">
          Nome
          <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo-rotulado">
          Categoria
          <select className="campo" value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))}>
            {opcoesCategoria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        {mudouCategoria && (
          <p className="origem">
            Todos os lançamentos deste item ({item.lancamentos}) mudam de categoria junto, inclusive os de
            meses passados.
          </p>
        )}
        <label className="marcar">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Aparece nas sugestões ao lançar
        </label>

        {erro && <p className="erro">{erro}</p>}
        <button type="button" className="principal" onClick={salvar}>
          Salvar
        </button>

        <p className="rotulo">Mesclar em outro item</p>
        <input
          className="campo"
          placeholder="Buscar o item que vai ficar"
          value={buscaDestino}
          onChange={(e) => {
            setBuscaDestino(e.target.value)
            setDestino(null)
          }}
        />
        {buscaDestino.trim() && !destino && (
          <div className="fichas suaves">
            {candidatos.map((c) => (
              <button key={c.id} type="button" onClick={() => setDestino(c)}>
                {c.nome} · {c.categoria}
              </button>
            ))}
          </div>
        )}
        {destino && (
          <div className="confirmar-apagar">
            <p>
              {item.lancamentos === 1 ? 'O lançamento' : `Os ${item.lancamentos} lançamentos`} de "{item.nome}"{' '}
              {item.lancamentos === 1 ? 'passa' : 'passam'} para "{destino.nome}" ({destino.categoria}) e "
              {item.nome}" deixa de existir. Não pode ser desfeito.
            </p>
            {restoAtual && (
              <label className="marcar">
                <input
                  type="checkbox"
                  checked={guardarNome}
                  onChange={(e) => setGuardarManual({ destinoId: destino.id, valor: e.target.checked })}
                />
                Guardar "{restoAtual}" como observação nesses lançamentos
              </label>
            )}
            <button type="button" className="perigo" onClick={mesclar}>
              Mesclar
            </button>
            <button type="button" className="discreto" onClick={() => setDestino(null)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------- Categorias

function Categorias({ avisar }: { avisar: (m: string) => void }) {
  const [versao, setVersao] = useState(0)
  const { categorias, itens } = useEstrutura(versao)

  async function executar(operacao: PromiseLike<{ error: unknown }>, mensagem: string) {
    const { error } = await operacao
    avisar(error ? ERRO_PADRAO : mensagem)
    if (!error) setVersao((v) => v + 1)
  }

  const grupos = categorias.filter((c) => c.pai_id === null)

  return (
    <>
      <p className="origem">
        Renomear não altera o histórico: os lançamentos apontam para a categoria, não para o nome.
      </p>
      {grupos.map((g) => (
        <section key={g.id} className="bloco-cadastro">
          <h2>{g.nome}</h2>
          {categorias
            .filter((c) => c.pai_id === g.id)
            .map((c) => (
              <div key={c.id} className="cartao-cadastro">
                <div className="cabecalho">
                  <TextoEditavel
                    valor={c.nome}
                    onSalvar={(nome) =>
                      executar(supabase.from('categoria').update({ nome }).eq('id', c.id), 'Categoria renomeada.')
                    }
                  />
                  <label className="marcar">
                    <input
                      type="checkbox"
                      checked={c.ativa}
                      onChange={(e) =>
                        executar(
                          supabase.from('categoria').update({ ativa: e.target.checked }).eq('id', c.id),
                          e.target.checked ? 'Categoria reativada.' : 'Categoria inativada.',
                        )
                      }
                    />
                    ativa
                  </label>
                </div>
                <p className="detalhe itens-da-categoria">
                  {itens
                    .filter((i) => i.categoria_id === c.id && i.ativo)
                    .map((i) => i.nome)
                    .join(' · ') || 'Nenhum item ainda.'}
                </p>
                <Adicionar
                  rotulo="Novo item"
                  onCriar={(nome) =>
                    executar(supabase.from('item').insert({ categoria_id: c.id, nome }), 'Item criado.')
                  }
                />
              </div>
            ))}
          <Adicionar
            rotulo={`Nova categoria em ${g.nome}`}
            onCriar={(nome) =>
              executar(
                supabase.from('categoria').insert({
                  pai_id: g.id,
                  nome,
                  natureza: g.natureza,
                  destino: g.destino,
                  custo_de_vida: g.custo_de_vida,
                  ordem: 99,
                }),
                'Categoria criada.',
              )
            }
          />
        </section>
      ))}
    </>
  )
}

// --------------------------------------------------------------- Contas

const TIPOS_CONTA = ['cartao', 'corrente', 'corretora', 'reserva', 'cripto']
const CONTA_NOVA: Conta = {
  id: 0,
  nome: '',
  tipo: 'cartao',
  dia_fechamento_padrao: 28,
  dia_vencimento: 1,
  apelido_carteira: null,
  ativa: true,
}

function Contas({ avisar }: { avisar: (m: string) => void }) {
  const [versao, setVersao] = useState(0)
  const [contas, setContas] = useState<Conta[]>([])
  const [aberta, setAberta] = useState<Conta | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('conta')
      .select('id,nome,tipo,dia_fechamento_padrao,dia_vencimento,apelido_carteira,ativa')
      .order('ativa', { ascending: false })
      .order('id')
      .then(({ data }) => {
        if (!cancelado) setContas((data ?? []) as Conta[])
      })
    return () => {
      cancelado = true
    }
  }, [versao])

  async function salvar(c: Conta) {
    const cartao = c.tipo === 'cartao'
    const campos = {
      nome: c.nome.trim(),
      tipo: c.tipo,
      dia_fechamento_padrao: cartao ? c.dia_fechamento_padrao : null,
      dia_vencimento: cartao ? c.dia_vencimento : null,
      apelido_carteira: cartao ? c.apelido_carteira?.trim() || null : null,
      ativa: c.ativa,
    }
    const { error } = c.id
      ? await supabase.from('conta').update(campos).eq('id', c.id)
      : await supabase.from('conta').insert(campos)
    avisar(error ? ERRO_PADRAO : c.id ? 'Conta atualizada.' : 'Conta criada.')
    if (!error) {
      setAberta(null)
      setVersao((v) => v + 1)
    }
  }

  return (
    <>
      <p className="origem">
        Cartão cancelado é inativado, não apagado: o histórico e as parcelas em aberto continuam.
      </p>
      <ul className="lista-cadastro">
        {contas.map((c) => (
          <li key={c.id}>
            <button type="button" className="linha" onClick={() => setAberta(c)}>
              <span className="texto">
                <span className="nome">
                  {c.nome} {c.ativa ? '' : '(inativa)'}
                </span>
                <span className="detalhe">
                  {c.tipo}
                  {c.tipo === 'cartao' && c.dia_fechamento_padrao
                    ? ` · fecha dia ${c.dia_fechamento_padrao}, vence dia ${c.dia_vencimento ?? '?'}`
                    : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="principal" onClick={() => setAberta(CONTA_NOVA)}>
        Nova conta ou cartão
      </button>

      {aberta && (
        <div className="folha-fundo" role="dialog" aria-modal="true" aria-label="Conta">
          <div className="folha">
            <header>
              <h2>{aberta.id ? 'Editar conta' : 'Nova conta'}</h2>
              <button type="button" className="fechar" aria-label="Fechar" onClick={() => setAberta(null)}>
                ×
              </button>
            </header>
            <label className="campo-rotulado">
              Nome
              <input
                className="campo"
                value={aberta.nome}
                onChange={(e) => setAberta({ ...aberta, nome: e.target.value })}
              />
            </label>
            <label className="campo-rotulado">
              Tipo
              <select
                className="campo"
                value={aberta.tipo}
                onChange={(e) => setAberta({ ...aberta, tipo: e.target.value })}
              >
                {TIPOS_CONTA.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {aberta.tipo === 'cartao' && (
              <>
                <div className="linha-dupla">
                  <label>
                    Dia de fechamento
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={aberta.dia_fechamento_padrao ?? ''}
                      onChange={(e) =>
                        setAberta({ ...aberta, dia_fechamento_padrao: Number(e.target.value) || null })
                      }
                    />
                  </label>
                  <label>
                    Dia de vencimento
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={aberta.dia_vencimento ?? ''}
                      onChange={(e) => setAberta({ ...aberta, dia_vencimento: Number(e.target.value) || null })}
                    />
                  </label>
                </div>
                <label className="campo-rotulado">
                  Nome na Carteira do iPhone (para o atalho do Apple Pay)
                  <input
                    className="campo"
                    value={aberta.apelido_carteira ?? ''}
                    onChange={(e) => setAberta({ ...aberta, apelido_carteira: e.target.value })}
                  />
                </label>
              </>
            )}
            <label className="marcar">
              <input
                type="checkbox"
                checked={aberta.ativa}
                onChange={(e) => setAberta({ ...aberta, ativa: e.target.checked })}
              />
              Ativa (aparece ao lançar)
            </label>
            <button
              type="button"
              className="principal"
              disabled={!aberta.nome.trim()}
              onClick={() => salvar(aberta)}
            >
              Salvar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// --------------------------------------------------------------- Regras

function Regras({ avisar }: { avisar: (m: string) => void }) {
  const [busca, setBusca] = useState('')
  const [versao, setVersao] = useState(0)
  const [regras, setRegras] = useState<Regra[]>([])
  const [apagando, setApagando] = useState<number | null>(null)

  useEffect(() => {
    let cancelado = false
    let q = supabase.from('v_regra').select('id,padrao,origem,item,categoria')
    if (busca.trim()) q = q.ilike('padrao', `%${busca.trim().toLowerCase()}%`)
    q.order('origem')
      .order('padrao')
      .limit(60)
      .then(({ data }) => {
        if (!cancelado) setRegras((data ?? []) as Regra[])
      })
    return () => {
      cancelado = true
    }
  }, [busca, versao])

  async function apagar(id: number) {
    const { error } = await supabase.from('regra_categorizacao').delete().eq('id', id)
    setApagando(null)
    avisar(error ? ERRO_PADRAO : 'Regra apagada.')
    if (!error) setVersao((v) => v + 1)
  }

  return (
    <>
      <input
        className="campo"
        placeholder="Buscar pelo texto da regra"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-label="Buscar regra"
      />
      <p className="origem">
        Cada regra diz: quando o texto for este, sugira este item. Apagar vale para os próximos
        lançamentos; os já feitos não mudam.
      </p>
      <ul className="lista-cadastro">
        {regras.map((r) => (
          <li key={r.id}>
            <div className="linha">
              <span className="texto">
                <span className="nome">{r.padrao}</span>
                <span className="detalhe">
                  → {r.item} · {r.categoria} · {r.origem}
                </span>
              </span>
              {apagando === r.id ? (
                <span className="acoes">
                  <button type="button" className="perigo" onClick={() => apagar(r.id)}>
                    Apagar
                  </button>
                  <button type="button" className="discreto" onClick={() => setApagando(null)}>
                    Não
                  </button>
                </span>
              ) : (
                <button type="button" className="discreto" onClick={() => setApagando(r.id)}>
                  apagar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------- Recorrentes

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Modelos que geram, todo mês, um lançamento pendente; e sugestões tiradas do histórico. */
function Recorrentes({ avisar }: { avisar: (m: string) => void }) {
  const [versao, setVersao] = useState(0)
  const [modelos, setModelos] = useState<Recorrencia[]>([])
  const [sugestoes, setSugestoes] = useState<SugestaoRecorrente[]>([])
  const [aberto, setAberto] = useState<Recorrencia | null>(null)

  useEffect(() => {
    let cancelado = false
    Promise.all([
      supabase
        .from('v_recorrencia')
        .select('id,observacao,item,categoria,conta_id,conta,valor_estimado,dia_previsto,periodicidade,inicio,ativa')
        .order('ativa', { ascending: false })
        .order('natureza', { ascending: false })
        .order('categoria_ordem')
        .order('dia_previsto'),
      supabase
        .from('v_recorrencia_sugerida')
        .select('ultimo_lancamento_id,meses,categoria,item,observacao,ultimo_valor,dia,conta')
        .order('natureza', { ascending: false })
        .order('categoria_ordem')
        .order('meses', { ascending: false }),
    ]).then(([m, s]) => {
      if (cancelado) return
      setModelos((m.data ?? []) as Recorrencia[])
      setSugestoes((s.data ?? []) as SugestaoRecorrente[])
    })
    return () => {
      cancelado = true
    }
  }, [versao])

  async function adicionar(s: SugestaoRecorrente) {
    const { error } = await supabase.rpc('criar_recorrencia', { p_lancamento_id: s.ultimo_lancamento_id })
    avisar(error ? ERRO_PADRAO : `"${s.observacao ?? s.item}" vai aparecer para confirmar todo mês.`)
    if (!error) setVersao((v) => v + 1)
  }

  const quando = (r: Recorrencia) =>
    r.periodicidade === 'anual'
      ? `todo ${MESES.at(Number(r.inicio.slice(5, 7)) - 1)}, dia ${r.dia_previsto ?? '?'}`
      : `dia ${r.dia_previsto ?? '?'}`

  return (
    <>
      <p className="origem">
        Cada modelo gera, no início do mês, um lançamento pendente para você confirmar com um toque ou
        ajustar. O valor do modelo acompanha o último que você confirmou.
      </p>
      {modelos.length === 0 && <p className="vazio">Nenhum recorrente ainda. Comece pelas sugestões abaixo.</p>}
      <ul className="lista-cadastro">
        {modelos.map((r) => (
          <li key={r.id} className={r.ativa ? undefined : 'inativo'}>
            <button type="button" className="linha" onClick={() => setAberto(r)}>
              <span className="texto">
                <span className="nome">
                  {r.observacao ?? r.item ?? r.categoria} {r.ativa ? '' : '(parado)'}
                </span>
                <span className="detalhe">
                  {r.observacao && r.item ? r.item : r.categoria} · {r.conta} · {quando(r)}
                </span>
              </span>
              <span className="valor">{reais(r.valor_estimado)}</span>
            </button>
          </li>
        ))}
      </ul>

      {sugestoes.length > 0 && (
        <>
          <p className="rotulo">Sugestões do histórico</p>
          <p className="origem">
            Lançamentos que se repetiram quase todo mês nos últimos 6 meses. Adicione os que são contas fixas ou
            assinaturas.
          </p>
          <ul className="lista-cadastro">
            {sugestoes.map((s) => (
              <li key={s.ultimo_lancamento_id}>
                <div className="linha">
                  <span className="texto">
                    <span className="nome">{s.observacao ?? s.item}</span>
                    <span className="detalhe">
                      {s.observacao ? `${s.item} · ` : ''}
                      {reais(s.ultimo_valor)} · dia {s.dia} · {s.meses} de 6 meses
                    </span>
                  </span>
                  <button type="button" className="discreto" onClick={() => adicionar(s)}>
                    adicionar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {aberto && (
        <EditorRecorrencia
          modelo={aberto}
          onFechar={() => setAberto(null)}
          onFeito={(m) => {
            setAberto(null)
            setVersao((v) => v + 1)
            avisar(m)
          }}
        />
      )}
    </>
  )
}

function EditorRecorrencia({
  modelo,
  onFechar,
  onFeito,
}: {
  modelo: Recorrencia
  onFechar: () => void
  onFeito: (mensagem: string) => void
}) {
  const [valor, setValor] = useState(modelo.valor_estimado.toFixed(2).replace('.', ','))
  const [dia, setDia] = useState(String(modelo.dia_previsto ?? ''))
  const [contaId, setContaId] = useState(modelo.conta_id)
  const [periodicidade, setPeriodicidade] = useState(modelo.periodicidade)
  const [ativa, setAtiva] = useState(modelo.ativa)
  const [contas, setContas] = useState<{ id: number; nome: string }[]>([])
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('conta')
      .select('id,nome,ativa')
      .order('id')
      .then(({ data }) => {
        if (!cancelado)
          setContas(((data ?? []) as { id: number; nome: string; ativa: boolean }[]).filter(
            (c) => c.ativa || c.id === modelo.conta_id,
          ))
      })
    return () => {
      cancelado = true
    }
  }, [modelo.conta_id])

  async function salvar() {
    const numero = paraNumero(valor)
    const d = Number(dia)
    if (numero === null || numero === 0) return setErro('Valor inválido.')
    if (!Number.isInteger(d) || d < 1 || d > 31) return setErro('Dia entre 1 e 31.')
    const { error } = await supabase
      .from('recorrencia')
      .update({ valor_estimado: numero, dia_previsto: d, conta_id: contaId, periodicidade, ativa })
      .eq('id', modelo.id)
    if (error) setErro(ERRO_PADRAO)
    else onFeito(ativa ? 'Recorrente atualizado.' : 'Recorrente parado: não gera mais lançamentos.')
  }

  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label="Editar recorrente">
      <div className="folha">
        <header>
          <h2>{modelo.observacao ?? modelo.item ?? modelo.categoria}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        <p className="origem">
          {modelo.categoria}
          {modelo.observacao && modelo.item ? ` · ${modelo.item}` : ''}. Mudanças valem a partir do próximo
          lançamento gerado.
        </p>
        <div className="linha-dupla">
          <label>
            Valor estimado
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
          <label>
            Dia do mês
            <input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
        </div>
        <div className="linha-dupla">
          <label>
            Conta
            <select value={contaId} onChange={(e) => setContaId(Number(e.target.value))}>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Repete
            <select
              value={periodicidade}
              onChange={(e) => setPeriodicidade(e.target.value as Recorrencia['periodicidade'])}
            >
              <option value="mensal">Todo mês</option>
              <option value="anual">Todo ano, em {MESES.at(Number(modelo.inicio.slice(5, 7)) - 1)}</option>
            </select>
          </label>
        </div>
        <label className="marcar">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Gera lançamento todo mês (desmarque para parar)
        </label>
        {erro && <p className="erro">{erro}</p>}
        <button type="button" className="principal" onClick={salvar}>
          Salvar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Tela

export function Cadastros({ onVoltar }: { onVoltar: () => void }) {
  const [aba, setAba] = useState<Aba>('itens')
  const [aviso, setAviso] = useState<string | null>(null)

  function avisar(mensagem: string) {
    setAviso(mensagem)
    setTimeout(() => setAviso(null), 3000)
  }

  const conteudo: Record<Aba, ReactNode> = {
    itens: <Itens avisar={avisar} />,
    recorrentes: <Recorrentes avisar={avisar} />,
    categorias: <Categorias avisar={avisar} />,
    contas: <Contas avisar={avisar} />,
    regras: <Regras avisar={avisar} />,
  }

  return (
    <main className="cadastros">
      <header className="mes">
        <button aria-label="Voltar aos lançamentos" onClick={onVoltar}>
          ‹
        </button>
        <h1>Cadastros</h1>
        <span className="espaco" />
      </header>
      <div className="segmentos abas" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className={aba === a.id ? 'ativo' : undefined}
            onClick={() => setAba(a.id)}
          >
            {a.nome}
          </button>
        ))}
      </div>
      {conteudo[aba]}
      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}
    </main>
  )
}

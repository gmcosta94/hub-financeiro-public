import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { centavosTexto, hojeISO, lerDigitado, mesCurto, nomeDoDia, paraNumero, reais } from '../lib/formato'
import { Cartao, Segmentos } from '../lib/graficos'
import { atualizarCambio } from '../lib/indices'
import { useRentabilidade, useReserva } from '../lib/investimentos'
import { Aposentadoria, TabelaRentabilidade } from './Rentabilidade'
import { Reserva } from './Reserva'

/**
 * Aba Investimentos, do mais importante para o detalhe:
 * 1. total investido, a rentabilidade geral e a composição;
 * 2. objetivos: aposentadoria e reserva de emergência;
 * 3. rentabilidade de cada carteira desde o início;
 * 4. carteira principal: meta × real por bloco (abre nos ativos) e o aporte do mês;
 * 5. carteira satélite (por grupo) e previdência.
 * A conta está no banco (alocacao_carteira, sugestao_aporte, posicao_carteira,
 * rentabilidade_investimentos, objetivo_situacao, projetos_situacao). Preços à mão;
 * câmbio e IPCA do Banco Central.
 */

type Alocacao = {
  ativo_id: number
  ticker: string
  moeda: 'BRL' | 'USD'
  bloco_id: number | null
  bloco: string | null
  bloco_ordem: number | null
  quantidade: number
  preco: number | null
  preco_em: string | null
  valor_brl: number | null
  custo_brl: number
  peso_real: number | null
  peso_meta: number
}
type Posicao = {
  ativo_id: number
  ticker: string
  grupo: string | null
  moeda: 'BRL' | 'USD'
  bolso: string
  quantidade: number
  preco: number | null
  valor_brl: number | null
  custo_brl: number
}
type Sugestao = { ativo_id: number; ticker: string; bloco: string; moeda: string; sugerido_brl: number; quantidade_aprox: number | null }
type Bloco = { id: number; nome: string; peso_meta: number; ordem: number; bolso_id: number | null }
type GrupoMeta = { nome: string; real: number; meta: number; valor: number; ativos: Alocacao[] }

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1).replace('.', ',')}%`)
const num = (v: number, casas = 4) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas })

export function Carteira({ podeEditar }: { podeEditar: boolean }) {
  const [versao, setVersao] = useState(0)
  const [dados, setDados] = useState<{
    alocacao: Alocacao[]
    alocacaoSatelite: Alocacao[]
    sateliteId: number | null
    posicao: Posicao[]
    blocos: Bloco[]
    cambio: { data: string; usd_brl: number } | null
  } | null>(null)
  const [aporte, setAporte] = useState<number | null>(null) // centavos
  const rent = useRentabilidade(versao, podeEditar)
  const reserva = useReserva(versao)
  const [sugestao, setSugestao] = useState<Sugestao[] | null>(null)
  const [folha, setFolha] = useState<'precos' | 'operacao' | 'metas' | 'metas-satelite' | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    if (!podeEditar) return
    let cancelado = false
    atualizarCambio().then((n) => {
      if (!cancelado && n > 0) setVersao((v) => v + 1)
    })
    return () => {
      cancelado = true
    }
  }, [podeEditar])

  useEffect(() => {
    let cancelado = false
    supabase
      .from('bolso')
      .select('id')
      .eq('tipo', 'carteira_satelite')
      .limit(1)
      .maybeSingle()
      .then(async ({ data: sat }) => {
        const sateliteId = (sat as { id: number } | null)?.id ?? null
        const [a, s, p, b, c] = await Promise.all([
          supabase.rpc('alocacao_carteira'),
          sateliteId ? supabase.rpc('alocacao_carteira', { p_bolso_id: sateliteId }) : Promise.resolve({ data: [] }),
          supabase.rpc('posicao_carteira'),
          supabase.from('bloco').select('id,nome,peso_meta,ordem,bolso_id').order('ordem'),
          supabase.from('cambio').select('data,usd_brl').order('data', { ascending: false }).limit(1),
        ])
        if (cancelado) return
        setDados({
          alocacao: (a.data ?? []) as Alocacao[],
          // Ativos já vendidos (quantidade zero) saem da satélite.
          alocacaoSatelite: ((s.data ?? []) as Alocacao[]).filter((x) => x.quantidade !== 0),
          sateliteId,
          posicao: (p.data ?? []) as Posicao[],
          blocos: (b.data ?? []) as Bloco[],
          cambio: ((c.data ?? []) as { data: string; usd_brl: number }[])[0] ?? null,
        })
      })
    return () => {
      cancelado = true
    }
  }, [versao])

  const alocacao = useMemo(() => dados?.alocacao ?? [], [dados])
  const satelite = (dados?.posicao ?? []).filter((p) => p.bolso === 'Carteira Satélite' && p.quantidade !== 0)
  // Previdência é um bolso à parte: fora das metas, mas conta na poupança.
  const previdencia = (dados?.posicao ?? []).filter((p) => p.bolso === 'Previdência' && p.quantidade !== 0)
  const totalPrincipal = alocacao.reduce((s, a) => s + (a.valor_brl ?? 0), 0)
  const totalSatelite = satelite.reduce((s, a) => s + (a.valor_brl ?? 0), 0)
  const totalPrevidencia = previdencia.reduce((s, a) => s + (a.valor_brl ?? 0), 0)

  const alocacaoSatelite = useMemo(() => dados?.alocacaoSatelite ?? [], [dados])
  const blocos = useMemo(() => agruparBlocos(alocacao), [alocacao])
  const blocosSatelite = useMemo(() => agruparBlocos(alocacaoSatelite).sort((x, y) => y.valor - x.valor), [alocacaoSatelite])
  const blocosPrincipal = (dados?.blocos ?? []).filter((b) => b.bolso_id === null)
  const blocosDaSatelite = (dados?.blocos ?? []).filter((b) => b.bolso_id !== null && b.bolso_id === dados?.sateliteId)

  function avisar(m: string) {
    setAviso(m)
    setTimeout(() => setAviso(null), 2500)
  }

  async function sugerir() {
    if (!aporte) return
    const { data } = await supabase.rpc('sugestao_aporte', { p_valor: aporte / 100 })
    setSugestao((data ?? []) as Sugestao[])
  }

  const semPreco = alocacao.filter((a) => a.quantidade !== 0 && a.preco === null)

  const todos = rent.dados?.linhas.find((l) => !l.bolso)?.r
  const saldoReserva = reserva.dados?.reserva?.saldo ?? 0
  const totalGeral = totalPrincipal + totalSatelite + totalPrevidencia + saldoReserva

  return (
    <main className="carteira investimentos">
      {/* 1. Quanto tem, quanto rende e onde está. */}
      <section className="heroi heroi-invest">
        <span>Total investido</span>
        <strong>{reais(totalGeral)}</strong>
        {!rent.dados && <small>calculando a rentabilidade…</small>}
        {todos?.taxa_nominal !== null && todos?.taxa_nominal !== undefined && (
          <small>
            Os investimentos rendem <b>{pct(todos.taxa_nominal)} ao ano</b>
            {todos.inicio ? ` desde ${mesCurto(todos.inicio)}` : ''}
            {todos.taxa_real !== null ? `, ${pct(todos.taxa_real)} acima da inflação` : ''}
            {todos.ganho !== null ? ` · ganho de ${reais(todos.ganho)}` : ''}
          </small>
        )}
        <Segmentos
          partes={[
            { nome: 'Reserva', valor: saldoReserva, serie: 3 },
            { nome: 'Carteira principal', valor: totalPrincipal, serie: 1 },
            { nome: 'Carteira satélite', valor: totalSatelite, serie: 2 },
            { nome: 'Previdência', valor: totalPrevidencia, serie: 4 },
          ]}
          formato={reais}
        />
      </section>

      {/* 2. Objetivos. */}
      <div className="grade-invest grade-objetivos">
        {/* A rentabilidade leva uns segundos (taxa interna de retorno de todo o histórico):
            o cartão já ocupa o lugar enquanto isso, para a página não pular. */}
        {rent.dados ? (
          <Aposentadoria dados={rent.dados} podeEditar={podeEditar} onSalvo={rent.recarregar} />
        ) : (
          <Cartao titulo="Aposentadoria" classe="cartao-objetivo carregando">
            <p className="vazio">Calculando…</p>
          </Cartao>
        )}
        {reserva.dados && (
          <Reserva
            dados={reserva.dados}
            podeEditar={podeEditar}
            onMudou={(m) => {
              reserva.recarregar()
              avisar(m)
            }}
          />
        )}
      </div>

      {/* 3. Rentabilidade. */}
      {rent.dados ? (
        <TabelaRentabilidade dados={rent.dados} />
      ) : (
        <Cartao titulo="Rentabilidade desde o início" classe="carregando">
          <p className="vazio">Calculando…</p>
        </Cartao>
      )}

      {/* 4. Carteira principal com aporte, ferramentas e previdência ao lado; satélite
          embaixo. No celular, um embaixo do outro nessa mesma ordem. */}
      <div className="grade-carteira">
        <MetaReal
          titulo="Carteira principal · meta × real"
          total={totalPrincipal}
          blocos={blocos}
          classe="area-principal"
          onEditarMetas={podeEditar ? () => setFolha('metas') : undefined}
          rodape={
            dados?.cambio && (
              <p className="origem">
                Dólar a {num(dados.cambio.usd_brl)} em {nomeDoDia(dados.cambio.data)}. Pesos sobre a carteira principal.
              </p>
            )
          }
        />

        <div className="coluna-lateral">
          <Cartao titulo="Aporte do mês" classe="cartao-aporte">
            <p className="origem">Quanto vai para a carteira principal: a sugestão reforça o que está abaixo da meta, sem vender nada.</p>
            <div className="campo-valor">
              <span>R$</span>
              <input
                inputMode="numeric"
                placeholder="0,00"
                value={aporte ? centavosTexto(aporte) : ''}
                onChange={(e) => {
                  const lido = lerDigitado(e.target.value)
                  if (lido) {
                    setAporte(lido.centavos)
                    setSugestao(null)
                  }
                }}
                aria-label="Valor do aporte"
              />
            </div>
            <button type="button" className="principal" disabled={!aporte} onClick={sugerir}>
              Sugerir
            </button>
            {sugestao && (
              <ul className="lista-painel">
                {sugestao.length === 0 && <li className="origem">Nada a sugerir.</li>}
                {sugestao.map((s) => (
                  <li key={s.ativo_id} className="linha-painel">
                    <span>
                      {s.ticker} <small>{s.bloco}</small>
                    </span>
                    <span>
                      {reais(s.sugerido_brl)}
                      {s.quantidade_aprox !== null && <small> ≈ {num(s.quantidade_aprox)} cotas</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {semPreco.length > 0 && (
              <p className="origem">Sem preço: {semPreco.map((a) => a.ticker).join(', ')}. A sugestão trata esses como zerados.</p>
            )}
          </Cartao>

          {podeEditar && (
            <div className="acoes-carteira">
              <button type="button" className="secundario" onClick={() => setFolha('precos')}>
                Atualizar preços
              </button>
              <button type="button" className="secundario" onClick={() => setFolha('operacao')}>
                Registrar operação
              </button>
            </div>
          )}

          {previdencia.length > 0 && (
            <Cartao titulo="Previdência" extra={reais(totalPrevidencia)}>
              <ul className="lista-painel">
                {previdencia.map((a) => {
                  const ganho = a.valor_brl === null ? null : a.valor_brl - a.custo_brl
                  return (
                    <li key={a.ativo_id} className="linha-previdencia">
                      <span className="linha-painel">
                        <span>{a.ticker}</span>
                        <span>{a.valor_brl === null ? 'sem saldo' : reais(a.valor_brl)}</span>
                      </span>
                      <small className="sub">
                        aportado {reais(a.custo_brl)}
                        {ganho !== null && a.custo_brl > 0 ? ` · ganho ${reais(ganho)} (${pct(ganho / a.custo_brl)})` : ''}
                      </small>
                    </li>
                  )
                })}
              </ul>
            </Cartao>
          )}
        </div>

        {satelite.length > 0 && (
          <MetaReal
            titulo="Carteira satélite · meta × real"
            total={totalSatelite}
            blocos={blocosSatelite}
            classe="area-satelite"
            onEditarMetas={podeEditar ? () => setFolha('metas-satelite') : undefined}
            rodape={<p className="origem">Blocos pelos grupos do MyProfit. Pesos sobre a carteira satélite.</p>}
          />
        )}
      </div>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      {folha === 'precos' && dados && (
        <FolhaPrecos
          ativos={[
            ...alocacao.map((a) => ({ id: a.ativo_id, ticker: a.ticker, moeda: a.moeda, preco: a.preco, saldo: false })),
            ...previdencia.map((s) => ({ id: s.ativo_id, ticker: s.ticker, moeda: s.moeda, preco: s.preco, saldo: true })),
            ...satelite.map((s) => ({ id: s.ativo_id, ticker: s.ticker, moeda: s.moeda, preco: s.preco, saldo: false })),
          ]}
          cambio={dados.cambio?.usd_brl ?? null}
          onFechar={() => setFolha(null)}
          onSalvo={() => {
            setFolha(null)
            setVersao((v) => v + 1)
            setSugestao(null)
            avisar('Preços atualizados.')
          }}
        />
      )}
      {folha === 'operacao' && dados && (
        <FolhaOperacao
          ativos={[
            ...alocacao.map((a) => ({ id: a.ativo_id, ticker: a.ticker, saldo: false })),
            ...previdencia.map((a) => ({ id: a.ativo_id, ticker: a.ticker, saldo: true })),
            ...satelite.map((a) => ({ id: a.ativo_id, ticker: a.ticker, saldo: false })),
          ]}
          onFechar={() => setFolha(null)}
          onSalvo={() => {
            setFolha(null)
            setVersao((v) => v + 1)
            setSugestao(null)
            avisar('Operação registrada.')
          }}
        />
      )}
      {(folha === 'metas' || folha === 'metas-satelite') && dados && (
        <FolhaMetas
          titulo={folha === 'metas' ? 'Metas da carteira principal' : 'Metas da carteira satélite'}
          blocos={folha === 'metas' ? blocosPrincipal : blocosDaSatelite}
          ativos={folha === 'metas' ? alocacao : alocacaoSatelite}
          onFechar={() => setFolha(null)}
          onSalvo={() => {
            setFolha(null)
            setVersao((v) => v + 1)
            setSugestao(null)
            avisar('Metas salvas.')
          }}
        />
      )}
    </main>
  )
}

function Folha({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  return (
    <div className="folha-fundo" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="folha">
        <header>
          <h2>{titulo}</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

const texto = (v: number | null, casas = 2) => (v === null ? '' : v.toFixed(casas).replace('.', ','))

function FolhaPrecos({
  ativos,
  cambio,
  onFechar,
  onSalvo,
}: {
  ativos: { id: number; ticker: string; moeda: string; preco: number | null; saldo: boolean }[]
  cambio: number | null
  onFechar: () => void
  onSalvo: () => void
}) {
  const [precos, setPrecos] = useState<Record<number, string>>(
    Object.fromEntries(ativos.map((a) => [a.id, texto(a.preco, a.preco !== null && a.preco < 10 ? 4 : 2)])),
  )
  const [usd, setUsd] = useState(texto(cambio, 4))
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const valores = ativos
      .map((a) => ({ ativo_id: a.id, preco: paraNumero(precos[a.id] ?? '') }))
      .filter((v) => v.preco !== null && v.preco > 0 && v.preco !== ativos.find((a) => a.id === v.ativo_id)?.preco)
    const c = paraNumero(usd)
    const { error } = await supabase.rpc('gravar_cotacoes', {
      p_valores: valores,
      p_data: hojeISO(),
      p_usd_brl: c !== null && c !== cambio ? c : null,
    })
    if (error) setErro('Não foi possível salvar.')
    else onSalvo()
  }

  return (
    <Folha titulo="Atualizar preços" onFechar={onFechar}>
      <p className="origem">Preço de hoje na moeda de cada ativo. O dólar vem do Banco Central; mude só se quiser outro.</p>
      <label className="campo-rotulado">
        Dólar (R$)
        <input className="campo" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
      </label>
      <ul className="detalhe-orc">
        {ativos.map((a) => (
          <li key={a.id}>
            <span className="texto">
              <span className="nome">{a.ticker}</span>
              <span className="detalhe">{a.saldo ? 'saldo em R$' : a.moeda === 'USD' ? 'em US$' : 'em R$'}</span>
            </span>
            <input
              className="campo"
              inputMode="decimal"
              value={precos[a.id] ?? ''}
              onChange={(e) => setPrecos((p) => ({ ...p, [a.id]: e.target.value }))}
              aria-label={`Preço de ${a.ticker}`}
            />
          </li>
        ))}
      </ul>
      {erro && <p className="erro">{erro}</p>}
      <button type="button" className="principal" onClick={salvar}>
        Salvar preços
      </button>
    </Folha>
  )
}

const TIPOS = { compra: 'Compra', venda: 'Venda', provento: 'Provento', ajuste: 'Desdobramento ou ajuste' } as const

function FolhaOperacao({
  ativos,
  onFechar,
  onSalvo,
}: {
  ativos: { id: number; ticker: string; saldo: boolean }[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const [ativoId, setAtivoId] = useState<number | null>(ativos[0]?.id ?? null)
  const [tipo, setTipo] = useState<keyof typeof TIPOS>('compra')
  const [data, setData] = useState(hojeISO())
  const [quantidade, setQuantidade] = useState('')
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Previdência é "1 posição": contribuição e resgate mexem só no valor.
  const porSaldo = ativos.find((a) => a.id === ativoId)?.saldo ?? false

  async function salvar() {
    setErro(null)
    const q = tipo === 'provento' || (porSaldo && tipo !== 'ajuste') ? 0 : paraNumero(quantidade)
    const v = tipo === 'ajuste' ? 0 : paraNumero(valor)
    if (ativoId === null) return setErro('Escolha o ativo.')
    if (q === null || (tipo !== 'provento' && !porSaldo && q === 0)) return setErro('Quantidade inválida.')
    if (tipo !== 'ajuste' && q !== null && q < 0) return setErro('Quantidade positiva; o tipo diz o sentido.')
    if (v === null || v < 0 || (tipo !== 'ajuste' && v === 0)) return setErro('Valor inválido.')
    const { error } = await supabase
      .from('movimentacao')
      .insert({ ativo_id: ativoId, tipo, data, quantidade: q, valor_brl: v, origem: 'manual' })
    if (error) setErro('Não foi possível registrar.')
    else onSalvo()
  }

  return (
    <Folha titulo="Registrar operação" onFechar={onFechar}>
      <div className="fichas">
        {(Object.keys(TIPOS) as (keyof typeof TIPOS)[]).map((t) => (
          <button key={t} type="button" className={tipo === t ? 'ativo' : undefined} onClick={() => setTipo(t)}>
            {TIPOS[t]}
          </button>
        ))}
      </div>
      <div className="linha-dupla">
        <label>
          Ativo
          <select value={ativoId ?? ''} onChange={(e) => setAtivoId(Number(e.target.value))}>
            {ativos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ticker}
              </option>
            ))}
          </select>
        </label>
        <label>
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      <div className="linha-dupla">
        {tipo !== 'provento' && !(porSaldo && tipo !== 'ajuste') && (
          <label>
            {tipo === 'ajuste' ? 'Cotas a mais (ou a menos, com −)' : 'Quantidade'}
            <input inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </label>
        )}
        {tipo !== 'ajuste' && (
          <label>
            {tipo === 'provento' ? 'Valor recebido (R$)' : 'Valor total com taxas (R$)'}
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
        )}
      </div>
      <p className="origem">
        {porSaldo
          ? 'Previdência: informe só o valor da contribuição ou do resgate; o saldo se atualiza em "Atualizar preços".'
          : 'Em ativo em dólar, informe o total em reais (o que saiu ou entrou na conta).'}
      </p>
      {erro && <p className="erro">{erro}</p>}
      <button type="button" className="principal" onClick={salvar}>
        Registrar
      </button>
    </Folha>
  )
}

function FolhaMetas({
  titulo,
  blocos,
  ativos,
  onFechar,
  onSalvo,
}: {
  titulo: string
  blocos: Bloco[]
  ativos: Alocacao[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const [pesoBloco, setPesoBloco] = useState<Record<number, string>>(
    Object.fromEntries(blocos.map((b) => [b.id, String(Math.round(b.peso_meta * 1000) / 10).replace('.', ',')])),
  )
  const [pesoAtivo, setPesoAtivo] = useState<Record<number, string>>({})
  const [carregado, setCarregado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .from('ativo')
      .select('id,peso_no_bloco')
      .in('id', ativos.map((a) => a.ativo_id))
      .then(({ data }) => {
        if (cancelado) return
        setPesoAtivo(
          Object.fromEntries(
            ((data ?? []) as { id: number; peso_no_bloco: number | null }[]).map((a) => [
              a.id,
              String(Math.round((a.peso_no_bloco ?? 0) * 1000) / 10).replace('.', ','),
            ]),
          ),
        )
        setCarregado(true)
      })
    return () => {
      cancelado = true
    }
  }, [ativos])

  const totalBlocos = blocos.reduce((s, b) => s + (paraNumero(pesoBloco[b.id] ?? '') ?? 0), 0)

  async function salvar() {
    setErro(null)
    if (Math.abs(totalBlocos - 100) > 0.05) return setErro(`Os blocos somam ${totalBlocos.toFixed(1)}%: precisam somar 100%.`)
    for (const b of blocos) {
      const { error } = await supabase
        .from('bloco')
        .update({ peso_meta: (paraNumero(pesoBloco[b.id] ?? '') ?? 0) / 100 })
        .eq('id', b.id)
      if (error) return setErro('Não foi possível salvar.')
    }
    for (const a of ativos) {
      const { error } = await supabase
        .from('ativo')
        .update({ peso_no_bloco: (paraNumero(pesoAtivo[a.ativo_id] ?? '') ?? 0) / 100 })
        .eq('id', a.ativo_id)
      if (error) return setErro('Não foi possível salvar.')
    }
    onSalvo()
  }

  return (
    <Folha titulo={titulo} onFechar={onFechar}>
      <p className="origem">
        Peso de cada bloco na carteira (somam 100%) e de cada ativo dentro do bloco (o app normaliza dentro do bloco).
      </p>
      {blocos.map((b) => (
        <div key={b.id} className="cartao-cadastro">
          <label className="campo-rotulado">
            {b.nome} (% da carteira)
            <input
              className="campo"
              inputMode="decimal"
              value={pesoBloco[b.id] ?? ''}
              onChange={(e) => setPesoBloco((p) => ({ ...p, [b.id]: e.target.value }))}
            />
          </label>
          {carregado && (
            <ul className="detalhe-orc">
              {ativos
                .filter((a) => a.bloco_id === b.id)
                .map((a) => (
                  <li key={a.ativo_id}>
                    <span className="nome">{a.ticker}</span>
                    <input
                      className="campo"
                      inputMode="decimal"
                      value={pesoAtivo[a.ativo_id] ?? ''}
                      onChange={(e) => setPesoAtivo((p) => ({ ...p, [a.ativo_id]: e.target.value }))}
                      aria-label={`Peso de ${a.ticker} no bloco`}
                    />
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
      <p className="total-orc">
        Blocos <strong>{totalBlocos.toFixed(1).replace('.', ',')}%</strong>
      </p>
      {erro && <p className="erro">{erro}</p>}
      <button type="button" className="principal" onClick={salvar}>
        Salvar metas
      </button>
    </Folha>
  )
}

function alternar(conjunto: Set<string>, chave: string) {
  const n = new Set(conjunto)
  if (n.has(chave)) n.delete(chave)
  else n.add(chave)
  return n
}

/** Ativos agrupados por bloco, com o peso real e a meta de cada bloco. */
function agruparBlocos(alocacao: Alocacao[]): GrupoMeta[] {
  const grupos: GrupoMeta[] = []
  for (const a of alocacao) {
    const nome = a.bloco ?? 'Sem bloco'
    let g = grupos.find((x) => x.nome === nome)
    if (!g) grupos.push((g = { nome, real: 0, meta: 0, valor: 0, ativos: [] }))
    g.real += a.peso_real ?? 0
    g.meta += a.peso_meta
    g.valor += a.valor_brl ?? 0
    g.ativos.push(a)
  }
  for (const g of grupos) g.ativos.sort((x, y) => (y.valor_brl ?? 0) - (x.valor_brl ?? 0))
  return grupos
}

/**
 * Cartão de meta × real de uma carteira: uma linha por bloco (abre nos ativos) e um
 * botão para abrir ou fechar todos. Sem metas definidas, mostra só o peso real.
 */
function MetaReal({
  titulo,
  total,
  blocos,
  classe,
  rodape,
  onEditarMetas,
}: {
  titulo: string
  total: number
  blocos: GrupoMeta[]
  classe?: string
  rodape?: ReactNode
  onEditarMetas?: () => void
}) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set())
  const comMeta = blocos.some((b) => b.meta > 0)
  const todosAbertos = blocos.length > 0 && blocos.every((b) => abertos.has(b.nome))

  return (
    <Cartao titulo={titulo} extra={reais(total)} classe={classe}>
      <div className="legenda-meta">
        <span className="chave-real" aria-hidden="true" /> real
        {comMeta && (
          <>
            <span className="chave-meta" aria-hidden="true" /> meta
          </>
        )}
        <button
          type="button"
          className="link abrir-todos"
          aria-pressed={todosAbertos}
          onClick={() => setAbertos(todosAbertos ? new Set() : new Set(blocos.map((b) => b.nome)))}
        >
          {todosAbertos ? 'Fechar todos' : 'Abrir todos os ativos'}
        </button>
      </div>
      {!comMeta && <p className="origem">Sem metas ainda: defina o peso de cada bloco em "Editar metas".</p>}
      <ul className="lista-meta">
        {blocos.map((b) => {
          const aberto = abertos.has(b.nome)
          return (
            <li key={b.nome}>
              <button
                type="button"
                className="linha-meta bloco"
                aria-expanded={aberto}
                onClick={() => setAbertos((x) => alternar(x, b.nome))}
              >
                <span className="nome">
                  <span className="seta" aria-hidden="true">
                    {aberto ? '▾' : '▸'}
                  </span>
                  {b.nome}
                  {!comMeta && <small>{b.ativos.length}</small>}
                </span>
                <BarraMeta real={b.real} meta={comMeta ? b.meta : 0} />
                <span className="pcts">
                  <strong>{pct(b.real)}</strong> {comMeta && <small>meta {pct(b.meta)}</small>}
                </span>
                {comMeta ? <Diferenca d={b.real - b.meta} /> : <span className="dif na-meta" />}
                <span className="valor">{reais(b.valor)}</span>
              </button>
              {aberto && (
                <ul className="ativos-meta">
                  {b.ativos.map((a) => (
                    <li key={a.ativo_id} className="linha-meta">
                      <span className="nome">{a.ticker}</span>
                      <BarraMeta real={a.peso_real ?? 0} meta={comMeta ? a.peso_meta : 0} />
                      <span className="pcts">
                        <strong>{pct(a.peso_real)}</strong> {comMeta && <small>meta {pct(a.peso_meta)}</small>}
                      </span>
                      {comMeta ? <Diferenca d={(a.peso_real ?? 0) - a.peso_meta} /> : <span className="dif na-meta" />}
                      <span className="valor">{a.valor_brl === null ? 'sem preço' : reais(a.valor_brl)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className="pe-meta">
        {rodape}
        {onEditarMetas && (
          <button type="button" className="link editar-metas" onClick={onEditarMetas}>
            Editar metas
          </button>
        )}
      </div>
    </Cartao>
  )
}

/**
 * Barra de meta × real: o preenchimento é o real, o traço é a meta. Escala fixa de 0
 * a 100% da carteira (marcas leves em 25, 50 e 75%), igual em todos os cartões.
 */
function BarraMeta({ real, meta }: { real: number; meta: number }) {
  const largura = (v: number) => `${Math.min(Math.max(v, 0), 1) * 100}%`
  return (
    <span className="barra-meta" aria-hidden="true">
      <span className={meta > 0 && real > meta + 0.01 ? 'real acima' : 'real'} style={{ width: largura(real) }} />
      {meta > 0 && <span className="meta" style={{ left: largura(meta) }} />}
    </span>
  )
}

/** Distância até a meta em pontos percentuais; abaixo de 1 p.p. conta como na meta. */
function Diferenca({ d }: { d: number }) {
  const pp = d * 100
  if (Math.abs(pp) < 1) return <span className="dif na-meta">na meta</span>
  return (
    <span className={pp > 0 ? 'dif acima' : 'dif abaixo'}>
      {pp > 0 ? '+' : '−'}
      {Math.abs(pp).toFixed(1).replace('.', ',')} p.p.
    </span>
  )
}

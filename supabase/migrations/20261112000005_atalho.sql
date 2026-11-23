-- Entrada do atalho do Apple Pay (fase 1.7).
--
-- O app Atalhos do iPhone chama registrar_atalho pela API do banco a cada
-- compra por aproximação. Não há login nessa chamada: quem autoriza é um
-- token longo e aleatório, gerado no app e colado no atalho.
--
-- O que o token permite: criar lançamentos PENDENTES. Nada mais. Ele não lê
-- dados, não edita nem apaga, e pode ser desativado a qualquer momento.

-- Nome com que o cartão aparece na Carteira do iPhone, para casar com a conta.
alter table public.conta add column apelido_carteira text;
update public.conta set apelido_carteira = 'Meu Banco' where nome = 'Cartão Principal';

-- Só o hash do token é guardado; o token em si aparece uma única vez, ao ser criado.
create table public.token_atalho (
  id             bigint generated always as identity primary key,
  nome           text not null,
  hash           text not null unique,
  ativo          boolean not null default true,
  ultimo_uso     timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

select public.aplicar_acesso_padrao('public.token_atalho');

-- Cria um token e devolve o valor dele. Só editor consegue (política da tabela).
create function public.criar_token_atalho(p_nome text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- dois UUIDs aleatórios: 244 bits, inviável de adivinhar
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into token_atalho (nome, hash)
  values (coalesce(nullif(trim(p_nome), ''), 'Atalho'), encode(sha256(v_token::bytea), 'hex'));
  return v_token;
end;
$$;

-- Chamado pelo atalho. Grava um lançamento pendente com a categoria sugerida.
--   p_valor chega como texto, no formato da Carteira ("R$ 22,00").
--   p_cartao é o nome do cartão na Carteira ("Meu Banco").
-- security definer: roda com permissão própria, porque quem chama não tem
-- login; por isso valida o token antes de qualquer coisa e só faz um insert.
create function public.registrar_atalho(
  p_token       text,
  p_comerciante text,
  p_valor       text,
  p_cartao      text default null,
  p_quando      timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id  bigint;
  v_txt       text;
  v_valor     numeric(14,2);
  v_local     timestamp := p_quando at time zone 'America/Sao_Paulo';
  v_data      date := v_local::date;
  v_conta_id  bigint;
  v_descricao text := nullif(trim(p_comerciante), '');
  v_item_id   bigint;
  v_cat_id    bigint;
  v_comp      date;
begin
  select id into v_token_id
    from token_atalho
   where hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex') and ativo;
  if v_token_id is null then
    raise exception 'Não autorizado' using errcode = '42501';
  end if;
  update token_atalho set ultimo_uso = now() where id = v_token_id;

  -- "R$ 1.234,56" -> 1234.56
  v_txt := regexp_replace(coalesce(p_valor, ''), '[^0-9,.-]', '', 'g');
  if position(',' in v_txt) > 0 then
    v_txt := replace(replace(v_txt, '.', ''), ',', '.');
  end if;
  begin
    v_valor := v_txt::numeric;
  exception when others then
    raise exception 'Valor inválido';
  end;
  if v_valor is null or v_valor = 0 then
    raise exception 'Valor inválido';
  end if;

  -- Conta: pelo apelido da Carteira; se não casar, o primeiro cartão ativo.
  select id into v_conta_id
    from conta
   where ativa and tipo = 'cartao'
   order by (lower(apelido_carteira) = lower(trim(coalesce(p_cartao, '')))) desc nulls last, id
   limit 1;
  if v_conta_id is null then
    raise exception 'Nenhum cartão ativo';
  end if;

  select s.item_id, s.categoria_id into v_item_id, v_cat_id from sugerir(v_descricao) s;
  v_comp := competencia_de(v_conta_id, v_data);

  -- A chave evita lançamento em dobro se o atalho disparar duas vezes no mesmo minuto.
  insert into lancamento (data, competencia, valor, conta_id, fatura_id, categoria_id, item_id,
                          descricao_original, origem_input, status, chave_dedup)
  values (v_data, v_comp, v_valor, v_conta_id, fatura_de(v_conta_id, v_comp), v_cat_id, v_item_id,
          v_descricao, 'atalho', 'pendente',
          'atalho:' || md5(concat_ws('|', v_conta_id, to_char(v_local, 'YYYY-MM-DD HH24:MI'),
                                     v_valor, normalizar(v_descricao))))
  on conflict (chave_dedup) where chave_dedup is not null do nothing;

  return 'ok';
end;
$$;

revoke execute on function public.criar_token_atalho(text) from public, anon;
grant execute on function public.criar_token_atalho(text) to authenticated;

-- Única função aberta a quem não tem login. Protegida pelo token.
revoke execute on function public.registrar_atalho(text, text, text, text, timestamptz) from public;
grant execute on function public.registrar_atalho(text, text, text, text, timestamptz) to anon, authenticated;

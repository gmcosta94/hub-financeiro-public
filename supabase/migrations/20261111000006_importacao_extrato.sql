-- Importação passa a aceitar também o extrato da conta corrente.
--
-- A fatura do cartão só existe em PDF, mas o extrato da conta é exportado em
-- OFX, que é estruturado e traz um identificador único por movimento (FITID).
-- Uma importação agora é de uma fatura OU de uma conta em um mês.

alter table public.importacao
  alter column fatura_id drop not null,
  add column conta_id    bigint references public.conta (id),
  add column competencia date check (extract(day from competencia) = 1),
  drop constraint importacao_tipo_check,
  add constraint importacao_tipo_check check (tipo in ('pdf', 'texto', 'ofx')),
  add constraint importacao_alvo_check check (
    (fatura_id is not null and conta_id is null)
    or (fatura_id is null and conta_id is not null and competencia is not null)
  );

-- No extrato, uma linha pode bater com um lançamento (gasto, renda) ou com uma
-- transferência (aporte, resgate, pagamento de fatura).
alter table public.importacao_linha
  add column transferencia_id bigint references public.transferencia (id) on delete set null,
  add column id_externo       text;   -- FITID do OFX

comment on column public.importacao_linha.id_externo is
  'Identificador do movimento no banco (FITID do OFX). O lançamento ou a transferência criados a partir da linha recebem chave_dedup = ''ofx:'' || id_externo.';

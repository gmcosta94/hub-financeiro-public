-- Base: funções utilitárias e controle de quem acessa.

create extension if not exists unaccent with schema extensions;

-- Normaliza uma descrição para comparação: minúsculas, sem acento,
-- sem o sufixo de parcela ("12x - 10") e sem a data no fim ("27/12").
-- É a única definição de "mesma descrição" do sistema; regras, itens e
-- a migração do histórico usam esta função.
create function public.normalizar(txt text)
returns text
language sql
stable
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(coalesce(txt, ''))),
          '\s*\d+\s*x\s*-\s*\d+\s*$', ''),      -- parcela: "15x - 14"
        '\s*\d{1,2}/\d{1,2}\s*$', ''),           -- data da compra: "27/12"
      '\s+', ' ', 'g')
  );
$$;

-- Mantém atualizado_em em qualquer tabela que tenha a coluna.
create function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- Quem pode entrar. Uma linha por pessoa do casal.
create table public.membro (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nome       text not null,
  papel      text not null check (papel in ('editor', 'leitor')),
  criado_em  timestamptz not null default now()
);

-- Usadas pelas políticas de acesso (migration 4).
-- security definer: consultam membro sem depender das políticas da própria tabela.
create function public.eh_membro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from membro where user_id = auth.uid());
$$;

create function public.eh_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from membro where user_id = auth.uid() and papel = 'editor');
$$;

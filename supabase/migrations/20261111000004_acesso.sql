-- Controle de acesso por linha, ligado em TODAS as tabelas de public.
--
-- Regra única: quem está em membro lê tudo; só quem tem papel 'editor' escreve.
-- Quem não está em membro (inclusive visitante sem login) não vê nada.
--
-- O laço abaixo percorre as tabelas existentes para nenhuma ficar de fora e
-- liga o gatilho de atualizado_em onde a coluna existe.
-- ATENÇÃO: tabela criada em migration futura precisa repetir este bloco
-- (ver função aplicar_acesso_padrao).

create function public.aplicar_acesso_padrao(tabela regclass)
returns void
language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', tabela);

  -- Permissões explícitas: o projeto no Supabase é criado com "Automatically
  -- expose new tables" desligado. Visitante sem login (anon) não recebe nada.
  execute format('revoke all on %s from anon', tabela);
  execute format('grant select, insert, update, delete on %s to authenticated', tabela);

  execute format('drop policy if exists membro_le on %s', tabela);
  execute format(
    'create policy membro_le on %s for select to authenticated using (public.eh_membro())',
    tabela);

  execute format('drop policy if exists editor_escreve on %s', tabela);
  execute format(
    'create policy editor_escreve on %s for all to authenticated
       using (public.eh_editor()) with check (public.eh_editor())',
    tabela);

  if exists (
    select 1 from pg_attribute
    where attrelid = tabela and attname = 'atualizado_em' and not attisdropped
  ) then
    execute format('drop trigger if exists tocar_atualizado_em on %s', tabela);
    execute format(
      'create trigger tocar_atualizado_em before update on %s
         for each row execute function public.tocar_atualizado_em()',
      tabela);
  end if;
end;
$$;

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    perform public.aplicar_acesso_padrao(t);
  end loop;
end;
$$;

-- membro é exceção na escrita: ninguém altera pelo app, só pelo painel do banco.
drop policy editor_escreve on public.membro;

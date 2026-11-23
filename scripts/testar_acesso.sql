-- Testa as políticas de acesso simulando cada tipo de usuário.
--
-- Uso:  supabase db query --remote --yes -f scripts/testar_acesso.sql
--       (ou psql "$DATABASE_URL" -f scripts/testar_acesso.sql no banco local)
--
-- Não deixa nada gravado: a única escrita que passa (a do editor) é desfeita
-- dentro do próprio teste. O resultado esperado está na coluna "esperado".

do $$
declare
  caso      record;
  n         bigint;
  leu       text;
  escreveu  text;
  saida     text := '';
begin
  for caso in
    select * from (
      select 1 as ordem, 'visitante sem login' as quem, 'anon' as papel_pg, null::uuid as uid,
             'não lê / não escreve' as esperado
      union all
      select 2, 'logado que não é membro', 'authenticated', gen_random_uuid(),
             'lê 0 linhas / não escreve'
      union all
      select 3, 'leitor (' || nome || ')', 'authenticated', user_id,
             'lê tudo / não escreve'
      from public.membro where papel = 'leitor'
      union all
      select 4, 'editor (' || nome || ')', 'authenticated', user_id,
             'lê tudo / escreve'
      from public.membro where papel = 'editor'
    ) c order by ordem
  loop
    perform set_config('request.jwt.claims',
                       json_build_object('sub', caso.uid, 'role', caso.papel_pg)::text, true);
    execute format('set local role %I', caso.papel_pg);

    begin
      select count(*) into n from public.categoria;
      leu := 'lê ' || n || ' linhas';
    exception when others then
      leu := 'não lê';
    end;

    begin
      insert into public.cenario (nome) values ('__teste_de_acesso__');
      raise exception 'desfazer';   -- passou: desfaz a escrita
    exception when others then
      escreveu := case when sqlerrm = 'desfazer' then 'escreve' else 'não escreve' end;
    end;

    reset role;
    saida := saida || format('%s: %s / %s  (esperado: %s)', caso.quem, leu, escreveu, caso.esperado) || E'\n';
  end loop;

  perform set_config('teste.resultado', saida, false);
end;
$$;

select current_setting('teste.resultado') as resultado;

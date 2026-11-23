-- Por padrão o Postgres deixa qualquer papel executar funções novas.
-- Aqui fica explícito: visitante sem login não executa nada de public, e a
-- função administrativa não pode ser chamada pela API.

revoke execute on all functions in schema public from public, anon;

grant execute on function public.eh_membro()       to authenticated;
grant execute on function public.eh_editor()       to authenticated;
grant execute on function public.normalizar(text)  to authenticated;

-- Só migrations (dono do banco) chamam esta.
revoke execute on function public.aplicar_acesso_padrao(regclass) from authenticated;

-- Funções criadas daqui em diante também nascem fechadas.
alter default privileges in schema public revoke execute on functions from public, anon;

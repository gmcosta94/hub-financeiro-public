-- Metas também na carteira satélite, no mesmo modelo da principal: blocos com peso na
-- carteira e ativos com peso dentro do bloco (alocacao_carteira e sugestao_aporte já
-- recebem a carteira como parâmetro).
--
-- O bloco passa a ter dono: bolso_id nulo = carteira principal (os blocos de hoje);
-- preenchido = outra carteira. Classe e região só fazem sentido na principal.

alter table public.bloco add column bolso_id bigint references public.bolso (id);
alter table public.bloco alter column classe drop not null;
alter table public.bloco alter column regiao drop not null;
alter table public.bloco drop constraint bloco_nome_key;
create unique index bloco_carteira_nome_idx on public.bloco (coalesce(bolso_id, 0), nome);

comment on column public.bloco.bolso_id is 'Carteira do bloco; nulo = carteira principal.';
comment on column public.ativo.bloco_id is 'Bloco da meta (principal ou satélite).';

-- Cria um bloco por grupo do MyProfit (Ações, ETF USA, Fundo Imobiliário...) para os
-- ativos de uma carteira que ainda não têm bloco, com meta zero, e os põe nele.
-- Devolve quantos ativos ganharam bloco. A carga da carteira chama de novo no fim.
create function public.blocos_por_grupo(p_bolso_id bigint)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int;
begin
  insert into bloco (nome, bolso_id, peso_meta, ordem)
  select g.nome, p_bolso_id, 0,
         coalesce((select max(ordem) from bloco where bolso_id = p_bolso_id), 0) + row_number() over (order by g.nome)
    from (select distinct coalesce(a.grupo, 'Outros') as nome
            from ativo a
           where a.bolso_id = p_bolso_id and a.bloco_id is null) g
   where not exists (select 1 from bloco b where b.bolso_id = p_bolso_id and b.nome = g.nome);

  update ativo a
     set bloco_id = b.id
    from bloco b
   where a.bolso_id = p_bolso_id
     and a.bloco_id is null
     and b.bolso_id = p_bolso_id
     and b.nome = coalesce(a.grupo, 'Outros');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.blocos_por_grupo(bigint) from public, anon;
grant execute on function public.blocos_por_grupo(bigint) to authenticated;

-- Satélite de hoje: um bloco por grupo.
select public.blocos_por_grupo(id) from public.bolso where tipo = 'carteira_satelite';

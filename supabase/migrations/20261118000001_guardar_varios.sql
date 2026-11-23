-- Guardar em vários bolsos de uma vez: um aporte (ou resgate) dividido entre a
-- reserva, as carteiras, a previdência e os projetos. Tudo ou nada: se um item
-- falhar, nenhum é gravado.

-- p_itens: [{"bolso_id": 3, "valor": 2000}, {"bolso_id": 4, "valor": 700}, ...]
-- Devolve quantas transferências gravou.
create function public.guardar_varios(
  p_itens jsonb,
  p_tipo  text default 'aporte',
  p_data  date default current_date
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_n    int := 0;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Nada para guardar';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    if (v_item ->> 'valor')::numeric <= 0 then
      raise exception 'Valor inválido para o bolso %', v_item ->> 'bolso_id';
    end if;
    perform guardar((v_item ->> 'valor')::numeric, (v_item ->> 'bolso_id')::bigint, p_tipo, p_data);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke execute on function public.guardar_varios(jsonb, text, date) from public, anon;
grant execute on function public.guardar_varios(jsonb, text, date) to authenticated;

-- SplitLens: "Convert to one currency" for a group.
-- Each converted currency becomes two exact-split expenses (computed in lib/splits/convert):
-- one that clears the old currency's balances and one that adds the converted amounts in the
-- target. Both go through save_expense, so every integrity check and the activity log still
-- apply, and they're written in one transaction: all conversions happen or none do.

create or replace function public.convert_group_currencies(p_group_id uuid, p_expenses jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_ids uuid[] := '{}';
  x jsonb;
begin
  if not private.is_group_member(p_group_id) then perform private.fail('You are not a member of this group.'); end if;
  if jsonb_typeof(p_expenses) <> 'array' or jsonb_array_length(p_expenses) = 0 then
    perform private.fail('Nothing to convert.');
  end if;
  for x in select * from jsonb_array_elements(p_expenses) loop
    if (x ->> 'group_id')::uuid is distinct from p_group_id or x ? 'id' or x ->> 'category' <> 'conversion' then
      perform private.fail('Invalid conversion.');
    end if;
    v_ids := v_ids || public.save_expense(x);
  end loop;
  return v_ids;
end;
$$;

revoke all on function public.convert_group_currencies(uuid, jsonb) from public, anon;
grant execute on function public.convert_group_currencies(uuid, jsonb) to authenticated;

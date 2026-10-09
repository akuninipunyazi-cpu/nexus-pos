-- Supabase may grant EXECUTE to anon via default privileges. Revoke it
-- explicitly from platform subscription SECURITY DEFINER RPCs.

revoke all on function public.create_tenant_with_owner(
  uuid, text, text, text, text, text, numeric, text, timestamptz, timestamptz
) from public, anon;
grant execute on function public.create_tenant_with_owner(
  uuid, text, text, text, text, text, numeric, text, timestamptz, timestamptz
) to authenticated;

revoke all on function public.create_tenant_with_owner_plan(
  uuid, text, text, text, text, uuid, timestamptz, boolean
) from public, anon;
grant execute on function public.create_tenant_with_owner_plan(
  uuid, text, text, text, text, uuid, timestamptz, boolean
) to authenticated;

revoke all on function public.assign_tenant_subscription(
  uuid, uuid, text, timestamptz
) from public, anon;
grant execute on function public.assign_tenant_subscription(
  uuid, uuid, text, timestamptz
) to authenticated;

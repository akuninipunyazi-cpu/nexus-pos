create or replace function public.create_tenant_with_owner(
  p_owner_user_id uuid,
  p_owner_email text,
  p_owner_name text,
  p_store_name text,
  p_slug text,
  p_plan_name text,
  p_amount numeric,
  p_currency text,
  p_started_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  insert into public.tenants (name, slug)
  values (p_store_name, p_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, email)
  values (p_owner_user_id, v_tenant_id, 'STORE_OWNER', p_owner_name, p_owner_email);

  insert into public.subscriptions (
    tenant_id, plan_name, amount, currency, started_at, expires_at, status, created_by
  ) values (
    v_tenant_id,
    p_plan_name,
    p_amount,
    upper(p_currency),
    p_started_at,
    p_expires_at,
    case
      when p_expires_at <= now() then 'EXPIRED'::public.subscription_status
      when p_expires_at <= now() + interval '30 days' then 'EXPIRING_SOON'::public.subscription_status
      else 'ACTIVE'::public.subscription_status
    end,
    auth.uid()
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_owner(uuid, text, text, text, text, text, numeric, text, timestamptz, timestamptz) from public;
grant execute on function public.create_tenant_with_owner(uuid, text, text, text, text, text, numeric, text, timestamptz, timestamptz) to authenticated;

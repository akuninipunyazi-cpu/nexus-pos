-- Supabase RPC execution can remain reachable through the API role chain even
-- after explicit grants are revoked. Keep the grants narrow and enforce the
-- authenticated boundary inside each helper as a defense-in-depth guarantee.
create or replace function public.current_profile_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not authenticated';
  end if;
  return (select role from public.profiles where id = auth.uid());
end;
$$;

create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not authenticated';
  end if;
  return (select tenant_id from public.profiles where id = auth.uid());
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not authenticated';
  end if;
  return exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN');
end;
$$;

revoke execute on function public.current_profile_role() from public, anon;
revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
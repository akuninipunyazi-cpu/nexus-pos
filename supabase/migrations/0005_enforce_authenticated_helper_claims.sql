-- An API-key-only anonymous request may expose a NULL auth.role() claim.
-- Coalesce the claim and require a non-null authenticated user ID so NULL
-- cannot bypass the helper boundary through SQL three-valued logic.
create or replace function public.current_profile_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
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
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
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
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN');
end;
$$;
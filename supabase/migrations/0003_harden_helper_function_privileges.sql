-- Helper RPCs are only callable by authenticated sessions.
-- The explicit anon revoke is intentional even though the foundation migration
-- also revokes PUBLIC, because Supabase role grants must be unambiguous here.
revoke execute on function public.current_profile_role() from anon;
revoke execute on function public.current_tenant_id() from anon;
revoke execute on function public.is_platform_admin() from anon;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
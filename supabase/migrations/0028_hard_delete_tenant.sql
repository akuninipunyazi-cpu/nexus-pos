-- Permanently remove exactly one tenant and its tenant-owned application data.
-- Auth identities are deleted afterward by a server-only admin operation;
-- pending identities stay in an internal cleanup queue until confirmed gone.

create table public.tenant_auth_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_name text not null,
  tenant_slug text not null,
  pending_auth_user_ids uuid[] not null check (cardinality(pending_auth_user_ids) > 0),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.tenant_auth_cleanup_jobs enable row level security;
revoke all on public.tenant_auth_cleanup_jobs from public, anon, authenticated;

-- Force tenant removal through the transactional, role-checked RPC below.
revoke delete on public.tenants from public, anon, authenticated;

create or replace function public.delete_tenant_data(
  p_tenant_id uuid,
  p_confirmed_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_auth_user_ids uuid[];
  v_cleanup_job_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_tenant_id is null or p_confirmed_slug is null then
    raise exception 'tenant confirmation required';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;
  if not found then raise exception 'tenant not found'; end if;
  if p_confirmed_slug <> v_tenant.slug then
    raise exception 'tenant confirmation does not match';
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_auth_user_ids
  from public.profiles p
  where p.tenant_id = p_tenant_id;

  if cardinality(v_auth_user_ids) > 0 then
    insert into public.tenant_auth_cleanup_jobs(
      tenant_name, tenant_slug, pending_auth_user_ids, requested_by
    ) values (
      v_tenant.name, v_tenant.slug, v_auth_user_ids, auth.uid()
    ) returning id into v_cleanup_job_id;
  end if;

  -- Remove dependent records first. Every predicate is scoped to this tenant;
  -- global subscription plans and all other tenants are deliberately retained.
  delete from public.inventory_receipt_items where tenant_id = p_tenant_id;
  delete from public.inventory_movements where tenant_id = p_tenant_id;
  delete from public.inventory_consumption where tenant_id = p_tenant_id;
  delete from public.supplier_inventory_items where tenant_id = p_tenant_id;
  delete from public.purchase_order_items where tenant_id = p_tenant_id;
  delete from public.inventory_receipts where tenant_id = p_tenant_id;
  delete from public.purchase_orders where tenant_id = p_tenant_id;
  delete from public.purchase_request_items where tenant_id = p_tenant_id;
  delete from public.purchase_requests where tenant_id = p_tenant_id;
  delete from public.recipe_items where tenant_id = p_tenant_id;
  delete from public.recipes where tenant_id = p_tenant_id;
  delete from public.payments where tenant_id = p_tenant_id;
  delete from public.order_items where tenant_id = p_tenant_id;
  delete from public.orders where tenant_id = p_tenant_id;
  delete from public.products where tenant_id = p_tenant_id;
  delete from public.categories where tenant_id = p_tenant_id;
  delete from public.tables where tenant_id = p_tenant_id;
  delete from public.inventory_items where tenant_id = p_tenant_id;
  delete from public.suppliers where tenant_id = p_tenant_id;
  delete from public.subscription_revenue_records where tenant_id = p_tenant_id;
  delete from public.subscriptions where tenant_id = p_tenant_id;
  delete from public.notifications where tenant_id = p_tenant_id;
  delete from public.audit_logs
  where tenant_id = p_tenant_id
     or (entity_type = 'TENANT' and entity_id = p_tenant_id);
  delete from public.profiles where tenant_id = p_tenant_id;
  delete from public.tenants where id = p_tenant_id;

  return jsonb_build_object(
    'cleanup_job_id', v_cleanup_job_id,
    'login_account_count', cardinality(v_auth_user_ids)
  );
end;
$$;

create or replace function public.list_tenant_auth_cleanup_jobs()
returns table (
  job_id uuid,
  tenant_name text,
  tenant_slug text,
  pending_accounts integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select j.id, j.tenant_name, j.tenant_slug,
         cardinality(j.pending_auth_user_ids), j.created_at
  from public.tenant_auth_cleanup_jobs j
  order by j.created_at asc;
end;
$$;

create or replace function public.ack_tenant_auth_cleanup_user(
  p_job_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending uuid[];
  v_remaining uuid[];
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_job_id is null or p_user_id is null then
    raise exception 'cleanup reference required';
  end if;

  select pending_auth_user_ids into v_pending
  from public.tenant_auth_cleanup_jobs
  where id = p_job_id
  for update;
  if not found then return false; end if;
  if not (p_user_id = any(v_pending)) then return false; end if;

  v_remaining := array_remove(v_pending, p_user_id);
  if cardinality(v_remaining) = 0 then
    delete from public.tenant_auth_cleanup_jobs where id = p_job_id;
  else
    update public.tenant_auth_cleanup_jobs
    set pending_auth_user_ids = v_remaining
    where id = p_job_id;
  end if;
  return true;
end;
$$;

revoke all on function public.delete_tenant_data(uuid, text) from public, anon;
grant execute on function public.delete_tenant_data(uuid, text) to authenticated;
revoke all on function public.list_tenant_auth_cleanup_jobs() from public, anon;
grant execute on function public.list_tenant_auth_cleanup_jobs() to authenticated;
revoke all on function public.ack_tenant_auth_cleanup_user(uuid, uuid) from public, anon;
grant execute on function public.ack_tenant_auth_cleanup_user(uuid, uuid) to authenticated;

comment on table public.tenant_auth_cleanup_jobs is
  'Temporary server-only queue for deleting Supabase Auth identities after their tenant database records have been transactionally removed.';
comment on function public.delete_tenant_data(uuid, text) is
  'Super Admin only. Atomically purges one tenant and its scoped business data, preserving unrelated tenants and queuing only that tenant profile Auth IDs for server-side deletion.';

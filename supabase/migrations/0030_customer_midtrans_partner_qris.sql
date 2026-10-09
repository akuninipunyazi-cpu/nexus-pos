-- Phase 9.2: per-tenant Midtrans Partner merchant identity and customer QRIS.
-- Customer attempts are separate from Phase 9.1 subscription_orders.

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  provider text not null default 'MIDTRANS_PARTNER' check (provider = 'MIDTRANS_PARTNER'),
  provider_merchant_id text unique,
  merchant_name text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SUBMITTED', 'ACTIVE', 'REJECTED', 'SUSPENDED')),
  onboarding_started_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'PENDING' and provider_merchant_id is null)
      or (status <> 'PENDING' and provider_merchant_id is not null))
);

create table public.order_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null default 'MIDTRANS_PARTNER' check (provider = 'MIDTRANS_PARTNER'),
  provider_order_id text not null unique check (char_length(provider_order_id) between 1 and 50),
  provider_transaction_id text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id, attempt_number),
  foreign key (tenant_id, order_id) references public.orders(tenant_id, id) on delete cascade
);

create unique index order_payment_attempts_transaction_unique
  on public.order_payment_attempts(provider_transaction_id)
  where provider_transaction_id is not null;
create index order_payment_attempts_tenant_order_created_idx
  on public.order_payment_attempts(tenant_id, order_id, created_at desc);
create index order_payment_attempts_status_expiry_idx
  on public.order_payment_attempts(status, expires_at);

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED'));

alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists idempotency_fingerprint text;
create unique index if not exists customer_order_idempotency_key_unique
  on public.orders(tenant_id, idempotency_key)
  where source = 'CUSTOMER' and idempotency_key is not null;

alter table public.payment_accounts enable row level security;
alter table public.order_payment_attempts enable row level security;

revoke all on public.payment_accounts, public.order_payment_attempts from anon, authenticated;
grant select on public.payment_accounts to authenticated;

create policy "store owners read own Midtrans account"
on public.payment_accounts for select to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER');
create policy "platform admins read Midtrans accounts"
on public.payment_accounts for select to authenticated
using (public.is_platform_admin());

-- The browser can only reach customer payments through the public order RPCs.
-- Account creation and all payment mutations are performed by authorized
-- server actions or service-role-only functions.

drop function public.create_public_order(text, text, jsonb, text);
create function public.create_public_order(
  p_tenant_slug text,
  p_table_public_token text,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_table_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_access_token text;
  v_method text := upper(trim(p_payment_method));
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit_price numeric(14,2);
  v_quantity integer;
  v_note text;
  v_total numeric(14,2) := 0;
  v_item_count integer := 0;
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_fingerprint text;
  v_old_fingerprint text;
  v_existing_payment_status text;
  v_existing_order_status text;
begin
  if v_method not in ('CASH', 'QRIS') then raise exception 'invalid payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid order items'; end if;
  if char_length(v_key) < 8 or char_length(v_key) > 200 then raise exception 'invalid idempotency key'; end if;

  select t.id, tb.id into v_tenant_id, v_table_id
    from public.tenants t
    join public.tables tb on tb.tenant_id = t.id
   where t.slug = p_tenant_slug and t.status = 'ACTIVE'
     and tb.public_token = p_table_public_token and tb.status = 'ACTIVE';
  if v_tenant_id is null then raise exception 'table not available'; end if;
  v_fingerprint := encode(digest(v_tenant_id::text || '|' || v_table_id::text || '|' || p_items::text || '|' || v_method, 'sha256'), 'hex');
  select id, order_number, customer_access_token, total, payment_status, order_status, idempotency_fingerprint
    into v_order_id, v_order_number, v_access_token, v_total, v_existing_payment_status, v_existing_order_status, v_old_fingerprint
    from public.orders where tenant_id = v_tenant_id and source = 'CUSTOMER' and idempotency_key = v_key;
  if found then
    if v_old_fingerprint <> v_fingerprint then raise exception 'idempotency key payload conflict'; end if;
    return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number,
      'customer_access_token', v_access_token, 'payment_method', upper(trim(p_payment_method)),
      'payment_status', v_existing_payment_status, 'order_status', v_existing_order_status, 'total', v_total, 'idempotent', true);
  end if;
  if v_method = 'QRIS' and not exists (
    select 1 from public.payment_accounts pa
     where pa.tenant_id = v_tenant_id and pa.provider = 'MIDTRANS_PARTNER' and pa.status = 'ACTIVE'
  ) then raise exception 'QRIS is not currently available'; end if;

  insert into public.orders (tenant_id, table_id, order_type, source, order_status, payment_status, idempotency_key, idempotency_fingerprint)
  values (v_tenant_id, v_table_id, 'DINE_IN', 'CUSTOMER', 'PENDING_PAYMENT', 'PENDING', v_key, v_fingerprint)
  returning id, order_number, customer_access_token into v_order_id, v_order_number, v_access_token;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when invalid_text_representation then raise exception 'invalid order item'; end;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then raise exception 'invalid quantity'; end if;
    select p.name, p.price into v_product_name, v_unit_price
      from public.products p
      join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
     where p.id = v_product_id and p.tenant_id = v_tenant_id and p.is_active and c.is_active;
    if v_product_name is null then raise exception 'product unavailable'; end if;
    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
    insert into public.order_items (tenant_id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total, notes)
    values (v_tenant_id, v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_unit_price * v_quantity, v_note);
    v_total := v_total + v_unit_price * v_quantity;
    v_item_count := v_item_count + 1;
  end loop;
  if v_item_count = 0 then raise exception 'order cannot be empty'; end if;
  update public.orders set total = v_total, updated_at = now() where id = v_order_id;
  insert into public.payments (tenant_id, order_id, method, status, provider)
  values (v_tenant_id, v_order_id, v_method, 'PENDING', case when v_method = 'QRIS' then 'midtrans_partner' else 'manual_cash' end);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number,
    'customer_access_token', v_access_token, 'payment_method', v_method,
    'payment_status', 'PENDING', 'order_status', 'PENDING_PAYMENT', 'total', v_total);
exception when unique_violation then
  select id, order_number, customer_access_token, total, payment_status, order_status, idempotency_fingerprint
    into v_order_id, v_order_number, v_access_token, v_total, v_existing_payment_status, v_existing_order_status, v_old_fingerprint
    from public.orders where tenant_id = v_tenant_id and source = 'CUSTOMER' and idempotency_key = v_key;
  if not found then raise exception 'order could not be created'; end if;
  if v_old_fingerprint <> v_fingerprint then raise exception 'idempotency key payload conflict'; end if;
  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number,
    'customer_access_token', v_access_token, 'payment_method', upper(trim(p_payment_method)),
    'payment_status', v_existing_payment_status, 'order_status', v_existing_order_status, 'total', v_total, 'idempotent', true);
end;
$$;
revoke all on function public.create_public_order(text, text, jsonb, text, text) from public, authenticated;
grant execute on function public.create_public_order(text, text, jsonb, text, text) to anon;

create or replace function public.get_public_table_context(p_tenant_slug text, p_public_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug),
    'table', jsonb_build_object('table_number', tb.table_number, 'public_token', tb.public_token),
    'qris_available', exists(select 1 from public.payment_accounts pa where pa.tenant_id = t.id and pa.provider = 'MIDTRANS_PARTNER' and pa.status = 'ACTIVE'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name) order by c.name) from public.categories c where c.tenant_id = t.id and c.is_active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price', p.price, 'image_url', p.image_url, 'category', c.name) order by c.name, p.name)
      from public.products p join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
     where p.tenant_id = t.id and p.is_active and c.is_active), '[]'::jsonb)
  ) into result
  from public.tables tb join public.tenants t on t.id = tb.tenant_id
  where t.slug = p_tenant_slug and t.status = 'ACTIVE' and tb.public_token = p_public_token and tb.status = 'ACTIVE';
  if result is null then raise exception 'public table not found'; end if;
  return result;
end; $$;
revoke all on function public.get_public_table_context(text, text) from public;
grant execute on function public.get_public_table_context(text, text) to anon, authenticated;

create or replace function public.reserve_public_qris_attempt(
  p_tenant_slug text, p_table_public_token text, p_order_id uuid, p_customer_access_token text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_account public.payment_accounts%rowtype;
  v_attempt public.order_payment_attempts%rowtype;
  v_attempt_number integer;
  v_created boolean := false;
begin
  select t.id into v_tenant_id
    from public.tenants t join public.tables tb on tb.tenant_id = t.id
   where t.slug = p_tenant_slug and t.status = 'ACTIVE'
     and tb.public_token = p_table_public_token and tb.status = 'ACTIVE';
  if v_tenant_id is null then raise exception 'payment request unavailable'; end if;
  select * into v_order from public.orders o
   where o.id = p_order_id and o.tenant_id = v_tenant_id
     and o.customer_access_token = p_customer_access_token and o.source = 'CUSTOMER'
   for update;
  if not found then raise exception 'payment request unavailable'; end if;
  select * into v_payment from public.payments p where p.tenant_id = v_tenant_id and p.order_id = p_order_id for update;
  if not found or v_payment.method <> 'QRIS' or v_payment.provider <> 'midtrans_partner' then raise exception 'payment request unavailable'; end if;
  if v_payment.status = 'PAID' or v_order.payment_status = 'PAID' then
    return jsonb_build_object('status', 'PAID');
  end if;
  if v_order.order_status <> 'PENDING_PAYMENT' or v_order.payment_status = 'CANCELLED' then raise exception 'order is no longer payable'; end if;
  select * into v_account from public.payment_accounts pa where pa.tenant_id = v_tenant_id and pa.provider = 'MIDTRANS_PARTNER' and pa.status = 'ACTIVE';
  if not found then raise exception 'QRIS is not currently available'; end if;
  if v_order.total <= 0 or v_order.total <> trunc(v_order.total) then raise exception 'QRIS requires a positive whole-IDR order total'; end if;

  select * into v_attempt from public.order_payment_attempts a
   where a.tenant_id = v_tenant_id and a.order_id = p_order_id and a.status = 'PENDING'
   order by a.attempt_number desc limit 1;
  if found then
    return jsonb_build_object('status', v_attempt.status, 'attempt_id', v_attempt.id,
      'provider_order_id', v_attempt.provider_order_id, 'amount', v_attempt.amount,
      'merchant_id', v_account.provider_merchant_id, 'checkout_url', v_attempt.checkout_url,
      'expires_at', v_attempt.expires_at, 'created', false,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', oi.product_id, 'name', left(oi.product_name_snapshot, 50), 'price', oi.unit_price_snapshot, 'quantity', oi.quantity)), '[]'::jsonb) from public.order_items oi where oi.tenant_id = v_tenant_id and oi.order_id = p_order_id));
  end if;

  select coalesce(max(a.attempt_number), 0) + 1 into v_attempt_number
    from public.order_payment_attempts a where a.tenant_id = v_tenant_id and a.order_id = p_order_id;
  insert into public.order_payment_attempts (tenant_id, order_id, attempt_number, provider_order_id, amount, currency, status)
  values (v_tenant_id, p_order_id, v_attempt_number, 'poscafe-' || replace(gen_random_uuid()::text, '-', ''), v_order.total, 'IDR', 'PENDING')
  returning * into v_attempt;
  update public.payments set status = 'PENDING', provider = 'midtrans_partner', provider_payment_id = null, paid_at = null, updated_at = now()
   where tenant_id = v_tenant_id and order_id = p_order_id;
  update public.orders set payment_status = 'PENDING', updated_at = now()
   where tenant_id = v_tenant_id and id = p_order_id;
  v_created := true;
  return jsonb_build_object('status', v_attempt.status, 'attempt_id', v_attempt.id,
    'provider_order_id', v_attempt.provider_order_id, 'amount', v_attempt.amount,
    'merchant_id', v_account.provider_merchant_id, 'checkout_url', null,
    'expires_at', null, 'created', v_created,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', oi.product_id, 'name', left(oi.product_name_snapshot, 50), 'price', oi.unit_price_snapshot, 'quantity', oi.quantity)), '[]'::jsonb) from public.order_items oi where oi.tenant_id = v_tenant_id and oi.order_id = p_order_id));
end; $$;
revoke all on function public.reserve_public_qris_attempt(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_public_qris_attempt(text, text, uuid, text) to service_role;

create or replace function public.persist_public_qris_checkout(
  p_attempt_id uuid, p_provider_order_id text, p_checkout_url text, p_expires_at timestamptz
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.order_payment_attempts
     set checkout_url = p_checkout_url, expires_at = p_expires_at, updated_at = now()
   where id = p_attempt_id and provider_order_id = p_provider_order_id and status = 'PENDING';
  if not found then raise exception 'payment attempt changed'; end if;
end; $$;
revoke all on function public.persist_public_qris_checkout(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.persist_public_qris_checkout(uuid, text, text, timestamptz) to service_role;

create or replace function public.fail_public_qris_checkout(p_attempt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_attempt public.order_payment_attempts%rowtype;
begin
  select * into v_attempt from public.order_payment_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'PENDING' or v_attempt.checkout_url is not null then return; end if;
  update public.order_payment_attempts set status = 'FAILED', failure_reason = left(coalesce(p_reason, 'Midtrans rejected checkout.'), 120), updated_at = now() where id = v_attempt.id;
  update public.payments set status = 'FAILED', updated_at = now() where tenant_id = v_attempt.tenant_id and order_id = v_attempt.order_id and status = 'PENDING';
  update public.orders set payment_status = 'FAILED', updated_at = now() where tenant_id = v_attempt.tenant_id and id = v_attempt.order_id and order_status = 'PENDING_PAYMENT';
end; $$;
revoke all on function public.fail_public_qris_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_public_qris_checkout(uuid, text) to service_role;

create or replace function public.apply_midtrans_partner_notification(
  p_provider_order_id text, p_provider_transaction_id text, p_provider_status text,
  p_gross_amount text, p_currency text, p_partner_id text, p_merchant_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.order_payment_attempts%rowtype;
  v_account public.payment_accounts%rowtype;
  v_order public.orders%rowtype;
  v_amount numeric;
  v_next text;
  v_changed boolean := false;
begin
  if p_provider_status not in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED') then
    return jsonb_build_object('accepted', true, 'ignored', true);
  end if;
  if p_currency <> 'IDR' or p_provider_order_id is null or p_merchant_id is null then raise exception 'invalid notification'; end if;
  begin v_amount := p_gross_amount::numeric; exception when others then raise exception 'invalid notification'; end;
  select * into v_attempt from public.order_payment_attempts a where a.provider_order_id = p_provider_order_id for update;
  if not found then raise exception 'transaction not found'; end if;
  select * into v_account from public.payment_accounts pa where pa.tenant_id = v_attempt.tenant_id for update;
  if not found or v_account.provider <> 'MIDTRANS_PARTNER' or v_account.provider_merchant_id <> p_merchant_id then raise exception 'merchant mismatch'; end if;
  if v_attempt.amount <> v_amount or v_attempt.currency <> p_currency then raise exception 'amount mismatch'; end if;
  if not exists(select 1 from public.order_payment_attempts where id = v_attempt.id and provider = 'MIDTRANS_PARTNER') then raise exception 'provider mismatch'; end if;
  select * into v_order from public.orders o where o.id = v_attempt.order_id and o.tenant_id = v_attempt.tenant_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_provider_status = 'PAID' then v_next := 'PAID';
  elsif v_attempt.status = 'PENDING' then v_next := p_provider_status;
  else v_next := v_attempt.status;
  end if;
  if v_attempt.status = 'PAID' then return jsonb_build_object('accepted', true, 'idempotent', true, 'order_id', v_order.id, 'tenant_id', v_order.tenant_id); end if;
  if v_next = 'PAID' then
    update public.order_payment_attempts set status = 'PAID', provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id), paid_at = coalesce(paid_at, now()), updated_at = now() where id = v_attempt.id;
    update public.payments set status = 'PAID', provider_payment_id = coalesce(p_provider_transaction_id, provider_payment_id), paid_at = coalesce(paid_at, now()), updated_at = now() where tenant_id = v_attempt.tenant_id and order_id = v_attempt.order_id;
    update public.orders set payment_status = 'PAID', order_status = case when order_status = 'PENDING_PAYMENT' then 'QUEUED' else order_status end, updated_at = now() where tenant_id = v_attempt.tenant_id and id = v_attempt.order_id;
    v_changed := true;
  elsif v_attempt.status = 'PENDING' and v_next in ('FAILED', 'EXPIRED', 'CANCELLED') then
    update public.order_payment_attempts set status = v_next, failure_reason = left(coalesce(p_provider_status, ''), 80), updated_at = now() where id = v_attempt.id;
    update public.payments set status = v_next, updated_at = now() where tenant_id = v_attempt.tenant_id and order_id = v_attempt.order_id and status = 'PENDING';
    update public.orders set payment_status = case when v_next = 'CANCELLED' then 'CANCELLED' else 'FAILED' end, updated_at = now() where tenant_id = v_attempt.tenant_id and id = v_attempt.order_id and order_status = 'PENDING_PAYMENT';
    v_changed := true;
  end if;
  return jsonb_build_object('accepted', true, 'idempotent', not v_changed, 'order_id', v_order.id, 'tenant_id', v_order.tenant_id, 'changed', v_changed);
end; $$;
revoke all on function public.apply_midtrans_partner_notification(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_midtrans_partner_notification(text, text, text, text, text, text, text) to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'TENANT_CREATED', 'TENANT_UPDATED', 'PLAN_CREATED', 'PLAN_UPDATED',
  'SUBSCRIPTION_ASSIGNED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION_ACTIVATED',
  'PAYMENT_ACCOUNT_ACTIVATED', 'PAYMENT_ACCOUNT_SUSPENDED', 'PAYMENT_ACCOUNT_REJECTED'
));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('TENANT', 'SUBSCRIPTION_PLAN', 'SUBSCRIPTION', 'PAYMENT_ACCOUNT'));

create or replace function public.set_midtrans_partner_merchant_status(p_provider_merchant_id text, p_status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant_id uuid; v_account_id uuid; v_action text;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REJECTED') then raise exception 'invalid merchant status'; end if;
  update public.payment_accounts
     set status = p_status, activated_at = case when p_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end, updated_at = now()
   where provider = 'MIDTRANS_PARTNER' and provider_merchant_id = p_provider_merchant_id
   returning tenant_id, id into v_tenant_id, v_account_id;
  if v_tenant_id is null then raise exception 'merchant not found'; end if;
  v_action := case p_status when 'ACTIVE' then 'PAYMENT_ACCOUNT_ACTIVATED' when 'SUSPENDED' then 'PAYMENT_ACCOUNT_SUSPENDED' else 'PAYMENT_ACCOUNT_REJECTED' end;
  insert into public.audit_logs(tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata)
  values (v_tenant_id, auth.uid(), 'SUPER_ADMIN', v_action, 'PAYMENT_ACCOUNT', v_account_id,
    jsonb_build_object('provider', 'MIDTRANS_PARTNER', 'status', p_status));
  return v_tenant_id;
end; $$;
revoke all on function public.set_midtrans_partner_merchant_status(text, text) from public, anon;
grant execute on function public.set_midtrans_partner_merchant_status(text, text) to authenticated;

create or replace function public.get_public_order_status(
  p_tenant_slug text, p_table_public_token text, p_order_id uuid, p_customer_access_token text
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'table_number', tb.table_number,
    'order_status', o.order_status, 'payment_status', o.payment_status, 'total', o.total,
    'payment_method', p.method,
    'payment_attempt', (select jsonb_build_object('status', a.status, 'checkout_url', a.checkout_url, 'expires_at', a.expires_at)
      from public.order_payment_attempts a where a.tenant_id = o.tenant_id and a.order_id = o.id order by a.attempt_number desc limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.product_name_snapshot, 'quantity', oi.quantity, 'unit_price', oi.unit_price_snapshot, 'line_total', oi.line_total, 'note', oi.notes) order by oi.created_at)
      from public.order_items oi where oi.tenant_id = o.tenant_id and oi.order_id = o.id), '[]'::jsonb)
  ) into result
  from public.orders o join public.tables tb on tb.id = o.table_id and tb.tenant_id = o.tenant_id
  join public.tenants t on t.id = o.tenant_id join public.payments p on p.tenant_id = o.tenant_id and p.order_id = o.id
  where t.slug = p_tenant_slug and t.status = 'ACTIVE' and tb.public_token = p_table_public_token
    and o.id = p_order_id and o.customer_access_token = p_customer_access_token;
  if result is null then raise exception 'order not found'; end if;
  return result;
end; $$;
revoke all on function public.get_public_order_status(text, text, uuid, text) from public;
grant execute on function public.get_public_order_status(text, text, uuid, text) to anon, authenticated;

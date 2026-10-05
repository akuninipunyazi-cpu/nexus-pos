create sequence public.order_number_seq;

alter table public.tables
  add constraint tables_tenant_id_id_key unique (tenant_id, id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_number text not null unique default ('A' || lpad(nextval('public.order_number_seq')::text, 3, '0')),
  order_type text not null default 'DINE_IN' check (order_type = 'DINE_IN'),
  table_id uuid not null,
  source text not null default 'CUSTOMER' check (source = 'CUSTOMER'),
  order_status text not null default 'PENDING_PAYMENT' check (order_status in ('PENDING_PAYMENT', 'QUEUED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED')),
  payment_status text not null default 'PENDING' check (payment_status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  total numeric(14,2) not null default 0 check (total >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  customer_access_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, table_id) references public.tables(tenant_id, id) on delete restrict
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  unit_price_snapshot numeric(14,2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity > 0 and quantity <= 99),
  line_total numeric(14,2) not null check (line_total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, order_id) references public.orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  method text not null check (method in ('CASH', 'QRIS')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  provider text not null,
  provider_payment_id text,
  paid_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id),
  foreign key (tenant_id, order_id) references public.orders(tenant_id, id) on delete cascade
);

create index orders_tenant_created_idx on public.orders(tenant_id, created_at desc);
create index orders_table_idx on public.orders(tenant_id, table_id, created_at desc);
create index order_items_order_idx on public.order_items(tenant_id, order_id);
create index payments_status_idx on public.payments(tenant_id, status);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

revoke all on public.orders, public.order_items, public.payments from anon, authenticated;

create or replace function public.create_public_order(
  p_tenant_slug text,
  p_table_public_token text,
  p_items jsonb,
  p_payment_method text
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
begin
  if v_method not in ('CASH', 'QRIS') then
    raise exception 'invalid payment method';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid order items';
  end if;

  select t.id, tb.id
    into v_tenant_id, v_table_id
    from public.tenants t
    join public.tables tb on tb.tenant_id = t.id
   where t.slug = p_tenant_slug
     and t.status = 'ACTIVE'
     and tb.public_token = p_table_public_token
     and tb.status = 'ACTIVE';

  if v_tenant_id is null then
    raise exception 'table not available';
  end if;

  insert into public.orders (tenant_id, table_id, order_type, source, order_status, payment_status)
  values (v_tenant_id, v_table_id, 'DINE_IN', 'CUSTOMER', 'PENDING_PAYMENT', 'PENDING')
  returning id, order_number, customer_access_token into v_order_id, v_order_number, v_access_token;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid order item';
    end;

    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'invalid quantity';
    end if;

    select p.name, p.price
      into v_product_name, v_unit_price
      from public.products p
      join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and p.is_active
       and c.is_active;

    if v_product_name is null then
      raise exception 'product unavailable';
    end if;

    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');
    insert into public.order_items (
      tenant_id, order_id, product_id, product_name_snapshot,
      unit_price_snapshot, quantity, line_total, notes
    ) values (
      v_tenant_id, v_order_id, v_product_id, v_product_name,
      v_unit_price, v_quantity, v_unit_price * v_quantity, v_note
    );
    v_total := v_total + (v_unit_price * v_quantity);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception 'order cannot be empty';
  end if;

  update public.orders set total = v_total, updated_at = now() where id = v_order_id;

  insert into public.payments (tenant_id, order_id, method, status, provider)
  values (v_tenant_id, v_order_id, v_method, 'PENDING', case when v_method = 'QRIS' then 'mock_qris' else 'manual_cash' end);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_access_token', v_access_token,
    'payment_method', v_method,
    'payment_status', 'PENDING',
    'order_status', 'PENDING_PAYMENT',
    'total', v_total
  );
exception
  when unique_violation then
    raise exception 'order could not be created';
end;
$$;

revoke all on function public.create_public_order(text, text, jsonb, text) from public;
grant execute on function public.create_public_order(text, text, jsonb, text) to anon, authenticated;

create or replace function public.get_public_order_status(
  p_tenant_slug text,
  p_table_public_token text,
  p_order_id uuid,
  p_customer_access_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'table_number', tb.table_number,
    'order_status', o.order_status,
    'payment_status', o.payment_status,
    'total', o.total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.product_name_snapshot,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price_snapshot,
        'line_total', oi.line_total,
        'note', oi.notes
      ) order by oi.created_at)
      from public.order_items oi
      where oi.tenant_id = o.tenant_id and oi.order_id = o.id
    ), '[]'::jsonb)
  ) into result
  from public.orders o
  join public.tables tb on tb.id = o.table_id and tb.tenant_id = o.tenant_id
  join public.tenants t on t.id = o.tenant_id
  where t.slug = p_tenant_slug
    and t.status = 'ACTIVE'
    and tb.public_token = p_table_public_token
    and o.id = p_order_id
    and o.customer_access_token = p_customer_access_token;

  if result is null then
    raise exception 'order not found';
  end if;
  return result;
end;
$$;

revoke all on function public.get_public_order_status(text, text, uuid, text) from public;
grant execute on function public.get_public_order_status(text, text, uuid, text) to anon, authenticated;
create or replace function public.get_public_table_context(p_tenant_slug text, p_public_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug),
    'table', jsonb_build_object('table_number', tb.table_number, 'public_token', tb.public_token),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name) order by c.name) from public.categories c where c.tenant_id = t.id and c.is_active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price', p.price, 'image_url', p.image_url, 'category', c.name) order by c.name, p.name) from public.products p join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id where p.tenant_id = t.id and p.is_active and c.is_active), '[]'::jsonb)
  ) into result
  from public.tables tb join public.tenants t on t.id = tb.tenant_id
  where t.slug = p_tenant_slug and t.status = 'ACTIVE' and tb.public_token = p_public_token and tb.status = 'ACTIVE';
  if result is null then raise exception 'public table not found'; end if;
  return result;
end;
$$;
revoke all on function public.get_public_table_context(text, text) from public;
grant execute on function public.get_public_table_context(text, text) to anon, authenticated;
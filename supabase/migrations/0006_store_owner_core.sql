alter table public.profiles
  add column if not exists is_active boolean not null default true;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  price numeric(14,2) not null check (price >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_number text not null check (char_length(trim(table_number)) between 1 and 40),
  public_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  unique (tenant_id, table_number)
);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.tables enable row level security;

create policy "store owners manage tenant categories"
on public.categories for all to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER')
with check (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER');

create policy "store owners manage tenant products"
on public.products for all to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER')
with check (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER');

create policy "store owners manage tenant tables"
on public.tables for all to authenticated
using (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER')
with check (tenant_id = public.current_tenant_id() and public.current_profile_role() = 'STORE_OWNER');

create policy "store owners create tenant staff"
on public.profiles for insert to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
  and role in ('CASHIER', 'KITCHEN_ADMIN')
);

create policy "store owners manage tenant staff status"
on public.profiles for update to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
  and role in ('CASHIER', 'KITCHEN_ADMIN')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
  and role in ('CASHIER', 'KITCHEN_ADMIN')
);

create index categories_tenant_id_idx on public.categories(tenant_id);
create index products_tenant_id_idx on public.products(tenant_id);
create index products_category_id_idx on public.products(category_id);
create index tables_tenant_id_idx on public.tables(tenant_id);

create or replace function public.get_public_table_context(p_tenant_slug text, p_public_token text)
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
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug),
    'table', jsonb_build_object('table_number', tb.table_number, 'public_token', tb.public_token),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name) order by c.name)
      from public.categories c
      where c.tenant_id = t.id and c.is_active
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'description', p.description,
        'price', p.price,
        'image_url', p.image_url,
        'category', c.name
      ) order by c.name, p.name)
      from public.products p
      join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
      where p.tenant_id = t.id and p.is_active and c.is_active
    ), '[]'::jsonb)
  ) into result
  from public.tables tb
  join public.tenants t on t.id = tb.tenant_id
  where t.slug = p_tenant_slug
    and t.status = 'ACTIVE'
    and tb.public_token = p_public_token
    and tb.status = 'ACTIVE';

  if result is null then
    raise exception 'public table not found';
  end if;
  return result;
end;
$$;

revoke all on function public.get_public_table_context(text, text) from public;
grant execute on function public.get_public_table_context(text, text) to anon, authenticated;
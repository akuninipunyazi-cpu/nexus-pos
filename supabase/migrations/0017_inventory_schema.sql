create table public.inventory_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  target_stock numeric(14,3) check (target_stock is null or target_stock >= minimum_stock),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,name), unique (tenant_id,id)
);
alter table public.order_items add constraint order_items_tenant_id_id_key unique (tenant_id,id);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id uuid not null, movement_type text not null check (movement_type in ('RECEIVE','CONSUME','ADJUSTMENT_IN','ADJUSTMENT_OUT','RETURN','TRANSFER_IN','TRANSFER_OUT')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')),
  order_id uuid, order_item_id uuid, purchase_order_id uuid, receipt_id uuid, reason text, idempotency_key text,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete restrict,
  foreign key (tenant_id,order_id) references public.orders(tenant_id,id) on delete set null,
  foreign key (tenant_id,order_item_id) references public.order_items(tenant_id,id) on delete set null,
  unique (tenant_id,id)
);
create unique index inventory_movements_idempotency_unique on public.inventory_movements(tenant_id,idempotency_key) where idempotency_key is not null;
create table public.recipes (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null, is_active boolean not null default true, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,product_id), unique (tenant_id,id),
  foreign key (tenant_id,product_id) references public.products(tenant_id,id) on delete cascade
);
create table public.recipe_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipe_id uuid not null, inventory_item_id uuid not null, quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')), created_at timestamptz not null default now(),
  unique (tenant_id,recipe_id,inventory_item_id), unique (tenant_id,id),
  foreign key (tenant_id,recipe_id) references public.recipes(tenant_id,id) on delete cascade,
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete restrict
);
create table public.inventory_consumption (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null, order_item_id uuid not null, recipe_id uuid not null, inventory_item_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')), created_at timestamptz not null default now(),
  unique (tenant_id,order_item_id,inventory_item_id),
  foreign key (tenant_id,order_id) references public.orders(tenant_id,id) on delete cascade,
  foreign key (tenant_id,order_item_id) references public.order_items(tenant_id,id) on delete cascade,
  foreign key (tenant_id,recipe_id) references public.recipes(tenant_id,id) on delete restrict,
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete restrict
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160), contact_person text, phone text, email text, address text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,name), unique (tenant_id,id)
);
create table public.supplier_inventory_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null, inventory_item_id uuid not null, supplier_sku text,
  purchase_unit text not null check (purchase_unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')),
  conversion_quantity numeric(14,3) check (conversion_quantity is null or conversion_quantity > 0),
  last_known_price numeric(14,2) check (last_known_price is null or last_known_price >= 0), is_preferred boolean not null default false, created_at timestamptz not null default now(),
  unique (tenant_id,supplier_id,inventory_item_id),
  foreign key (tenant_id,supplier_id) references public.suppliers(tenant_id,id) on delete cascade,
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete cascade
);
create sequence public.purchase_request_number_seq;
create sequence public.purchase_order_number_seq;
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_number text not null unique default ('PR-'||lpad(nextval('public.purchase_request_number_seq')::text,5,'0')),
  status text not null default 'SUBMITTED' check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','FULFILLED','CANCELLED')),
  supplier_id uuid, reason text, notes text, idempotency_key text,
  created_by uuid not null references public.profiles(id) on delete restrict, approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id), foreign key (tenant_id,supplier_id) references public.suppliers(tenant_id,id) on delete set null
);
create unique index purchase_requests_idempotency_unique on public.purchase_requests(tenant_id,idempotency_key) where idempotency_key is not null;
create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null, inventory_item_id uuid not null, quantity numeric(14,3) not null check (quantity > 0), unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')), created_at timestamptz not null default now(),
  unique (tenant_id,request_id,inventory_item_id),
  foreign key (tenant_id,request_id) references public.purchase_requests(tenant_id,id) on delete cascade,
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete restrict
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  po_number text not null unique default ('PO-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0')),
  supplier_id uuid not null, request_id uuid,
  status text not null default 'PENDING_APPROVAL' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  created_by uuid not null references public.profiles(id) on delete restrict, approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), approved_at timestamptz, updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,supplier_id) references public.suppliers(tenant_id,id) on delete restrict,
  foreign key (tenant_id,request_id) references public.purchase_requests(tenant_id,id) on delete set null
);
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null, inventory_item_id uuid not null, quantity_ordered numeric(14,3) not null check (quantity_ordered > 0),
  unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')), unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0 and quantity_received <= quantity_ordered), created_at timestamptz not null default now(),
  unique (tenant_id,purchase_order_id,inventory_item_id),
  foreign key (tenant_id,purchase_order_id) references public.purchase_orders(tenant_id,id) on delete cascade,
  foreign key (tenant_id,inventory_item_id) references public.inventory_items(tenant_id,id) on delete restrict
);
alter table public.purchase_order_items add constraint purchase_order_items_tenant_id_id_key unique (tenant_id,id);
create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null, receipt_number text not null unique default ('GRN-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0')),
  idempotency_key text not null, idempotency_fingerprint text not null,
  received_by uuid not null references public.profiles(id) on delete restrict, received_at timestamptz not null default now(), notes text,
  unique (tenant_id,id), unique (tenant_id,idempotency_key),
  foreign key (tenant_id,purchase_order_id) references public.purchase_orders(tenant_id,id) on delete restrict
);
create table public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null, purchase_order_item_id uuid not null, quantity_received numeric(14,3) not null check (quantity_received > 0), unit text not null check (unit in ('gram','kilogram','milliliter','liter','piece','bottle','pack')), created_at timestamptz not null default now(),
  unique (tenant_id,receipt_id,purchase_order_item_id),
  foreign key (tenant_id,receipt_id) references public.inventory_receipts(tenant_id,id) on delete cascade,
  foreign key (tenant_id,purchase_order_item_id) references public.purchase_order_items(tenant_id,id) on delete restrict
);
create index inventory_movements_item_idx on public.inventory_movements(tenant_id,inventory_item_id,created_at desc);
create index recipes_product_idx on public.recipes(tenant_id,product_id);
create index purchase_requests_status_idx on public.purchase_requests(tenant_id,status,created_at desc);
create index purchase_orders_status_idx on public.purchase_orders(tenant_id,status,created_at desc);
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.inventory_consumption enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_inventory_items enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_items enable row level security;
grant select,insert,update,delete on public.inventory_items,public.recipes,public.recipe_items,public.suppliers,public.supplier_inventory_items to authenticated;
grant select on public.inventory_movements,public.inventory_consumption,public.purchase_orders,public.purchase_order_items,public.inventory_receipts,public.inventory_receipt_items to authenticated;
grant select,insert,update on public.purchase_requests,public.purchase_request_items to authenticated;
create policy "owners manage inventory items" on public.inventory_items for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read inventory items" on public.inventory_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners manage recipes" on public.recipes for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read recipes" on public.recipes for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners manage recipe items" on public.recipe_items for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read recipe items" on public.recipe_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners manage suppliers" on public.suppliers for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read suppliers" on public.suppliers for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners manage supplier items" on public.supplier_inventory_items for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read supplier items" on public.supplier_inventory_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "tenant read movements" on public.inventory_movements for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "tenant read consumption" on public.inventory_consumption for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "tenant read purchase requests" on public.purchase_requests for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "owner create purchase requests" on public.purchase_requests for insert to authenticated with check (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN') and created_by=auth.uid());
create policy "owner update purchase requests" on public.purchase_requests for update to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "tenant read request items" on public.purchase_request_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "request creators insert items" on public.purchase_request_items for insert to authenticated with check (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "owners manage purchase orders" on public.purchase_orders for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read purchase orders" on public.purchase_orders for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners manage purchase order items" on public.purchase_order_items for all to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER') with check (tenant_id=public.current_tenant_id() and public.current_profile_role()='STORE_OWNER');
create policy "kitchen read purchase order items" on public.purchase_order_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role()='KITCHEN_ADMIN');
create policy "owners read receipts" on public.inventory_receipts for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
create policy "owners read receipt items" on public.inventory_receipt_items for select to authenticated using (tenant_id=public.current_tenant_id() and public.current_profile_role() in ('STORE_OWNER','KITCHEN_ADMIN'));
do $$ declare t text; begin foreach t in array array['inventory_movements','purchase_requests','purchase_orders','inventory_receipts'] loop if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;end loop;end $$;

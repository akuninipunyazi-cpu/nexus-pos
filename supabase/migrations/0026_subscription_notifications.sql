-- Phase 8.5: tenant-owner in-app subscription expiry notifications.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_type text not null check (notification_type in ('SUBSCRIPTION_EXPIRING', 'SUBSCRIPTION_EXPIRED')),
  title text not null,
  message text not null,
  event_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index notifications_tenant_created_idx on public.notifications(tenant_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select, update(read_at) on public.notifications to authenticated;

create policy "store owners read their own notifications"
on public.notifications for select to authenticated
using (
  user_id = auth.uid()
  and tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
);

create policy "store owners mark their own notifications read"
on public.notifications for update to authenticated
using (
  user_id = auth.uid()
  and tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
)
with check (
  user_id = auth.uid()
  and tenant_id = public.current_tenant_id()
  and public.current_profile_role() = 'STORE_OWNER'
  and read_at is not null
);

create or replace function public.ensure_subscription_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_subscription public.subscriptions%rowtype;
  v_type text;
  v_period text;
  v_title text;
  v_message text;
  v_recipient record;
  v_created integer := 0;
  v_rows integer;
begin
  select tenant_id, role::text into v_tenant_id, v_role
  from public.profiles
  where id = auth.uid() and is_active;
  if v_role is distinct from 'STORE_OWNER' or v_tenant_id is null then
    raise exception 'not authorized';
  end if;

  select * into v_subscription
  from public.subscriptions
  where tenant_id = v_tenant_id and is_current
  order by created_at desc
  limit 1;
  if not found then return 0; end if;

  if v_subscription.expires_at <= now() then
    v_type := 'SUBSCRIPTION_EXPIRED';
    v_period := 'expired';
    v_title := 'Langganan berakhir';
    v_message := 'Langganan tenant Anda telah berakhir.';
  elsif v_subscription.expires_at <= now() + interval '1 day' then
    v_type := 'SUBSCRIPTION_EXPIRING';
    v_period := '1-day';
    v_title := 'Langganan segera berakhir';
    v_message := 'Langganan tenant Anda akan berakhir besok.';
  elsif v_subscription.expires_at <= now() + interval '7 days' then
    v_type := 'SUBSCRIPTION_EXPIRING';
    v_period := '7-day';
    v_title := 'Langganan segera berakhir';
    v_message := 'Langganan tenant Anda akan berakhir dalam 7 hari.';
  else
    return 0;
  end if;

  for v_recipient in
    select id from public.profiles
    where tenant_id = v_tenant_id and role = 'STORE_OWNER' and is_active
  loop
    insert into public.notifications(user_id, tenant_id, notification_type, title, message, event_key)
    values (
      v_recipient.id,
      v_tenant_id,
      v_type,
      v_title,
      v_message,
      format('subscription:%s:%s:%s', v_subscription.id, v_period, v_recipient.id)
    )
    on conflict (event_key) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.ensure_subscription_expiry_notifications() from public, anon;
grant execute on function public.ensure_subscription_expiry_notifications() to authenticated;

comment on column public.notifications.event_key is 'Deterministic subscription/expiry-period/recipient key prevents duplicate lazy-generated notifications.';

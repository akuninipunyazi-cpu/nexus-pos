-- Avoid redundant insert attempts during Store Owner page loads once every
-- active owner has received the deterministic expiry event. The unique key
-- and ON CONFLICT remain the concurrency-safe final guard.
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
    select p.id from public.profiles p
    where p.tenant_id = v_tenant_id and p.role = 'STORE_OWNER' and p.is_active
      and not exists (
        select 1 from public.notifications n
        where n.event_key = format('subscription:%s:%s:%s', v_subscription.id, v_period, p.id)
      )
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

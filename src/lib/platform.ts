import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionStatus, type SubscriptionStatus } from "@/lib/subscriptions";

export type PlatformSubscription = {
  id: string;
  tenant_id: string;
  plan_name: string;
  amount: number;
  currency: string;
  started_at: string;
  expires_at: string;
  status: SubscriptionStatus;
  tenant?: { name: string; slug: string } | null;
};

export async function getPlatformData() {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();

  const [{ data: tenants, error: tenantsError }, { data: subscriptions, error: subscriptionsError }, { data: revenue, error: revenueError }] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, status, created_at").order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("id, tenant_id, plan_name, amount, currency, started_at, expires_at, status").order("expires_at", { ascending: true }),
    supabase.from("subscription_revenue_records").select("id, tenant_id, subscription_id, amount, currency, recorded_at, reference").order("recorded_at", { ascending: false }),
  ]);

  if (tenantsError) throw new Error(tenantsError.message);
  if (subscriptionsError) throw new Error(subscriptionsError.message);
  if (revenueError) throw new Error(revenueError.message);

  const tenantIds = (tenants ?? []).map((tenant) => tenant.id);
  const { data: owners, error: ownersError } = tenantIds.length
    ? await supabase.from("profiles").select("tenant_id, full_name, email").eq("role", "STORE_OWNER").in("tenant_id", tenantIds)
    : { data: [], error: null };
  if (ownersError) throw new Error(ownersError.message);

  const ownerByTenant = new Map((owners ?? []).map((owner) => [owner.tenant_id, owner]));
  const tenantById = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant]));
  const normalizedSubscriptions: PlatformSubscription[] = (subscriptions ?? []).map((subscription) => ({
    ...subscription,
    amount: Number(subscription.amount),
    status: getSubscriptionStatus(subscription.expires_at),
    tenant: tenantById.get(subscription.tenant_id) ?? null,
  }));

  return {
    tenants: (tenants ?? []).map((tenant) => ({ ...tenant, owner: ownerByTenant.get(tenant.id) ?? null })),
    subscriptions: normalizedSubscriptions,
    revenue: revenue ?? [],
  };
}

export async function getPlatformOverview() {
  const data = await getPlatformData();
  const counts = data.subscriptions.reduce<Record<SubscriptionStatus, number>>((result, subscription) => {
    result[subscription.status] += 1;
    return result;
  }, { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0 });
  const recordedRevenue = data.revenue.reduce<Record<string, number>>((result, record) => {
    result[record.currency] = (result[record.currency] ?? 0) + Number(record.amount);
    return result;
  }, {});

  return { ...data, counts, recordedRevenue };
}

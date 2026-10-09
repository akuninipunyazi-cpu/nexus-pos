import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionStatus, type SubscriptionStatus } from "@/lib/subscriptions";

export type PlatformSubscription = {
  id: string;
  tenant_id: string;
  plan_id: string | null;
  is_current: boolean;
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
    supabase.from("subscriptions").select("id, tenant_id, plan_id, is_current, plan_name, amount, currency, started_at, expires_at, status").order("created_at", { ascending: false }),
    supabase.from("subscription_revenue_records").select("id, tenant_id, subscription_id, amount, currency, recorded_at, reference").order("recorded_at", { ascending: false }),
  ]);

  if (tenantsError || subscriptionsError || revenueError) {
    throw new Error("Platform data could not be loaded.");
  }

  const tenantIds = (tenants ?? []).map((tenant) => tenant.id);
  const { data: owners, error: ownersError } = tenantIds.length
    ? await supabase.from("profiles").select("tenant_id, full_name, email").eq("role", "STORE_OWNER").in("tenant_id", tenantIds)
    : { data: [], error: null };
  if (ownersError) throw new Error("Platform data could not be loaded.");

  const ownerByTenant = new Map((owners ?? []).map((owner) => [owner.tenant_id, owner]));
  const tenantById = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant]));
  const normalizedSubscriptions: PlatformSubscription[] = (subscriptions ?? []).map((subscription) => ({
    ...subscription,
    amount: Number(subscription.amount),
    status: getSubscriptionStatus(subscription.expires_at, new Date(), subscription.status),
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
  const currentSubscriptions = data.subscriptions.filter((subscription) => subscription.is_current);
  const counts = currentSubscriptions.reduce<Record<SubscriptionStatus, number>>((result, subscription) => {
    result[subscription.status] += 1;
    return result;
  }, { TRIAL: 0, ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, SUSPENDED: 0 });
  const recordedRevenue = data.revenue.reduce<Record<string, number>>((result, record) => {
    result[record.currency] = (result[record.currency] ?? 0) + Number(record.amount);
    return result;
  }, {});

  const byPlan = new Map<string, { planName: string; currency: string; subscriptions: number; value: number }>();
  for (const subscription of currentSubscriptions) {
    const key = `${subscription.plan_name}\u0000${subscription.currency}`;
    const current = byPlan.get(key) ?? { planName: subscription.plan_name, currency: subscription.currency, subscriptions: 0, value: 0 };
    current.subscriptions += 1;
    current.value += subscription.amount;
    byPlan.set(key, current);
  }
  const suspendedTenants = currentSubscriptions.filter((subscription) => subscription.status === "SUSPENDED").length;

  return {
    ...data,
    counts,
    recordedRevenue,
    platformCounts: {
      tenants: data.tenants.length,
      activeTenants: data.tenants.filter((tenant) => tenant.status === "ACTIVE").length,
      trialTenants: counts.TRIAL,
      expiredTenants: counts.EXPIRED,
      suspendedTenants,
      activeSubscriptions: counts.ACTIVE,
      expiringSoon: counts.EXPIRING_SOON,
    },
    planSummaries: [...byPlan.values()].sort((a, b) => a.planName.localeCompare(b.planName)),
  };
}

export async function getPlatformTenantDetail(tenantId: string) {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  const tenantResult = await supabase.from("tenants").select("id,name,slug,status,created_at").eq("id", tenantId).maybeSingle();
  if (tenantResult.error) throw new Error("Tenant details could not be loaded.");
  if (!tenantResult.data) return null;

  const [owners, subscriptionResult, staff, products, tables] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email,is_active").eq("tenant_id", tenantResult.data.id).eq("role", "STORE_OWNER").order("created_at").limit(1),
    supabase.from("subscriptions").select("id,plan_id,plan_name,amount,currency,started_at,expires_at,status,is_current,plan:subscription_plans(name,code,max_staff,max_products,max_tables)").eq("tenant_id", tenantResult.data.id).eq("is_current", true).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantResult.data.id).in("role", ["CASHIER", "KITCHEN_ADMIN"]).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantResult.data.id).eq("is_active", true),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("tenant_id", tenantResult.data.id).eq("status", "ACTIVE"),
  ]);
  if (owners.error || subscriptionResult.error || staff.error || products.error || tables.error) throw new Error("Tenant details could not be loaded.");

  return {
    tenant: tenantResult.data,
    owner: owners.data?.[0] ?? null,
    subscription: subscriptionResult.data ? {
      ...subscriptionResult.data,
      amount: Number(subscriptionResult.data.amount),
      status: getSubscriptionStatus(subscriptionResult.data.expires_at, new Date(), subscriptionResult.data.status),
    } : null,
    usage: { staff: staff.count ?? 0, products: products.count ?? 0, tables: tables.count ?? 0 },
  };
}

export type PlatformAuditFilter = { tenantId?: string; action?: string; from?: string; to?: string };

export async function getPlatformAuditLogs(filter: PlatformAuditFilter = {}) {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  let query = supabase.from("audit_logs").select("id,tenant_id,actor_user_id,actor_role,action,entity_type,entity_id,metadata,created_at").order("created_at", { ascending: false }).limit(100);
  if (filter.tenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filter.tenantId)) query = query.eq("tenant_id", filter.tenantId);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) query = query.gte("created_at", new Date(`${filter.from}T00:00:00+07:00`).toISOString());
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) {
    const end = new Date(`${filter.to}T00:00:00+07:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  const { data: logs, error } = await query;
  if (error) throw new Error("Audit history could not be loaded.");

  const actorIds = [...new Set((logs ?? []).flatMap((log) => log.actor_user_id ? [log.actor_user_id] : []))];
  const tenantIds = [...new Set((logs ?? []).flatMap((log) => log.tenant_id ? [log.tenant_id] : []))];
  const [actors, tenants] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id,full_name,email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
    tenantIds.length ? supabase.from("tenants").select("id,name,slug").in("id", tenantIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (actors.error || tenants.error) throw new Error("Audit history could not be loaded.");
  const actorMap = new Map((actors.data ?? []).map((actor) => [actor.id, actor]));
  const tenantMap = new Map((tenants.data ?? []).map((tenant) => [tenant.id, tenant]));
  return (logs ?? []).map((log) => ({ ...log, actor: log.actor_user_id ? actorMap.get(log.actor_user_id) ?? null : null, tenant: log.tenant_id ? tenantMap.get(log.tenant_id) ?? null : null }));
}

export async function getPlatformTenantChoices() {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("tenants").select("id,name,slug").order("name");
  if (error) throw new Error("Tenant filters could not be loaded.");
  return data ?? [];
}

export async function getPlatformPlans() {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plans").select("id,name,code,price,currency,duration_days,max_staff,max_products,max_tables,is_active,created_at,updated_at").order("name");
  if (error) throw new Error("Subscription plans could not be loaded.");
  return data ?? [];
}

export async function getPendingTenantAuthCleanupJobs() {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_tenant_auth_cleanup_jobs");
  if (error) {
    // Keep the platform tenant list usable while the tenant-deletion
    // migration is still pending in an environment.
    if (["PGRST202", "42883", "42P01"].includes(error.code ?? "")) {
      return { available: false as const, jobs: [] };
    }
    throw new Error("Pending tenant account cleanup could not be loaded.");
  }
  return {
    available: true as const,
    jobs: (data ?? []) as Array<{
      job_id: string;
      tenant_name: string;
      tenant_slug: string;
      pending_accounts: number;
      created_at: string;
    }>,
  };
}

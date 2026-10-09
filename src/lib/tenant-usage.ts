import { requireRole } from "@/lib/auth";
import { getSubscriptionStatus, type SubscriptionStatus } from "@/lib/subscriptions";
import { createClient } from "@/lib/supabase/server";

export type TenantUsageSummary = {
  planName: string | null;
  planCode: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  expiresAt: string | null;
  usage: { staff: number; products: number; tables: number };
  limits: { staff: number | null; products: number | null; tables: number | null };
};

export async function getTenantUsageSummary(): Promise<TenantUsageSummary> {
  const context = await requireRole(["STORE_OWNER"]);
  const tenantId = context.profile.tenant_id;
  if (!tenantId) throw new Error("Store Owner is not attached to a tenant.");
  const supabase = await createClient();

  const [subscription, staff, products, tables] = await Promise.all([
    supabase.from("subscriptions").select("plan_name,status,expires_at,plan:subscription_plans(code,max_staff,max_products,max_tables)").eq("tenant_id", tenantId).eq("is_current", true).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("role", ["CASHIER", "KITCHEN_ADMIN"]).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "ACTIVE"),
  ]);

  if (subscription.error || staff.error || products.error || tables.error) {
    throw new Error("Subscription usage could not be loaded.");
  }

  const rawPlan = subscription.data?.plan;
  const plan = (Array.isArray(rawPlan) ? rawPlan[0] : rawPlan) as { code: string; max_staff: number | null; max_products: number | null; max_tables: number | null } | null | undefined;
  return {
    planName: subscription.data?.plan_name ?? null,
    planCode: plan?.code ?? null,
    subscriptionStatus: subscription.data ? getSubscriptionStatus(subscription.data.expires_at, new Date(), subscription.data.status) : null,
    expiresAt: subscription.data?.expires_at ?? null,
    usage: { staff: staff.count ?? 0, products: products.count ?? 0, tables: tables.count ?? 0 },
    limits: { staff: plan?.max_staff ?? null, products: plan?.max_products ?? null, tables: plan?.max_tables ?? null },
  };
}

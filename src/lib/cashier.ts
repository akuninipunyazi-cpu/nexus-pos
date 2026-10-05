import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function requireCashier() {
  const context = await requireRole(["CASHIER"]);
  if (!context.profile.tenant_id) throw new Error("Your account is not attached to a tenant.");
  return { context, tenantId: context.profile.tenant_id };
}

export type CashierOrder = {
  id: string; order_number: string; order_type: string; source: string; order_status: string;
  payment_status: string; total: string | number; table_id: string | null; created_at: string;
  table_number: string | null; payment_method: string | null; payment_provider: string | null;
  items: { product_name_snapshot: string; quantity: number; unit_price_snapshot: string | number; line_total: string | number; notes: string | null }[];
};

export async function getCashierOrders() {
  const { tenantId } = await requireCashier();
  const supabase = await createClient();
  const result = await supabase.from("orders").select("id,order_number,order_type,source,order_status,payment_status,total,table_id,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
  const orders = result.data ?? [];
  const ids = orders.map((order) => order.id);
  const [itemsResult, paymentsResult, tablesResult] = await Promise.all([
    ids.length ? supabase.from("order_items").select("order_id,product_name_snapshot,quantity,unit_price_snapshot,line_total,notes").eq("tenant_id", tenantId).in("order_id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("payments").select("order_id,method,provider,status").eq("tenant_id", tenantId).in("order_id", ids) : Promise.resolve({ data: [] as never[] }),
    supabase.from("tables").select("id,table_number").eq("tenant_id", tenantId),
  ]);
  const tableById = new Map((tablesResult.data ?? []).map((table) => [table.id, table.table_number]));
  const itemsByOrder = new Map<string, CashierOrder["items"]>();
  for (const item of itemsResult.data ?? []) { const current = itemsByOrder.get(item.order_id) ?? []; current.push(item); itemsByOrder.set(item.order_id, current); }
  const paymentByOrder = new Map((paymentsResult.data ?? []).map((payment) => [payment.order_id, payment]));
  return orders.map((order) => ({ ...order, table_number: order.table_id ? tableById.get(order.table_id) ?? null : null, payment_method: paymentByOrder.get(order.id)?.method ?? null, payment_provider: paymentByOrder.get(order.id)?.provider ?? null, items: itemsByOrder.get(order.id) ?? [] })) as CashierOrder[];
}
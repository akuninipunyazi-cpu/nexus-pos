import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type KitchenOrder = {
  id: string; order_number: string; order_type: "DINE_IN" | "TAKEAWAY";
  order_status: "QUEUED" | "PREPARING" | "READY"; payment_status: string;
  table_id: string | null; created_at: string; queued_at: string | null;
  preparing_at: string | null; ready_at: string | null; table_number: string | null;
  items: { product_name_snapshot: string; quantity: number; notes: string | null }[];
};

export async function requireKitchen() {
  const context = await requireRole(["KITCHEN_ADMIN"]);
  if (!context.profile.tenant_id) throw new Error("Your account is not attached to a tenant.");
  return { context, tenantId: context.profile.tenant_id };
}

export async function getKitchenOrders() {
  const { tenantId } = await requireKitchen();
  const supabase = await createClient();
  const result = await supabase.from("orders")
    .select("id,order_number,order_type,order_status,payment_status,table_id,created_at,queued_at,preparing_at,ready_at")
    .eq("tenant_id", tenantId).in("order_status", ["QUEUED", "PREPARING", "READY"])
    .order("created_at", { ascending: true }).limit(100);
  const orders = result.data ?? [];
  const ids = orders.map((order) => order.id);
  const [itemsResult, tablesResult] = await Promise.all([
    ids.length ? supabase.from("order_items").select("order_id,product_name_snapshot,quantity,notes").eq("tenant_id", tenantId).in("order_id", ids) : Promise.resolve({ data: [] as never[] }),
    supabase.from("tables").select("id,table_number").eq("tenant_id", tenantId),
  ]);
  const tableById = new Map((tablesResult.data ?? []).map((table) => [table.id, table.table_number]));
  const itemsByOrder = new Map<string, KitchenOrder["items"]>();
  for (const item of itemsResult.data ?? []) { const current = itemsByOrder.get(item.order_id) ?? []; current.push(item); itemsByOrder.set(item.order_id, current); }
  return orders.map((order) => ({ ...order, table_number: order.table_id ? tableById.get(order.table_id) ?? null : null, items: itemsByOrder.get(order.id) ?? [] })) as KitchenOrder[];
}

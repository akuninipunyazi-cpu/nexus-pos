"use server";

import { createClient } from "@/lib/supabase/server";

export type PublicOrderResult = {
  error?: string;
  data?: {
    order_id: string;
    order_number: string;
    customer_access_token: string;
    payment_method: "CASH" | "QRIS";
    payment_status: "PENDING";
    order_status: "PENDING_PAYMENT";
    total: number | string;
  };
};

function required(value: FormDataEntryValue | null, label: string) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

export async function createPublicOrder(formData: FormData): Promise<PublicOrderResult> {
  try {
    const tenantSlug = required(formData.get("tenantSlug"), "Store");
    const tableToken = required(formData.get("tableToken"), "Table");
    const paymentMethod = required(formData.get("paymentMethod"), "Payment method");
    const rawItems = required(formData.get("items"), "Cart");
    let items: unknown;
    try { items = JSON.parse(rawItems); } catch { throw new Error("Cart is invalid."); }
    if (!Array.isArray(items)) throw new Error("Cart is invalid.");

    const supabase = await createClient();
    const result = await supabase.rpc("create_public_order", {
      p_tenant_slug: tenantSlug,
      p_table_public_token: tableToken,
      p_items: items,
      p_payment_method: paymentMethod,
    });
    if (result.error || !result.data) return { error: "This order could not be created. The table or menu may no longer be available." };
    return { data: result.data as PublicOrderResult["data"] };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This order could not be created." };
  }
}

export async function getPublicOrderStatus(formData: FormData): Promise<{ error?: string; data?: Record<string, unknown> }> {
  try {
    const tenantSlug = required(formData.get("tenantSlug"), "Store");
    const tableToken = required(formData.get("tableToken"), "Table");
    const orderId = required(formData.get("orderId"), "Order");
    const accessToken = required(formData.get("accessToken"), "Order access");
    const supabase = await createClient();
    const result = await supabase.rpc("get_public_order_status", {
      p_tenant_slug: tenantSlug,
      p_table_public_token: tableToken,
      p_order_id: orderId,
      p_customer_access_token: accessToken,
    });
    if (result.error || !result.data) return { error: "Order status is unavailable." };
    return { data: result.data as Record<string, unknown> };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Order status is unavailable." };
  }
}
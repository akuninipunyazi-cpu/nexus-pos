"use server";

import { createClient } from "@/lib/supabase/server";
import { isMidtransPartnerConfigured, prepareCustomerQris } from "@/lib/midtrans-partner";

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
    checkout_url?: string;
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
    const idempotencyKey = required(formData.get("idempotencyKey"), "Order request");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new Error("Order request is invalid.");
    if (paymentMethod !== "CASH" && paymentMethod !== "QRIS") throw new Error("Payment method is invalid.");
    if (paymentMethod === "QRIS" && !isMidtransPartnerConfigured()) throw new Error("Midtrans Partner QRIS is not configured for this store yet.");
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
      p_idempotency_key: idempotencyKey,
    });
    if (result.error || !result.data) return { error: "This order could not be created. The table or menu may no longer be available." };
    const order = result.data as NonNullable<PublicOrderResult["data"]>;
    if (paymentMethod === "QRIS") {
      try {
        const payment = await prepareCustomerQris({ tenantSlug, tableToken, orderId: order.order_id, customerAccessToken: order.customer_access_token });
        if (payment.status === "PAID") return { error: "This order has already been paid.", data: order };
        return { data: { ...order, checkout_url: payment.checkoutUrl } };
      } catch {
        return { error: "Your order was created, but QRIS checkout could not be opened. Continue from the order status page.", data: order };
      }
    }
    return { data: order };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This order could not be created." };
  }
}

export async function retryPublicQrisPayment(formData: FormData): Promise<{ error?: string; status?: string; checkoutUrl?: string }> {
  try {
    const result = await prepareCustomerQris({
      tenantSlug: required(formData.get("tenantSlug"), "Store"),
      tableToken: required(formData.get("tableToken"), "Table"),
      orderId: required(formData.get("orderId"), "Order"),
      customerAccessToken: required(formData.get("accessToken"), "Order access"),
    });
    return { status: result.status, checkoutUrl: result.checkoutUrl };
  } catch {
    return { error: "QRIS checkout could not be started. Check the order status or contact the store." };
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

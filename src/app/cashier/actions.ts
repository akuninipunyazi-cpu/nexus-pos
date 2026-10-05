"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { broadcastOrderUpdate } from "@/lib/realtime";

type Result = { error?: string; success?: string; data?: Record<string, unknown> };
function value(formData: FormData, name: string) { const result = String(formData.get(name) ?? "").trim(); if (!result) throw new Error(`${name} is required.`); return result; }
function refreshCashier() { for (const path of ["/cashier/orders", "/cashier/pending-cash", "/cashier/transactions"]) revalidatePath(path); }

export async function confirmCashPayment(formData: FormData): Promise<Result> {
  await requireRole(["CASHIER"]);
  try { const supabase = await createClient(); const result = await supabase.rpc("confirm_cash_payment", { p_order_id: value(formData, "orderId") }); if (result.error) return { error: "Cash payment could not be confirmed." }; await broadcastOrderUpdate(value(formData, "orderId")); refreshCashier(); return { success: result.data?.idempotent ? "Cash was already confirmed." : "Cash payment confirmed." }; }
  catch { return { error: "Cash payment could not be confirmed." }; }
}

export async function cancelCashierOrder(formData: FormData): Promise<Result> {
  await requireRole(["CASHIER"]);
  try { const supabase = await createClient(); const result = await supabase.rpc("cancel_cashier_order", { p_order_id: value(formData, "orderId") }); if (result.error) return { error: "This order cannot be cancelled." }; refreshCashier(); return { success: "Order cancelled." }; }
  catch { return { error: "This order cannot be cancelled." }; }
}

export async function createTakeawayOrder(formData: FormData): Promise<Result> {
  await requireRole(["CASHIER"]);
  try { const items = value(formData, "items"); const paymentMethod = value(formData, "paymentMethod"); const idempotencyKey = value(formData, "idempotencyKey"); const parsed = JSON.parse(items); if (!Array.isArray(parsed)) throw new Error("Invalid items"); const supabase = await createClient(); const result = await supabase.rpc("create_cashier_takeaway", { p_items: parsed, p_payment_method: paymentMethod, p_idempotency_key: idempotencyKey }); if (result.error || !result.data) return { error: "Takeaway order could not be created." }; refreshCashier(); return { data: result.data as Record<string, unknown>, success: "Takeaway order created." }; }
  catch { return { error: "Takeaway order could not be created." }; }
}
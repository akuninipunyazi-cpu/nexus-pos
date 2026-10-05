"use server";

import { requireKitchen } from "@/lib/kitchen";
import { createClient } from "@/lib/supabase/server";
import { broadcastOrderUpdate } from "@/lib/realtime";

type Result = { error?: string; success?: string; data?: Record<string, unknown> };

export async function transitionKitchenOrder(formData: FormData): Promise<Result> {
  await requireKitchen();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const nextStatus = String(formData.get("nextStatus") ?? "").trim();
  if (!orderId || !nextStatus) return { error: "The kitchen action is incomplete." };
  try {
    const result = await (await createClient()).rpc("transition_kitchen_order", { p_order_id: orderId, p_next_status: nextStatus });
    if (result.error || !result.data) return { error: "This order cannot move to that status." };
    await broadcastOrderUpdate(orderId);
    const status = String((result.data as Record<string, unknown>).order_status ?? nextStatus);
    return { data: result.data as Record<string, unknown>, success: "Order moved to " + status.toLowerCase() + "." };
  } catch { return { error: "This order cannot move to that status." }; }
}

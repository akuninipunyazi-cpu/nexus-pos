import { createAdminClient } from "@/lib/supabase/admin";

export async function broadcastOrderUpdate(orderId: string) {
  try {
    const admin = createAdminClient();
    const result = await admin.from("orders").select("id,order_status,payment_status,customer_access_token").eq("id", orderId).maybeSingle();
    if (result.error || !result.data) return;
    const channel = admin.channel("customer-order:" + result.data.customer_access_token);
    await channel.send({ type: "broadcast", event: "order.updated", payload: { order_id: result.data.id, order_status: result.data.order_status, payment_status: result.data.payment_status } });
    await admin.removeChannel(channel);
  } catch {}
}

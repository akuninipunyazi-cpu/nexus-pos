import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function getOwnerNotifications() {
  const context = await requireRole(["STORE_OWNER"]);
  const tenantId = context.profile.tenant_id;
  if (!tenantId) throw new Error("Store Owner is not attached to a tenant.");
  const supabase = await createClient();
  const { error: generationError } = await supabase.rpc("ensure_subscription_expiry_notifications");
  if (generationError) return { items: [], unreadCount: 0, error: "Subscription notifications are temporarily unavailable." };

  const [list, unread] = await Promise.all([
    supabase.from("notifications").select("id,notification_type,title,message,read_at,created_at").eq("user_id", context.profile.id).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", context.profile.id).eq("tenant_id", tenantId).is("read_at", null),
  ]);
  if (list.error || unread.error) return { items: [], unreadCount: 0, error: "Subscription notifications are temporarily unavailable." };
  return { items: list.data ?? [], unreadCount: unread.count ?? 0, error: null };
}

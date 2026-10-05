"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionKitchenOrder } from "@/app/kitchen/actions";
import type { KitchenOrder } from "@/lib/kitchen";
import { createClient } from "@/lib/supabase/client";

function elapsed(timestamp: string | null, now: number) {
  if (!timestamp) return "—";
  const minutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60000));
  return minutes === 0 ? "just now" : minutes + " min";
}
const nextAction: Record<KitchenOrder["order_status"], { label: string; status: string } | null> = {
  QUEUED: { label: "Start", status: "PREPARING" }, PREPARING: { label: "Ready", status: "READY" }, READY: { label: "Complete", status: "COMPLETED" },
};

export function KitchenQueue({ orders, tenantId }: { orders: KitchenOrder[]; tenantId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timeFormat = useMemo(() => new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }), []);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("tenant-orders:" + tenantId)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "tenant_id=eq." + tenantId }, () => router.refresh())
      .subscribe();
    const timer = window.setInterval(() => { setNow(Date.now()); router.refresh(); }, 30000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [router, tenantId]);
  function run(orderId: string, nextStatus: string) {
    const form = new FormData(); form.set("orderId", orderId); form.set("nextStatus", nextStatus);
    start(async () => { const result = await transitionKitchenOrder(form); setNotice(result.error ?? result.success ?? null); if (!result.error) router.refresh(); });
  }
  return <section className="kitchen-queue">
    {notice && <p className="form-success kitchen-notice" role="status">{notice}</p>}
    {orders.length === 0 ? <div className="plain-empty"><strong>No paid orders in the kitchen.</strong><br />New paid orders will appear here automatically.</div> : <div className="kitchen-order-list">
      {orders.map((order) => { const action = nextAction[order.order_status]; const time = order.order_status === "QUEUED" ? order.queued_at : order.order_status === "PREPARING" ? order.preparing_at : order.ready_at; return <article className={"kitchen-order kitchen-order-" + order.order_status.toLowerCase()} key={order.id}>
        <div className="kitchen-order-head"><div><strong>#{order.order_number}</strong><span>{order.order_type === "DINE_IN" ? "Dine-in · Table " + (order.table_number ?? "—") : "Takeaway"}</span></div><time dateTime={time ?? order.created_at}>{timeFormat.format(new Date(time ?? order.created_at))} · {elapsed(time ?? order.created_at, now)}</time></div>
        <div className="kitchen-order-body"><div className="kitchen-status-line"><span className={"status status-" + order.order_status.toLowerCase()}>{order.order_status}</span><span className="kitchen-payment">Paid</span></div><div className="kitchen-items">{order.items.map((item, index) => <div key={item.product_name_snapshot + "-" + index}><span><b>{item.quantity}</b> {item.product_name_snapshot}</span>{item.notes && <small>{item.notes}</small>}</div>)}</div></div>
        {action && <button className="primary-button compact kitchen-action" disabled={pending} onClick={() => run(order.id, action.status)}>{pending ? "Saving..." : action.label}</button>}
      </article>; })}
    </div>}
  </section>;
}

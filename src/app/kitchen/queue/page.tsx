import { KitchenQueue } from "@/components/kitchen/queue";
import { requireKitchen, getKitchenOrders } from "@/lib/kitchen";

export default async function KitchenQueuePage() {
  const { tenantId } = await requireKitchen();
  const orders = await getKitchenOrders();
  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Kitchen workspace</p><h1 className="page-title">Kitchen queue</h1><p className="page-intro">Paid orders, in sequence. Move each order forward when the work is actually done.</p></div><span className="live-indicator"><i /> Live</span></div>
    <section className="platform-section"><div className="section-heading"><div><p className="eyebrow">Production line</p><h2>Active orders</h2></div><span className="queue-count">{orders.length} active</span></div><KitchenQueue orders={orders} tenantId={tenantId} /></section>
  </>;
}

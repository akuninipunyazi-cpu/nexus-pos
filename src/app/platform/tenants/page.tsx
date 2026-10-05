import Link from "next/link";
import { getPlatformData } from "@/lib/platform";
import { formatDateTime, formatRemainingTime } from "@/lib/subscriptions";

export default async function TenantsPage() {
  const data = await getPlatformData();
  const latestSubscription = new Map<string, (typeof data.subscriptions)[number]>();
  data.subscriptions.forEach((subscription) => { if (!latestSubscription.has(subscription.tenant_id)) latestSubscription.set(subscription.tenant_id, subscription); });
  return <><div className="page-heading-row"><div><p className="eyebrow">Platform</p><h1 className="page-title">Tenants</h1><p className="page-intro">Store workspaces and their subscription boundary. Operational order data is not shown here.</p></div><Link className="primary-button compact button-link" href="/platform/tenants/new">Create tenant</Link></div>{data.tenants.length === 0 ? <div className="plain-empty large-empty"><h2>No tenants yet.</h2><p>Create your first tenant and invite its Store Owner.</p><Link href="/platform/tenants/new">Create your first tenant</Link></div> : <div className="table-wrap platform-table"><table><thead><tr><th>Store</th><th>Owner</th><th>Subscription</th><th>Expiry</th><th>Remaining</th></tr></thead><tbody>{data.tenants.map((tenant) => { const subscription = latestSubscription.get(tenant.id); return <tr key={tenant.id}><td><strong>{tenant.name}</strong><small>{tenant.slug}</small></td><td>{tenant.owner?.full_name ?? tenant.owner?.email ?? "No owner profile"}</td><td>{subscription ? <Status status={subscription.status} /> : "No subscription"}</td><td>{subscription ? formatDateTime(subscription.expires_at) : "—"}</td><td>{subscription ? formatRemainingTime(subscription.expires_at) : "—"}</td></tr>; })}</tbody></table></div>}</>;
}
function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase()}`}>{status.replace("_", " ")}</span>; }
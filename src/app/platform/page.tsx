import Link from "next/link";
import { getPlatformOverview } from "@/lib/platform";
import { formatRemainingTime, formatDateTime } from "@/lib/subscriptions";

export default async function PlatformPage() {
  const data = await getPlatformOverview();
  const revenue = Object.entries(data.recordedRevenue).map(([currency, amount]) => new Intl.NumberFormat("id-ID", { style: "currency", currency }).format(amount)).join(" + ");
  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Platform overview</p><h1 className="page-title">The platform at a glance.</h1><p className="page-intro">SaaS-level visibility for tenants and subscriptions. Store operations stay inside their own workspace.</p></div><Link className="primary-button compact button-link" href="/platform/tenants/new">Create tenant</Link></div>
    <section className="metric-grid" aria-label="Platform metrics"><Metric label="Total tenants" value={String(data.tenants.length)} /><Metric label="Active subscriptions" value={String(data.counts.ACTIVE)} /><Metric label="Expiring soon" value={String(data.counts.EXPIRING_SOON)} /><Metric label="Expired" value={String(data.counts.EXPIRED)} /><Metric label="Recorded revenue" value={revenue || "No records"} /></section>
    <section className="platform-section"><div className="section-heading"><div><p className="eyebrow">Subscription pulse</p><h2>Latest expiry dates</h2></div><Link href="/platform/subscriptions">View subscriptions</Link></div>{data.subscriptions.length === 0 ? <div className="plain-empty">No subscriptions yet. Create a tenant to start the platform record.</div> : <div className="table-wrap"><table><thead><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Expires</th><th>Remaining</th></tr></thead><tbody>{data.subscriptions.slice(0, 5).map((subscription) => <tr key={subscription.id}><td>{subscription.tenant?.name ?? "Unknown tenant"}</td><td>{subscription.plan_name}</td><td><Status status={subscription.status} /></td><td>{formatDateTime(subscription.expires_at)}</td><td>{formatRemainingTime(subscription.expires_at)}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase()}`}>{status.replace("_", " ")}</span>; }
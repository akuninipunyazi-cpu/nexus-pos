import Link from "next/link";
import { getPlatformOverview } from "@/lib/platform";
import { formatDateTime, formatRemainingTime } from "@/lib/subscriptions";

export default async function PlatformPage() {
  const data = await getPlatformOverview();
  const current = data.subscriptions.filter((subscription) => subscription.is_current);
  const upcoming = current
    .filter((subscription) => ["TRIAL", "ACTIVE", "EXPIRING_SOON"].includes(subscription.status))
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    .slice(0, 6);
  const metrics = [
    ["Total tenants", data.platformCounts.tenants],
    ["Active tenants", data.platformCounts.activeTenants],
    ["Trial tenants", data.platformCounts.trialTenants],
    ["Expired tenants", data.platformCounts.expiredTenants],
    ["Suspended tenants", data.platformCounts.suspendedTenants],
    ["Active subscriptions", data.platformCounts.activeSubscriptions],
    ["Expiring soon", data.platformCounts.expiringSoon],
  ] as const;

  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Platform overview</p><h1 className="page-title">Platform status</h1><p className="page-intro">Tenant and subscription health across the platform.</p></div><Link className="primary-button compact button-link" href="/platform/tenants/new">Create tenant</Link></div>
    <section className="platform-kpi-grid" aria-label="Platform metrics">{metrics.map(([label, value]) => <Metric key={label} label={label} value={String(value)} />)}</section>

    <section className="platform-section"><div className="section-heading"><div><p className="eyebrow">Current assignments</p><h2>Subscription overview</h2></div><Link href="/platform/subscriptions">Manage subscriptions</Link></div>
      {data.planSummaries.length === 0 ? <div className="plain-empty">No current plan assignments yet.</div> : <div className="table-wrap"><table className="platform-dashboard-table"><thead><tr><th>Plan</th><th>Subscriptions</th><th>Subscription value</th></tr></thead><tbody>{data.planSummaries.map((plan) => <tr key={`${plan.planName}-${plan.currency}`}><td>{plan.planName}</td><td>{plan.subscriptions}</td><td>{new Intl.NumberFormat("id-ID", { style: "currency", currency: plan.currency }).format(plan.value)} <small>plan price total; not collected revenue</small></td></tr>)}</tbody></table></div>}
    </section>

    <section className="platform-section"><div className="section-heading"><div><p className="eyebrow">Expiry watch</p><h2>Upcoming subscription dates</h2></div><Link href="/platform/tenants">All tenants</Link></div>
      {upcoming.length === 0 ? <div className="plain-empty">No upcoming subscriptions to review.</div> : <div className="table-wrap"><table className="platform-dashboard-table"><thead><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Expires</th><th>Remaining</th></tr></thead><tbody>{upcoming.map((subscription) => <tr key={subscription.id}><td><Link href={`/platform/tenants/${subscription.tenant_id}`}>{subscription.tenant?.name ?? "Tenant"}</Link></td><td>{subscription.plan_name}</td><td><Status status={subscription.status} /></td><td>{formatDateTime(subscription.expires_at)}</td><td>{formatRemainingTime(subscription.expires_at)}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase()}`}>{status.replaceAll("_", " ")}</span>; }

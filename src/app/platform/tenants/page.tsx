import Link from "next/link";
import { DeleteTenantControl, PendingTenantCleanupList } from "@/components/platform/tenant-deletion-controls";
import { getPendingTenantAuthCleanupJobs, getPlatformData } from "@/lib/platform";
import { formatDateTime, formatRemainingTime } from "@/lib/subscriptions";

export default async function TenantsPage() {
  const [data, cleanupJobs] = await Promise.all([getPlatformData(), getPendingTenantAuthCleanupJobs()]);
  const latestSubscription = new Map<string, (typeof data.subscriptions)[number]>();
  data.subscriptions.forEach((subscription) => {
    if (subscription.is_current || !latestSubscription.has(subscription.tenant_id)) latestSubscription.set(subscription.tenant_id, subscription);
  });

  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Platform</p><h1 className="page-title">Tenants</h1><p className="page-intro">Store workspaces, owners, and their current subscription boundary.</p></div><Link className="primary-button compact button-link" href="/platform/tenants/new">Create tenant</Link></div>
    {!cleanupJobs.available && <div className="plain-empty" role="status"><strong>Tenant deletion is temporarily unavailable.</strong><p>The database update for tenant deletion has not been applied in this environment. The tenant list and other platform tools remain available.</p></div>}
    {cleanupJobs.available && <PendingTenantCleanupList jobs={cleanupJobs.jobs.map((job) => ({ ...job, created_at: formatDateTime(job.created_at) }))} />}
    {data.tenants.length === 0 ? <div className="plain-empty large-empty"><h2>No tenants yet.</h2><p>Create your first tenant and invite its Store Owner.</p><Link href="/platform/tenants/new">Create your first tenant</Link></div> : <div className="table-wrap platform-table"><table className="platform-dashboard-table"><thead><tr><th>Store</th><th>Owner</th><th>Tenant status</th><th>Plan</th><th>Subscription</th><th>Started</th><th>Expires</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{data.tenants.map((tenant) => {
      const subscription = latestSubscription.get(tenant.id);
      return <tr key={tenant.id}><td><Link className="platform-tenant-link" href={`/platform/tenants/${tenant.id}`}><strong>{tenant.name}</strong><small>{tenant.slug}</small></Link></td><td>{tenant.owner?.full_name ?? tenant.owner?.email ?? "No owner profile"}</td><td><Status status={tenant.status} /></td><td>{subscription?.plan_name ?? "Unassigned"}</td><td>{subscription ? <Status status={subscription.status} /> : "No subscription"}</td><td>{subscription ? formatDateTime(subscription.started_at) : "—"}</td><td>{subscription ? formatDateTime(subscription.expires_at) : "—"}</td><td>{subscription ? formatRemainingTime(subscription.expires_at) : "—"}</td><td>{cleanupJobs.available ? <DeleteTenantControl tenantId={tenant.id} tenantName={tenant.name} tenantSlug={tenant.slug} /> : "Unavailable"}</td></tr>;
    })}</tbody></table></div>}
  </>;
}

function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase()}`}>{status.replaceAll("_", " ")}</span>; }

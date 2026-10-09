import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformTenantDetail } from "@/lib/platform";
import { formatDateTime, formatRemainingTime } from "@/lib/subscriptions";

export default async function PlatformTenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const detail = await getPlatformTenantDetail(tenantId);
  if (!detail) notFound();
  const planRelation = detail.subscription?.plan;
  const plan = (Array.isArray(planRelation) ? planRelation[0] : planRelation) as { name: string; code: string; max_staff: number | null; max_products: number | null; max_tables: number | null } | null | undefined;

  return <>
    <div className="page-heading-row"><div><Link className="back-link" href="/platform/tenants">Tenants</Link><p className="eyebrow">Platform / tenant detail</p><h1 className="page-title">{detail.tenant.name}</h1><p className="page-intro">{detail.tenant.slug}</p></div><Link className="primary-button compact button-link" href="/platform/subscriptions">Manage subscription</Link></div>
    <div className="platform-detail-grid">
      <section className="platform-section platform-detail-section"><div className="section-heading"><div><p className="eyebrow">Workspace</p><h2>Tenant</h2></div></div><Detail label="Status"><Status status={detail.tenant.status}/></Detail><Detail label="Created">{formatDateTime(detail.tenant.created_at)}</Detail></section>
      <section className="platform-section platform-detail-section"><div className="section-heading"><div><p className="eyebrow">Account</p><h2>Store Owner</h2></div></div>{detail.owner ? <><Detail label="Name">{detail.owner.full_name ?? "—"}</Detail><Detail label="Email">{detail.owner.email}</Detail><Detail label="Account">{detail.owner.is_active ? "Active" : "Inactive"}</Detail></> : <p className="plain-empty">No Store Owner profile is linked.</p>}</section>
    </div>
    <section className="platform-section platform-detail-section"><div className="section-heading"><div><p className="eyebrow">Current assignment</p><h2>Subscription</h2></div><Link href="/platform/subscriptions">Manage assignments</Link></div>{detail.subscription ? <div className="platform-detail-grid"><div><Detail label="Plan">{detail.subscription.plan_name}{plan?.code ? ` (${plan.code})` : ""}</Detail><Detail label="Status"><Status status={detail.subscription.status}/></Detail><Detail label="Amount">{new Intl.NumberFormat("id-ID", { style: "currency", currency: detail.subscription.currency }).format(detail.subscription.amount)} <small>plan value, not settlement</small></Detail></div><div><Detail label="Starts">{formatDateTime(detail.subscription.started_at)}</Detail><Detail label="Expires">{formatDateTime(detail.subscription.expires_at)}</Detail><Detail label="Remaining">{formatRemainingTime(detail.subscription.expires_at)}</Detail></div></div> : <p className="plain-empty">No subscription is assigned.</p>}</section>
    <section className="platform-section platform-detail-section"><div className="section-heading"><div><p className="eyebrow">Current plan usage</p><h2>Tenant resources</h2></div></div><div className="platform-usage-grid"><Usage label="Staff" value={detail.usage.staff} limit={plan?.max_staff ?? null}/><Usage label="Active products" value={detail.usage.products} limit={plan?.max_products ?? null}/><Usage label="Active tables" value={detail.usage.tables} limit={plan?.max_tables ?? null}/></div></section>
  </>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) { return <div className="platform-detail-row"><span>{label}</span><strong>{children}</strong></div>; }
function Usage({ label, value, limit }: { label: string; value: number; limit: number | null }) { return <div className="platform-usage-cell"><span>{label}</span><strong>{value} / {limit === null ? "Unlimited" : limit}</strong></div>; }
function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase()}`}>{status.replaceAll("_", " ")}</span>; }

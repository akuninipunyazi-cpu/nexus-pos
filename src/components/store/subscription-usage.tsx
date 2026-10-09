import type { TenantUsageSummary } from "@/lib/tenant-usage";

function UsageRow({ label, current, limit }: { label: string; current: number; limit: number | null }) {
  const reached = limit !== null && current >= limit;
  const percent = limit === null ? 0 : limit === 0 ? (current > 0 ? 100 : 0) : Math.min(100, current / limit * 100);
  return <div className="subscription-usage-row"><div className="subscription-usage-label"><span>{label}</span><strong>{current} / {limit === null ? "Unlimited" : limit}</strong></div>{limit !== null && <div className="subscription-usage-track" aria-hidden="true"><i className={reached ? "is-limit-reached" : ""} style={{ width: `${percent}%` }}/></div>}{reached && <small role="status">Limit reached. Manage the plan with your platform administrator.</small>}</div>;
}

export function SubscriptionUsage({ summary }: { summary: TenantUsageSummary }) {
  return <section className="subscription-usage"><div className="section-heading"><div><p className="eyebrow">Plan usage</p><h2>{summary.planName ?? "No plan assigned"}</h2></div>{summary.subscriptionStatus && <span className={`status status-${summary.subscriptionStatus.toLowerCase()}`}>{summary.subscriptionStatus.replaceAll("_", " ")}</span>}</div>{!summary.planCode && <p className="field-help">No resource limits are configured for this legacy subscription. Contact the platform administrator to assign a plan.</p>}<div className="subscription-usage-grid"><UsageRow label="Staff" current={summary.usage.staff} limit={summary.limits.staff}/><UsageRow label="Active products" current={summary.usage.products} limit={summary.limits.products}/><UsageRow label="Active tables" current={summary.usage.tables} limit={summary.limits.tables}/></div></section>;
}

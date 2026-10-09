import { getPlatformAuditLogs, getPlatformTenantChoices } from "@/lib/platform";

const ACTIONS = ["TENANT_CREATED", "TENANT_UPDATED", "PLAN_CREATED", "PLAN_UPDATED", "SUBSCRIPTION_ASSIGNED", "SUBSCRIPTION_UPDATED", "SUBSCRIPTION_SUSPENDED", "SUBSCRIPTION_ACTIVATED"];

export default async function PlatformAuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tenantId = single(params.tenant);
  const action = ACTIONS.includes(single(params.action)) ? single(params.action) : "";
  const from = validDate(single(params.from));
  const to = validDate(single(params.to));
  const [logs, tenants] = await Promise.all([
    getPlatformAuditLogs({ tenantId: tenantId || undefined, action: action || undefined, from: from || undefined, to: to || undefined }),
    getPlatformTenantChoices(),
  ]);

  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Platform accountability</p><h1 className="page-title">Audit log</h1><p className="page-intro">Successful tenant and subscription changes. Entries are read-only.</p></div></div>
    <form className="audit-filter-form" method="get">
      <label>Tenant<select name="tenant" defaultValue={tenantId}><option value="">All platform activity</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
      <label>Action<select name="action" defaultValue={action}><option value="">All actions</option>{ACTIONS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label>From<input name="from" type="date" defaultValue={from}/></label>
      <label>To<input name="to" type="date" defaultValue={to}/></label>
      <button className="secondary-button" type="submit">Filter</button>
    </form>
    <p className="audit-result-count">Showing {logs.length} most recent matching entries (maximum 100).</p>
    {logs.length === 0 ? <div className="plain-empty">No audit entries match these filters.</div> : <div className="table-wrap"><table className="audit-table"><thead><tr><th>Time (Jakarta)</th><th>Actor</th><th>Action</th><th>Entity</th><th>Tenant</th><th>Details</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatJakarta(log.created_at)}</td><td>{log.actor?.full_name ?? log.actor?.email ?? "Former user"}<small>{log.actor_role}</small></td><td>{humanize(log.action)}</td><td>{log.entity_type}<small>{log.entity_id ?? "—"}</small></td><td>{log.tenant?.name ?? "Platform"}</td><td><details><summary>View</summary><pre>{JSON.stringify(log.metadata, null, 2)}</pre></details></td></tr>)}</tbody></table></div>}
  </>;
}

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : ""; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatJakarta(value: string) { return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value)); }

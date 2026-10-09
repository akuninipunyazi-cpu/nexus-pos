import { PaymentAccountStatusForm } from "@/components/platform/payment-account-status-form";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type PaymentAccountRow = {
  id: string; tenant_id: string; provider_merchant_id: string | null;
  merchant_name: string; status: string; created_at: string;
};

export default async function PlatformPaymentAccountsPage() {
  await requireRole(["SUPER_ADMIN"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("payment_accounts")
    .select("id,tenant_id,provider_merchant_id,merchant_name,status,created_at")
    .order("created_at", { ascending: false });
  const accounts = (data ?? []) as PaymentAccountRow[];
  const tenantIds = [...new Set(accounts.map((account) => account.tenant_id))];
  const [tenantsResult, ownersResult] = tenantIds.length ? await Promise.all([
    supabase.from("tenants").select("id,name,slug").in("id", tenantIds),
    supabase.from("profiles").select("tenant_id,full_name,email").eq("role", "STORE_OWNER").in("tenant_id", tenantIds),
  ]) : [{ data: [] }, { data: [] }];
  const tenants = new Map((tenantsResult.data ?? []).map((row) => [row.id, row]));
  const owners = new Map((ownersResult.data ?? []).map((row) => [row.tenant_id, row]));

  return <main className="page-content">
    <p className="eyebrow">Platform operations</p>
    <h1 className="page-title">Merchant payment accounts</h1>
    <p className="page-intro">Confirm a merchant in Midtrans Partner before enabling QRIS. Status changes are recorded in the platform audit log.</p>
    {error ? <div className="plain-empty" role="alert">Payment accounts could not be loaded.</div> : accounts.length === 0
      ? <div className="plain-empty">No store payment accounts have been submitted.</div>
      : <div className="table-wrap"><table><thead><tr><th>Store</th><th>Owner</th><th>Merchant</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {accounts.map((account) => {
          const tenant = tenants.get(account.tenant_id);
          const owner = owners.get(account.tenant_id);
          return <tr key={account.id}>
            <td>{tenant?.name ?? "Unknown store"}<small className="table-secondary">{tenant?.slug ?? ""}</small></td>
            <td>{owner?.full_name || owner?.email || "—"}</td>
            <td>{account.merchant_name}<small className="table-secondary">{account.provider_merchant_id ?? "Registration response pending"}</small></td>
            <td><span className={`status status-${account.status.toLowerCase()}`}>{account.status}</span></td>
            <td>{account.provider_merchant_id ? <PaymentAccountStatusForm merchantId={account.provider_merchant_id} merchantName={account.merchant_name} defaultStatus={account.status === "SUBMITTED" ? "ACTIVE" : account.status}/> : <span className="field-help">No merchant ID recorded; platform support review required.</span>}</td>
          </tr>;
        })}
      </tbody></table></div>}
  </main>;
}

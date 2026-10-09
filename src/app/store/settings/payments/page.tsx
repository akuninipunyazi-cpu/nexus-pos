import { PaymentSettingsPanel } from "@/components/store/payment-settings-panel";
import { requireRole } from "@/lib/auth";
import { isMidtransPartnerOnboardingConfigured } from "@/lib/midtrans-partner";
import { createClient } from "@/lib/supabase/server";

export default async function StorePaymentSettingsPage() {
  const context = await requireRole(["STORE_OWNER"]);
  const tenantId = context.profile.tenant_id;
  if (!tenantId) return <main className="page-content"><h1 className="page-title">Payment settings</h1><p className="page-intro">This account is not attached to a store.</p></main>;
  const supabase = await createClient();
  const result = await supabase.from("payment_accounts")
    .select("provider_merchant_id,merchant_name,status,activated_at,updated_at")
    .eq("tenant_id", tenantId).maybeSingle();
  const account = result.data;
  return <main className="page-content">
    <p className="eyebrow">Store settings</p>
    <h1 className="page-title">Payment settings</h1>
    <p className="page-intro">Connect this store’s Midtrans merchant account for customer QRIS payments.</p>
    {result.error
      ? <div className="plain-empty" role="alert">Payment configuration could not be loaded. Try again later.</div>
      : <PaymentSettingsPanel account={account ? {
        merchantId: account.provider_merchant_id,
        merchantName: account.merchant_name,
        status: account.status,
        activatedAt: account.activated_at,
      } : null} partnerConfigured={isMidtransPartnerOnboardingConfigured()} />}
  </main>;
}

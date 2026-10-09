import { createClient } from "@/lib/supabase/server";
import { CheckoutClient } from "@/components/order/customer-menu";
import { isMidtransPartnerConfigured } from "@/lib/midtrans-partner";

export default async function CheckoutPage({ params }: { params: Promise<{ tenantSlug: string; tablePublicToken: string }> }) {
  const { tenantSlug, tablePublicToken } = await params;
  const supabase = await createClient();
  const result = await supabase.rpc("get_public_table_context", { p_tenant_slug: tenantSlug, p_public_token: tablePublicToken });
  if (result.error || !result.data) return <main className="public-order"><div className="public-not-found"><h1>Table unavailable.</h1><p>This checkout is no longer available.</p></div></main>;
  const data = result.data as { table: { table_number: string }; qris_available?: boolean };
  return <CheckoutClient tenantSlug={tenantSlug} tableToken={tablePublicToken} tableNumber={data.table.table_number} qrisAvailable={Boolean(data.qris_available && isMidtransPartnerConfigured())} />;
}

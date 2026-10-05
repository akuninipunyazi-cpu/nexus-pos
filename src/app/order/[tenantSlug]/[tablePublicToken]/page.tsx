import { createClient } from "@/lib/supabase/server";
import { CustomerMenu } from "@/components/order/customer-menu";

type Context = { tenant: { name: string; slug: string }; table: { table_number: string }; categories: { name: string }[]; products: { id: string; name: string; description: string | null; price: number | string; image_url: string | null; category: string }[] };

export default async function PublicTablePage({ params }: { params: Promise<{ tenantSlug: string; tablePublicToken: string }> }) {
  const { tenantSlug, tablePublicToken } = await params;
  const supabase = await createClient();
  const result = await supabase.rpc("get_public_table_context", { p_tenant_slug: tenantSlug, p_public_token: tablePublicToken });
  if (result.error || !result.data) return <main className="public-order"><div className="public-not-found"><p className="eyebrow">Table unavailable</p><h1>This table link is not active.</h1><p>Check the table URL or ask the store for a current one.</p></div></main>;
  const data = result.data as Context;
  return <CustomerMenu tenantSlug={data.tenant.slug} tenantName={data.tenant.name} tableToken={tablePublicToken} tableNumber={data.table.table_number} categories={data.categories ?? []} products={data.products ?? []} />;
}
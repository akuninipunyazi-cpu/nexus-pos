import { createClient } from "@/lib/supabase/server";
import { OrderStatus } from "@/components/order/customer-menu";

type StatusData = { order_number: string; table_number: string; order_status: string; payment_status: string; total: number | string; items: { name: string; quantity: number; line_total: number | string }[] };

export default async function OrderStatusPage({ params, searchParams }: { params: Promise<{ tenantSlug: string; tablePublicToken: string; orderId: string }>; searchParams: Promise<{ access?: string }> }) {
  const { tenantSlug, tablePublicToken, orderId } = await params;
  const { access } = await searchParams;
  if (!access) return <main className="public-order"><div className="public-not-found"><h1>Order status unavailable.</h1><p>This status link is missing its private access token.</p></div></main>;
  const supabase = await createClient();
  const result = await supabase.rpc("get_public_order_status", { p_tenant_slug: tenantSlug, p_table_public_token: tablePublicToken, p_order_id: orderId, p_customer_access_token: access });
  if (result.error || !result.data) return <main className="public-order"><div className="public-not-found"><h1>Order status unavailable.</h1><p>This order link is invalid or no longer available.</p></div></main>;
  return <OrderStatus initial={result.data as StatusData} tenantSlug={tenantSlug} tableToken={tablePublicToken} orderId={orderId} accessToken={access} />;
}
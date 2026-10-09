import { NextResponse } from "next/server";
import { getApplicationUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const providerOrderId = new URL(request.url).searchParams.get("ref") ?? "";
  if (!/^poscafe-[a-f0-9]{32}$/.test(providerOrderId)) return new NextResponse("Payment return unavailable.", { status: 404 });
  const admin = createAdminClient();
  const attemptResult = await admin.from("order_payment_attempts").select("tenant_id,order_id")
    .eq("provider_order_id", providerOrderId).maybeSingle();
  if (attemptResult.error || !attemptResult.data) return new NextResponse("Payment return unavailable.", { status: 404 });
  const { tenant_id: tenantId, order_id: orderId } = attemptResult.data;
  const [orderResult, tenantResult] = await Promise.all([
    admin.from("orders").select("customer_access_token,table_id").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
  ]);
  if (orderResult.error || !orderResult.data || tenantResult.error || !tenantResult.data) return new NextResponse("Payment return unavailable.", { status: 404 });
  const tableResult = await admin.from("tables").select("public_token").eq("id", orderResult.data.table_id).eq("tenant_id", tenantId).maybeSingle();
  if (tableResult.error || !tableResult.data) return new NextResponse("Payment return unavailable.", { status: 404 });

  const origin = await getApplicationUrl();
  const destination = new URL(`/order/${encodeURIComponent(tenantResult.data.slug)}/${encodeURIComponent(tableResult.data.public_token)}/status/${encodeURIComponent(orderId)}`, origin);
  destination.searchParams.set("access", orderResult.data.customer_access_token);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

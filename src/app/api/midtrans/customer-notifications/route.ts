import { NextResponse } from "next/server";
import { broadcastOrderUpdate } from "@/lib/realtime";
import {
  mapPartnerTransactionStatus,
  partnerConfiguration,
  verifyPartnerPaymentSignature,
} from "@/lib/midtrans-partner";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Notification = {
  order_id?: string; status_code?: string; gross_amount?: string; signature_key?: string;
  partner_id?: string; merchant_id?: string; currency?: string; transaction_status?: string;
  transaction_id?: string; fraud_status?: string;
  signatureKey?: string;
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 32_768) return NextResponse.json({ error: "Invalid notification." }, { status: 413 });
  let body: Notification;
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return NextResponse.json({ error: "Invalid notification." }, { status: 413 });
    body = JSON.parse(raw) as Notification;
  } catch {
    return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
  }
  const partner = partnerConfiguration();
  // Merchant lifecycle callbacks use a different, insufficiently specified
  // signature canonicalization in the public Partner docs. Acknowledge only
  // to avoid repeated delivery; never change merchant state from this event.
  if (body.signatureKey && partner && body.partner_id === partner.partnerId) {
    return NextResponse.json({ received: true, merchant_status: "requires_platform_review" }, { status: 202 });
  }
  if (!partner || body.partner_id !== partner.partnerId || !verifyPartnerPaymentSignature(body)) {
    return NextResponse.json({ error: "Invalid notification." }, { status: 401 });
  }
  if (!body.order_id || !body.gross_amount || !body.merchant_id || !body.currency || !body.status_code) {
    return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await admin.rpc("apply_midtrans_partner_notification", {
    p_provider_order_id: body.order_id,
    p_provider_transaction_id: body.transaction_id ?? null,
    p_provider_status: mapPartnerTransactionStatus(body),
    p_gross_amount: body.gross_amount,
    p_currency: body.currency,
    p_partner_id: body.partner_id,
    p_merchant_id: body.merchant_id,
  });
  if (result.error || !result.data) return NextResponse.json({ error: "Notification could not be applied." }, { status: 500 });
  const applied = result.data as { order_id?: string; changed?: boolean };
  if (applied.order_id && applied.changed) await broadcastOrderUpdate(applied.order_id);
  return NextResponse.json({ received: true });
}

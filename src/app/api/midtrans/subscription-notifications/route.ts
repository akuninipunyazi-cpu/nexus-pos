import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAuthoritativeMidtransStatus,
  isMidtransPaymentSuccessful,
  mapMidtransPaymentStatus,
  parseIdrMinorUnits,
  verifyMidtransNotificationSignature,
} from "@/lib/midtrans";

export const runtime = "nodejs";

type MidtransNotification = {
  order_id?: unknown;
  transaction_id?: unknown;
  transaction_status?: unknown;
  status_code?: unknown;
  gross_amount?: unknown;
  currency?: unknown;
  signature_key?: unknown;
  payment_type?: unknown;
};

function text(value: unknown, max = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Unsupported content type." }, { status: 415 });
  }

  let notification: MidtransNotification;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 32_768) return NextResponse.json({ error: "Invalid notification." }, { status: 413 });
    notification = JSON.parse(raw) as MidtransNotification;
  } catch {
    return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
  }

  const orderId = text(notification.order_id, 50);
  const notificationTransactionId = text(notification.transaction_id, 128);
  const statusCode = text(notification.status_code, 8);
  const grossAmount = text(notification.gross_amount, 32);
  const signatureKey = text(notification.signature_key, 128);
  if (!orderId || !notificationTransactionId || !statusCode || !grossAmount || !signatureKey
    || !verifyMidtransNotificationSignature({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
    })) {
    return NextResponse.json({ error: "Invalid notification." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("subscription_orders")
      .select("order_id, amount, currency, payment_status, midtrans_transaction_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (orderError) return NextResponse.json({ error: "Notification verification unavailable." }, { status: 503 });
    if (!order) return NextResponse.json({ error: "Unknown order." }, { status: 404 });

    const notificationAmount = parseIdrMinorUnits(grossAmount);
    const orderAmount = parseIdrMinorUnits(order.amount);
    if (order.currency !== "IDR" || notificationAmount === null || orderAmount === null || notificationAmount !== orderAmount) {
      return NextResponse.json({ error: "Payment amount mismatch." }, { status: 422 });
    }
    const eventCurrency = text(notification.currency, 3);
    if (eventCurrency && eventCurrency.toUpperCase() !== order.currency) {
      return NextResponse.json({ error: "Payment currency mismatch." }, { status: 422 });
    }

    const authoritative = await getAuthoritativeMidtransStatus(orderId);
    if (authoritative.order_id !== orderId
      || !text(authoritative.transaction_id, 128)
      || authoritative.transaction_id !== notificationTransactionId
      || authoritative.status_code !== "200"
      || parseIdrMinorUnits(authoritative.gross_amount) !== orderAmount
      || (authoritative.currency && authoritative.currency.toUpperCase() !== order.currency)) {
      return NextResponse.json({ error: "Payment could not be verified." }, { status: 422 });
    }

    const paymentStatus = mapMidtransPaymentStatus(authoritative);
    if (paymentStatus === "PAID" && !isMidtransPaymentSuccessful(authoritative)) {
      return NextResponse.json({ error: "Payment is not yet verified." }, { status: 409 });
    }
    if (!["settlement", "capture", "pending", "deny", "failure", "expire", "cancel"].includes(authoritative.transaction_status?.toLowerCase() ?? "")) {
      return NextResponse.json({ error: "Unsupported payment state." }, { status: 422 });
    }

    const { error: applyError } = await admin.rpc("apply_verified_subscription_payment", {
      p_order_id: orderId,
      p_transaction_id: authoritative.transaction_id,
      p_payment_type: authoritative.payment_type ?? text(notification.payment_type, 64) ?? "unknown",
      p_payment_status: paymentStatus,
      p_amount: authoritative.gross_amount,
      p_currency: authoritative.currency?.toUpperCase() ?? order.currency,
    });
    if (applyError) return NextResponse.json({ error: "Payment update will be retried." }, { status: 503 });
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Payment update will be retried." }, { status: 503 });
  }
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getApplicationUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

type PartnerConfig = { serverKey: string; partnerId: string; mcc: string | null; isProduction: boolean; apiBaseUrl: string };
type QrisReservation = {
  status: string; attempt_id?: string; provider_order_id?: string; amount?: number | string;
  merchant_id?: string; checkout_url?: string | null; expires_at?: string | null; created?: boolean;
  items?: { id: string; name: string; price: number | string; quantity: number }[];
};

export class MidtransPartnerRequestError extends Error {
  readonly definitive = true;
}

function config(): PartnerConfig | null {
  const serverKey = process.env.MIDTRANS_PARTNER_SERVER_KEY?.trim();
  const partnerId = process.env.MIDTRANS_PARTNER_ID?.trim();
  const mcc = process.env.MIDTRANS_PARTNER_MCC?.trim();
  const production = process.env.MIDTRANS_IS_PRODUCTION?.trim().toLowerCase();
  if (!serverKey || !partnerId || (production && production !== "true" && production !== "false")) return null;
  const isProduction = production === "true";
  return { serverKey, partnerId, mcc: mcc ?? null, isProduction, apiBaseUrl: isProduction ? "https://partner-api.midtrans.com" : "https://partner-api.stg.midtrans.com" };
}

export function isMidtransPartnerConfigured() { return config() !== null; }
export function isMidtransPartnerOnboardingConfigured() { return Boolean(config()?.mcc); }

async function partnerFetch(path: string, partner: PartnerConfig, init: RequestInit = {}) {
  const response = await fetch(`${partner.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${partner.serverKey}:`).toString("base64")}`,
      "content-type": "application/json",
      "x-partner-id": partner.partnerId,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, body };
}

export async function createPartnerMerchant(input: { email: string; ownerName: string; storeName: string }) {
  const partner = config();
  if (!partner?.mcc) throw new Error("Midtrans Partner onboarding is not configured.");
  const origin = await getApplicationUrl();
  const notificationUrl = new URL("/api/midtrans/customer-notifications", origin).toString();
  const { response, body } = await partnerFetch("/api/v1/merchants", partner, {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      merchant_name: input.storeName.slice(0, 50),
      owner_name: input.ownerName.slice(0, 120),
      mcc: partner.mcc,
      callback_url: notificationUrl,
      notification_url: notificationUrl,
    }),
  });
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id.trim() : "";
  if (!response.ok || body.status_code !== "200" || !merchantId) {
    throw new MidtransPartnerRequestError("Midtrans did not accept the merchant onboarding request.");
  }
  return { merchantId, merchantName: typeof body.merchant_name === "string" ? body.merchant_name : input.storeName };
}

function trustedCheckoutUrl(value: unknown, isProduction: boolean) {
  if (typeof value !== "string") throw new Error("Midtrans did not return a checkout URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Midtrans returned an invalid checkout URL."); }
  const allowed = isProduction ? "app.midtrans.com" : "app.sandbox.midtrans.com";
  if (url.protocol !== "https:" || url.hostname !== allowed || url.port || url.username || url.password) {
    throw new Error("Midtrans returned an untrusted checkout URL.");
  }
  return url.toString();
}

function jakartaTimestamp(date: Date) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19).replace("T", " ")} +0700`;
}

export async function createPartnerQrisCheckout(input: {
  providerOrderId: string; merchantId: string; amount: number | string;
  items: NonNullable<QrisReservation["items"]>;
}) {
  const partner = config();
  if (!partner) throw new Error("Midtrans Partner payment is not configured.");
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("This order total cannot be paid through QRIS.");
  const items = input.items.map((item) => {
    const price = Number(item.price);
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("This order contains an amount that Midtrans cannot process.");
    }
    return { id: item.id.slice(0, 50), name: item.name.slice(0, 50), price, quantity: item.quantity };
  });
  if (items.reduce((sum, item) => sum + item.price * item.quantity, 0) !== amount) {
    throw new Error("Order total verification failed.");
  }
  const origin = await getApplicationUrl();
  const finish = new URL("/api/midtrans/customer-return", origin);
  finish.searchParams.set("ref", input.providerOrderId);
  const { response, body } = await partnerFetch("/api/v1/checkout/transactions", partner, {
    method: "POST",
    headers: { "x-merchant-id": input.merchantId },
    body: JSON.stringify({
      transaction_details: { order_id: input.providerOrderId, gross_amount: amount },
      item_details: items,
      enabled_payments: ["other_qris"],
      callbacks: { finish: finish.toString(), error: finish.toString() },
      expiry: { start_time: jakartaTimestamp(new Date()), unit: "minutes", duration: 15 },
    }),
  });
  if (!response.ok) throw new MidtransPartnerRequestError("Midtrans rejected the QRIS checkout request.");
  const checkoutUrl = trustedCheckoutUrl(body.redirect_url, partner.isProduction);
  if (typeof body.token !== "string") throw new Error("Midtrans could not confirm the QRIS checkout response.");
  return { checkoutUrl, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
}

export async function prepareCustomerQris(input: {
  tenantSlug: string; tableToken: string; orderId: string; customerAccessToken: string;
}) {
  if (!config()) throw new Error("QRIS is not configured for this store. Choose Cash or contact the store owner.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_public_qris_attempt", {
    p_tenant_slug: input.tenantSlug,
    p_table_public_token: input.tableToken,
    p_order_id: input.orderId,
    p_customer_access_token: input.customerAccessToken,
  });
  if (error || !data) throw new Error("A QRIS payment could not be prepared for this order.");
  const reservation = data as QrisReservation;
  if (reservation.status === "PAID") return { status: "PAID" as const };
  if (reservation.checkout_url) return { status: reservation.status, checkoutUrl: reservation.checkout_url, expiresAt: reservation.expires_at ?? null };
  if (!reservation.created || !reservation.attempt_id || !reservation.provider_order_id || !reservation.merchant_id || !reservation.items) {
    return { status: "PROCESSING" as const };
  }
  let checkout: { checkoutUrl: string; expiresAt: string };
  try {
    checkout = await createPartnerQrisCheckout({
      providerOrderId: reservation.provider_order_id,
      merchantId: reservation.merchant_id,
      amount: reservation.amount ?? 0,
      items: reservation.items,
    });
  } catch (error) {
    if (error instanceof MidtransPartnerRequestError) {
      await admin.rpc("fail_public_qris_checkout", { p_attempt_id: reservation.attempt_id, p_reason: "Midtrans rejected checkout." });
    }
    throw error;
  }
  const persisted = await admin.rpc("persist_public_qris_checkout", {
    p_attempt_id: reservation.attempt_id,
    p_provider_order_id: reservation.provider_order_id,
    p_checkout_url: checkout.checkoutUrl,
    p_expires_at: checkout.expiresAt,
  });
  // Even if this last write fails, return the provider checkout URL to the
  // customer. The reserved provider order ID remains available to the webhook.
  if (persisted.error) return { status: "PENDING" as const, checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt };
  return { status: "PENDING" as const, checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt };
}

type PartnerNotification = {
  order_id?: string; status_code?: string; gross_amount?: string; signature_key?: string;
  partner_id?: string; merchant_id?: string; currency?: string; transaction_status?: string;
  transaction_id?: string; fraud_status?: string;
};

export function verifyPartnerPaymentSignature(body: PartnerNotification) {
  const partner = config();
  if (!partner || body.partner_id !== partner.partnerId || !body.order_id || !body.status_code || !body.gross_amount || !body.signature_key) return false;
  if (!/^[a-f\d]{128}$/i.test(body.signature_key)) return false;
  const expected = createHash("sha512").update(body.order_id + body.status_code + body.gross_amount + partner.serverKey, "utf8").digest();
  const supplied = Buffer.from(body.signature_key, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function mapPartnerTransactionStatus(body: PartnerNotification): "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" {
  const status = body.transaction_status?.toLowerCase();
  if (status === "settlement") return "PAID";
  if (status === "capture") return body.fraud_status?.toLowerCase() === "accept" ? "PAID" : "PENDING";
  if (status === "expire") return "EXPIRED";
  if (status === "cancel") return "CANCELLED";
  if (status === "deny" || status === "failure") return "FAILED";
  return "PENDING";
}

export function partnerConfiguration() {
  const value = config();
  return value ? { partnerId: value.partnerId } : null;
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getApplicationUrl } from "@/lib/site-url";

type MidtransEnvironment = {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
  apiBaseUrl: string;
  snapScriptUrl: string;
};

export type SubscriptionSnapOrder = {
  orderId: string;
  amount: number;
  planName: string;
  customerName: string;
  customerEmail: string;
};

type SnapCreateResponse = {
  token?: string;
  redirect_url?: string;
  transaction_id?: string;
};

export type MidtransBrowserConfig = {
  clientKey: string;
  snapScriptUrl: string;
};

export type MidtransStatusResponse = {
  order_id?: string;
  transaction_id?: string;
  transaction_status?: string;
  status_code?: string;
  gross_amount?: string;
  currency?: string;
  payment_type?: string;
  fraud_status?: string;
  settlement_time?: string;
};

function getEnvironment(): MidtransEnvironment {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
  const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim();
  const productionValue = process.env.MIDTRANS_IS_PRODUCTION?.trim().toLowerCase();
  if (productionValue && productionValue !== "true" && productionValue !== "false") {
    throw new Error("MIDTRANS_IS_PRODUCTION must be true or false.");
  }
  if (!serverKey || !clientKey) {
    throw new Error("Midtrans sandbox credentials are not configured.");
  }

  const isProduction = productionValue === "true";
  return {
    serverKey,
    clientKey,
    isProduction,
    apiBaseUrl: isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com",
    snapScriptUrl: isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",
  };
}

export function getMidtransBrowserConfig(): MidtransBrowserConfig {
  const environment = getEnvironment();
  return { clientKey: environment.clientKey, snapScriptUrl: environment.snapScriptUrl };
}

function jakartaTimestamp(value: Date) {
  const shifted = new Date(value.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19).replace("T", " ")} +0700`;
}

export function trustedMidtransRedirect(value: string, isProduction = isMidtransProduction()) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Midtrans returned an invalid checkout URL.");
  }
  const expectedHost = isProduction ? "app.midtrans.com" : "app.sandbox.midtrans.com";
  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error("Midtrans returned an untrusted checkout URL.");
  }
  return url.toString();
}

export async function createMidtransSnapOrder(input: SubscriptionSnapOrder) {
  const environment = getEnvironment();
  const origin = await getApplicationUrl();
  const finishUrl = new URL("/subscription/payment", origin);
  finishUrl.searchParams.set("order_id", input.orderId);
  const notificationUrl = new URL("/api/midtrans/subscription-notifications", origin).toString();
  const now = new Date();
  const auth = Buffer.from(`${environment.serverKey}:`).toString("base64");

  const response = await fetch(`${environment.apiBaseUrl}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
      "X-Append-Notification": notificationUrl,
    },
    body: JSON.stringify({
      transaction_details: { order_id: input.orderId, gross_amount: input.amount },
      item_details: [{
        id: input.orderId,
        price: input.amount,
        quantity: 1,
        name: input.planName.slice(0, 50),
      }],
      customer_details: {
        first_name: input.customerName.trim().slice(0, 50),
        email: input.customerEmail,
      },
      enabled_payments: ["other_qris", "bank_transfer"],
      callbacks: { finish: finishUrl.toString(), error: finishUrl.toString() },
      expiry: { start_time: jakartaTimestamp(now), unit: "hours", duration: 24 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  const payload = await response.json().catch(() => ({})) as SnapCreateResponse;
  if (!response.ok || !payload.token || !payload.redirect_url) {
    throw new Error(`Midtrans could not create checkout (HTTP ${response.status}).`);
  }
  return {
    token: payload.token,
    redirectUrl: trustedMidtransRedirect(payload.redirect_url, environment.isProduction),
    transactionId: payload.transaction_id ?? null,
  };
}

export function verifyMidtransNotificationSignature(input: {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
}) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
  if (!serverKey || !input.order_id || !input.status_code || !input.gross_amount || !input.signature_key) return false;
  if (!/^[a-f0-9]{128}$/i.test(input.signature_key)) return false;
  const expected = createHash("sha512")
    .update(input.order_id + input.status_code + input.gross_amount + serverKey, "utf8")
    .digest();
  const supplied = Buffer.from(input.signature_key, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function getAuthoritativeMidtransStatus(orderId: string): Promise<MidtransStatusResponse> {
  const environment = getEnvironment();
  if (!/^[A-Za-z0-9._~-]{1,50}$/.test(orderId)) throw new Error("Invalid Midtrans order reference.");
  const auth = Buffer.from(`${environment.serverKey}:`).toString("base64");
  const response = await fetch(
    `${environment.apiBaseUrl.replace("app.", "api.")}/v2/${encodeURIComponent(orderId)}/status`,
    { headers: { accept: "application/json", authorization: `Basic ${auth}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`Midtrans status verification failed (HTTP ${response.status}).`);
  return await response.json() as MidtransStatusResponse;
}

export function mapMidtransPaymentStatus(status: MidtransStatusResponse): "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" {
  const transactionStatus = status.transaction_status?.toLowerCase();
  if (transactionStatus === "settlement") return "PAID";
  if (transactionStatus === "capture") {
    return !status.fraud_status || status.fraud_status.toLowerCase() === "accept" ? "PAID" : "PENDING";
  }
  if (transactionStatus === "expire") return "EXPIRED";
  if (transactionStatus === "cancel") return "CANCELLED";
  if (transactionStatus === "deny" || transactionStatus === "failure") return "FAILED";
  return "PENDING";
}

export function isMidtransPaymentSuccessful(status: MidtransStatusResponse) {
  const transactionStatus = status.transaction_status?.toLowerCase();
  return status.status_code === "200"
    && (transactionStatus === "settlement" || transactionStatus === "capture")
    && (!status.fraud_status || status.fraud_status.toLowerCase() === "accept");
}

export function isMidtransProduction() {
  return process.env.MIDTRANS_IS_PRODUCTION?.trim().toLowerCase() === "true";
}

export function parseIdrMinorUnits(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return BigInt(match[1]) * BigInt(100) + BigInt(fraction || "0");
}

import { headers } from "next/headers";

function normalizeUrl(value: string) {
  const url = value.trim();
  if (!url) return null;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function originFrom(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS in production.`);
  }
  return parsed.origin;
}

/** The public application origin used by Supabase Auth email redirects. */
export async function getApplicationUrl() {
  const configured = normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (configured) return originFrom(configured, "NEXT_PUBLIC_SITE_URL");

  const vercelUrl = normalizeUrl(process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL ?? "");
  if (vercelUrl) return originFrom(vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`, "VERCEL_URL");

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL is required in production for invitation redirects.");
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return "http://localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const localUrl = `${protocol}://${host}`;
  const parsed = new URL(localUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Configure NEXT_PUBLIC_SITE_URL before sending invitations from this host.");
  }
  return originFrom(localUrl, "local application URL");
}

export async function getInviteRedirectUrl() {
  return new URL("/accept-invite", await getApplicationUrl()).toString();
}

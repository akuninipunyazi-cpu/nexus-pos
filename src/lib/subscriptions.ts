export const EXPIRING_SOON_WINDOW_DAYS = 30;

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "SUSPENDED";

export function getSubscriptionStatus(expiresAt: string, now = new Date(), storedStatus?: string): SubscriptionStatus {
  const expires = new Date(expiresAt).getTime();
  const current = now.getTime();
  const window = EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  if (expires <= current) return "EXPIRED";
  if (storedStatus === "EXPIRED") return "EXPIRED";
  if (storedStatus === "SUSPENDED") return "SUSPENDED";
  if (storedStatus === "TRIAL") return "TRIAL";
  if (expires <= current + window) return "EXPIRING_SOON";
  return "ACTIVE";
}

export function formatRemainingTime(expiresAt: string, now = new Date()): string {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return "Expired";

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} remaining`;
  return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

import Link from "next/link";
import { OwnerDashboard } from "@/components/store/owner-dashboard";
import { getAnalyticsPeriod, getStoreAnalytics } from "@/lib/analytics";
import { getStoreIdentity, requireStoreOwner } from "@/lib/store";

export default async function StoreDashboardPage() {
  const { tenantId } = await requireStoreOwner();
  const [identity, data] = await Promise.all([
    getStoreIdentity(tenantId),
    getStoreAnalytics("today", "revenue"),
  ]);

  if (!data) {
    return (
      <div className="large-empty">
        <p className="eyebrow">Store workspace</p>
        <h1 className="page-title">{identity.name}</h1>
        <div className="plain-empty">
          <h2>Dashboard unavailable.</h2>
          <p>The server could not load the store overview. No values were fabricated.</p>
          <Link href="/store/analytics">Open analytics</Link>
        </div>
      </div>
    );
  }

  return (
    <OwnerDashboard
      data={data}
      storeName={identity.name}
      periodLabel={getAnalyticsPeriod("today").label}
    />
  );
}

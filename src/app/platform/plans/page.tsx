import { PlanManagement } from "@/components/platform/plan-management";
import { getPlatformPlans } from "@/lib/platform";

export default async function SubscriptionPlansPage() {
  const plans = await getPlatformPlans();
  return <><p className="eyebrow">Platform</p><h1 className="page-title">Subscription plans</h1><p className="page-intro">Define duration, price, and tenant resource limits. Blank limits explicitly mean unlimited.</p><PlanManagement plans={plans}/></>;
}

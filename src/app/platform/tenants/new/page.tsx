import { CreateTenantForm } from "@/components/create-tenant-form";
import { getPlatformPlans } from "@/lib/platform";

export default async function NewTenantPage() { const plans = (await getPlatformPlans()).filter((plan) => plan.is_active); return <><p className="eyebrow">Platform / tenants</p><h1 className="page-title">Create a tenant.</h1><p className="page-intro">Set up the store boundary, invite its Store Owner, and attach the first subscription in one transaction.</p><CreateTenantForm plans={plans} /></>; }

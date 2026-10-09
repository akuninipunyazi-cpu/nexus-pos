import { StaffManagement } from "@/components/store/staff-management";
import { requireStoreOwner } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";
import { getTenantUsageSummary } from "@/lib/tenant-usage";
import { SubscriptionUsage } from "@/components/store/subscription-usage";
export default async function StaffPage(){const {tenantId}=await requireStoreOwner();const supabase=await createClient();const [result,usage]=await Promise.all([supabase.from("profiles").select("id,full_name,email,role,is_active").eq("tenant_id",tenantId).in("role",["CASHIER","KITCHEN_ADMIN"]).order("created_at",{ascending:false}),getTenantUsageSummary()]);return <><p className="eyebrow">Store workspace</p><h1 className="page-title">Staff</h1><p className="page-intro">Invite the people assigned to this tenant. Roles stay inside the existing platform model.</p><SubscriptionUsage summary={usage}/><StaffManagement staff={result.data??[]}/></>}

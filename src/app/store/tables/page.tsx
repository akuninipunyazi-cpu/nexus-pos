import { TableManagement } from "@/components/store/table-management";
import { requireStoreOwner, getStoreIdentity } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";
import { getTenantUsageSummary } from "@/lib/tenant-usage";
import { SubscriptionUsage } from "@/components/store/subscription-usage";
export default async function TablesPage(){const {tenantId}=await requireStoreOwner();const [identity,result,usage]=await Promise.all([getStoreIdentity(tenantId),createClient().then(client=>client.from("tables").select("id,table_number,public_token,status").eq("tenant_id",tenantId).order("table_number")),getTenantUsageSummary()]);return <><p className="eyebrow">Store workspace</p><h1 className="page-title">Tables</h1><p className="page-intro">Each active table gets a secure public URL. Copy it for a QR code or encode the same URL into an NFC tag.</p><SubscriptionUsage summary={usage}/><TableManagement tables={result.data??[]} tenantSlug={identity.slug}/></>}

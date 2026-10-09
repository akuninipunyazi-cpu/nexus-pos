import { ProductManagement } from "@/components/store/product-management";
import { requireStoreOwner } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";
import { getTenantUsageSummary } from "@/lib/tenant-usage";
import { SubscriptionUsage } from "@/components/store/subscription-usage";
export default async function ProductsPage(){const {tenantId}=await requireStoreOwner();const supabase=await createClient();const [products,categories,usage]=await Promise.all([supabase.from("products").select("id,category_id,name,description,price,image_url,is_active").eq("tenant_id",tenantId).order("name"),supabase.from("categories").select("id,name,is_active").eq("tenant_id",tenantId).order("name"),getTenantUsageSummary()]);return <><p className="eyebrow">Store workspace</p><h1 className="page-title">Products</h1><p className="page-intro">Set the active menu and its exact selling prices. Product images remain optional until storage is configured.</p><SubscriptionUsage summary={usage}/><ProductManagement products={products.data??[]} categories={categories.data??[]}/></>}

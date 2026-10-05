import { TakeawayForm } from "@/components/cashier/takeaway-form";
import { requireCashier } from "@/lib/cashier";
import { createClient } from "@/lib/supabase/server";

export default async function TakeawayPage(){const {tenantId}=await requireCashier();const supabase=await createClient();const result=await supabase.from("products").select("id,name,price,category_id").eq("tenant_id",tenantId).eq("is_active",true).order("name");return <><p className="eyebrow">Cashier</p><h1 className="page-title">New takeaway</h1><p className="page-intro">Create a takeaway order without assigning a table.</p><TakeawayForm products={result.data??[]}/></>}
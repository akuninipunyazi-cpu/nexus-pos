import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function requireStoreOwner() { const context=await requireRole(["STORE_OWNER"]); if(!context.profile.tenant_id) throw new Error("Store Owner is not attached to a tenant."); return {context,tenantId:context.profile.tenant_id}; }
export async function getStoreIdentity(tenantId:string) { const supabase=await createClient(); const result=await supabase.from("tenants").select("name,slug").eq("id",tenantId).single(); if(result.error||!result.data)throw new Error("Tenant could not be loaded."); return result.data; }
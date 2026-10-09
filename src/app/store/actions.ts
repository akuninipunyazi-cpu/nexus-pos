"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getInviteRedirectUrl } from "@/lib/site-url";
import { createPartnerMerchant, isMidtransPartnerConfigured, MidtransPartnerRequestError } from "@/lib/midtrans-partner";

type ActionResult = { error?: string; success?: string };
const staffRoles = ["CASHIER", "KITCHEN_ADMIN"] as const;
function text(value: FormDataEntryValue | null, label: string) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function tenantId(context: Awaited<ReturnType<typeof requireRole>>) { if (!context.profile.tenant_id) throw new Error("Your account is not attached to a tenant."); return context.profile.tenant_id; }
function price(value: FormDataEntryValue | null) { const result = text(value, "Price"); if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(result)) throw new Error("Price must be a non-negative amount with up to two decimals."); return result; }
function mutationError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const limit = message.match(/PLAN_LIMIT:(STAFF|PRODUCTS|TABLES):([A-Z0-9_-]+):(\d+)/i);
  if (limit) {
    const label = limit[1] === "STAFF" ? "Staff" : limit[1] === "PRODUCTS" ? "Product" : "Table";
    return `${label} limit for plan ${limit[2].toUpperCase()} reached. Maximum ${limit[3]}.`;
  }
  return fallback;
}

export async function inviteStaff(formData: FormData): Promise<ActionResult> {
  const context = await requireRole(["STORE_OWNER"]); const id = tenantId(context); let authId: string | null = null;
  try { const email=text(formData.get("email"),"Email").toLowerCase(); const name=text(formData.get("fullName"),"Full name"); const role=text(formData.get("role"),"Role"); if(!staffRoles.includes(role as typeof staffRoles[number])) throw new Error("Only Cashier or Kitchen Admin staff can be invited."); const admin=createAdminClient(); const invitation=await admin.auth.admin.inviteUserByEmail(email,{data:{full_name:name},redirectTo:await getInviteRedirectUrl()}); if(invitation.error||!invitation.data.user) throw new Error(invitation.error?.message??"Staff invitation failed."); authId=invitation.data.user.id; const supabase=await createClient(); const profile=await supabase.from("profiles").insert({id:authId,tenant_id:id,role,full_name:name,email,is_active:true}); if(profile.error) throw new Error(profile.error.message); revalidatePath("/store/staff"); return {success:"Staff invitation sent."}; }
  catch(error){ if(authId){try{await createAdminClient().auth.admin.deleteUser(authId)}catch(cleanup){console.error("Staff Auth cleanup failed",cleanup)}} return {error:mutationError(error,"Staff invitation failed.")}; }
}

export async function beginPartnerMerchantOnboarding(): Promise<ActionResult> {
  const context = await requireRole(["STORE_OWNER"]);
  const id = tenantId(context);
  if (!isMidtransPartnerConfigured()) return { error: "Midtrans Partner is not configured yet. Contact the platform administrator." };
  const admin = createAdminClient();
  const existing = await admin.from("payment_accounts")
    .select("id,status,provider_merchant_id,onboarding_started_at")
    .eq("tenant_id", id).maybeSingle();
  if (existing.error) return { error: "Payment settings could not be loaded." };
  if (existing.data) {
    if (existing.data.status === "SUBMITTED") return { success: "Your merchant details have been submitted and are awaiting Midtrans verification." };
    if (existing.data.status === "ACTIVE") return { success: "Midtrans QRIS is active for this store." };
    if (existing.data.onboarding_started_at) return { error: "Merchant registration is being checked. Contact the platform administrator before retrying." };
    return { error: "This merchant application needs platform review before it can be resubmitted." };
  }

  const tenant = await admin.from("tenants").select("name").eq("id", id).maybeSingle();
  const owner = await admin.from("profiles").select("email,full_name").eq("id", context.user.id).eq("tenant_id", id).eq("role", "STORE_OWNER").maybeSingle();
  if (tenant.error || !tenant.data || owner.error || !owner.data?.email) return { error: "Store owner details could not be verified." };

  const startedAt = new Date().toISOString();
  const claim = await admin.from("payment_accounts").insert({
    tenant_id: id, merchant_name: tenant.data.name, status: "PENDING", onboarding_started_at: startedAt,
  }).select("id").single();
  if (claim.error || !claim.data) return { error: "A merchant registration is already in progress for this store." };

  try {
    const merchant = await createPartnerMerchant({ email: owner.data.email, ownerName: owner.data.full_name ?? tenant.data.name, storeName: tenant.data.name });
    const saved = await admin.from("payment_accounts").update({
      provider_merchant_id: merchant.merchantId, merchant_name: merchant.merchantName,
      status: "SUBMITTED", updated_at: new Date().toISOString(),
    }).eq("id", claim.data.id).eq("tenant_id", id);
    if (saved.error) return { error: "Midtrans received the application, but its reference could not be saved. Contact the platform administrator; do not submit it again." };
    revalidatePath("/store/settings/payments");
    revalidatePath("/platform/payment-accounts");
    return { success: "Merchant details submitted. QRIS will be available after the platform confirms Midtrans activation." };
  } catch (error) {
    if (error instanceof MidtransPartnerRequestError) {
      await admin.from("payment_accounts").delete().eq("id", claim.data.id).eq("tenant_id", id).is("provider_merchant_id", null);
      return { error: "Midtrans did not accept the application. Check the merchant profile and contact the platform administrator." };
    }
    return { error: "The registration response could not be confirmed. Contact the platform administrator before retrying." };
  }
}

export async function setStaffActive(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try { const supabase=await createClient(); const updated=await supabase.from("profiles").update({is_active:String(formData.get("isActive"))==="true"}).eq("id",text(formData.get("userId"),"Staff user")).eq("tenant_id",tenantId(context)).in("role",["CASHIER","KITCHEN_ADMIN"]); if(updated.error)throw new Error(updated.error.message); revalidatePath("/store/staff"); return {success:"Staff status updated."}; } catch(error){return {error:mutationError(error,"Staff status update failed.")};} }

export async function createCategory(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient(); const result=await supabase.from("categories").insert({tenant_id:tenantId(context),name:text(formData.get("name"),"Category name")});if(result.error)throw new Error(result.error.message);revalidatePath("/store/categories");return {success:"Category created."};}catch(error){return {error:error instanceof Error?error.message:"Category could not be created."};} }
export async function updateCategory(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient(); const result=await supabase.from("categories").update({name:text(formData.get("name"),"Category name"),is_active:String(formData.get("isActive"))!=="false"}).eq("id",text(formData.get("categoryId"),"Category")).eq("tenant_id",tenantId(context));if(result.error)throw new Error(result.error.message);revalidatePath("/store/categories");return {success:"Category updated."};}catch(error){return {error:error instanceof Error?error.message:"Category could not be updated."};} }

async function categoryForTenant(categoryId: string, id: string) { const supabase=await createClient(); const category=await supabase.from("categories").select("id").eq("id",categoryId).eq("tenant_id",id).maybeSingle(); if(category.error||!category.data)throw new Error("Category does not belong to this tenant."); }
export async function toggleCategory(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient();const categoryId=text(formData.get("categoryId"),"Category");const category=await supabase.from("categories").select("is_active").eq("id",categoryId).eq("tenant_id",tenantId(context)).maybeSingle();if(category.error||!category.data)throw new Error("Category not found.");const result=await supabase.from("categories").update({is_active:!category.data.is_active}).eq("id",categoryId).eq("tenant_id",tenantId(context));if(result.error)throw new Error(result.error.message);revalidatePath("/store/categories");revalidatePath("/store/products");return {success:category.data.is_active?"Category archived.":"Category activated."};}catch(error){return {error:error instanceof Error?error.message:"Category status could not be updated."};} }
export async function createProduct(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const id=tenantId(context);const categoryId=text(formData.get("categoryId"),"Category");await categoryForTenant(categoryId,id);const supabase=await createClient();const result=await supabase.from("products").insert({tenant_id:id,category_id:categoryId,name:text(formData.get("name"),"Product name"),description:String(formData.get("description")??"").trim()||null,price:price(formData.get("price")),image_url:String(formData.get("imageUrl")??"").trim()||null,is_active:true});if(result.error)throw new Error(result.error.message);revalidatePath("/store/products");revalidatePath("/store/dashboard");return {success:"Product created."};}catch(error){return {error:mutationError(error,"Product could not be created.")};} }
export async function updateProduct(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const id=tenantId(context), productId=text(formData.get("productId"),"Product");const categoryId=text(formData.get("categoryId"),"Category");await categoryForTenant(categoryId,id);const supabase=await createClient();const result=await supabase.from("products").update({category_id:categoryId,name:text(formData.get("name"),"Product name"),description:String(formData.get("description")??"").trim()||null,price:price(formData.get("price")),image_url:String(formData.get("imageUrl")??"").trim()||null,is_active:String(formData.get("isActive"))!=="false",updated_at:new Date().toISOString()}).eq("id",productId).eq("tenant_id",id);if(result.error)throw new Error(result.error.message);revalidatePath("/store/products");revalidatePath("/store/dashboard");return {success:"Product updated."};}catch(error){return {error:mutationError(error,"Product could not be updated.")};} }

export async function toggleProduct(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const id=tenantId(context), productId=text(formData.get("productId"),"Product");const supabase=await createClient();const product=await supabase.from("products").select("is_active").eq("id",productId).eq("tenant_id",id).maybeSingle();if(product.error||!product.data)throw new Error("Product not found.");const result=await supabase.from("products").update({is_active:!product.data.is_active,updated_at:new Date().toISOString()}).eq("id",productId).eq("tenant_id",id);if(result.error)throw new Error(result.error.message);revalidatePath("/store/products");revalidatePath("/store/dashboard");return {success:product.data.is_active?"Product archived.":"Product activated."};}catch(error){return {error:mutationError(error,"Product status could not be updated.")};} }
export async function createTable(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient();const result=await supabase.from("tables").insert({tenant_id:tenantId(context),table_number:text(formData.get("tableNumber"),"Table number")});if(result.error)throw new Error(result.error.message);revalidatePath("/store/tables");revalidatePath("/store/dashboard");return {success:"Table created."};}catch(error){return {error:mutationError(error,"Table could not be created.")};} }
export async function updateTable(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient();const result=await supabase.from("tables").update({table_number:text(formData.get("tableNumber"),"Table number"),status:String(formData.get("status"))==="ACTIVE"?"ACTIVE":"INACTIVE"}).eq("id",text(formData.get("tableId"),"Table")).eq("tenant_id",tenantId(context));if(result.error)throw new Error(result.error.message);revalidatePath("/store/tables");revalidatePath("/store/dashboard");return {success:"Table updated."};}catch(error){return {error:mutationError(error,"Table could not be updated.")};} }
export async function regenerateTableToken(formData: FormData): Promise<ActionResult> { const context=await requireRole(["STORE_OWNER"]); try {const supabase=await createClient();const result=await supabase.from("tables").update({public_token:randomUUID().replaceAll("-","")}).eq("id",text(formData.get("tableId"),"Table")).eq("tenant_id",tenantId(context));if(result.error)throw new Error(result.error.message);revalidatePath("/store/tables");return {success:"Public ordering identity regenerated."};}catch(error){return {error:error instanceof Error?error.message:"Table identity could not be regenerated."};} }

export async function markOwnerNotificationRead(formData: FormData): Promise<ActionResult> {
  const context = await requireRole(["STORE_OWNER"]);
  try {
    const id = text(formData.get("notificationId"), "Notification");
    const idTenant = tenantId(context);
    const supabase = await createClient();
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", context.profile.id).eq("tenant_id", idTenant).is("read_at", null);
    if (error) throw new Error("Notification could not be updated.");
    revalidatePath("/store/dashboard");
    return { success: "Notification marked as read." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Notification could not be updated." };
  }
}

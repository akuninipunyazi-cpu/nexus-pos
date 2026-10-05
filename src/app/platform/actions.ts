"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getInviteRedirectUrl } from "@/lib/site-url";

type ActionResult = { error?: string; success?: string };

function requiredText(value: FormDataEntryValue | null, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseDate(value: FormDataEntryValue | null, label: string) {
  const date = new Date(requiredText(value, label));
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

export async function createTenant(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  let invitedUserId: string | null = null;
  try {
    const storeName = requiredText(formData.get("storeName"), "Store name");
    const slug = requiredText(formData.get("slug"), "Store slug").toLowerCase();
    const ownerName = requiredText(formData.get("ownerName"), "Store Owner name");
    const ownerEmail = requiredText(formData.get("ownerEmail"), "Store Owner email").toLowerCase();
    const planName = requiredText(formData.get("planName"), "Plan name");
    const amount = Number(requiredText(formData.get("amount"), "Amount"));
    const currency = requiredText(formData.get("currency"), "Currency").toUpperCase();
    const startedAt = parseDate(formData.get("startedAt"), "Start date");
    const expiresAt = parseDate(formData.get("expiresAt"), "Expiry date");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Store slug can use lowercase letters, numbers, and hyphens.");
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be zero or greater.");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code.");
    if (new Date(expiresAt) <= new Date(startedAt)) throw new Error("Expiry must be after the start date.");

    const admin = createAdminClient();
    const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, { data: { full_name: ownerName }, redirectTo: await getInviteRedirectUrl() });
    if (invitationError || !invitation.user) throw new Error(invitationError?.message ?? "The Store Owner invitation could not be created.");
    invitedUserId = invitation.user.id;

    const supabase = await createClient();
    const { error: transactionError } = await supabase.rpc("create_tenant_with_owner", {
      p_owner_user_id: invitedUserId, p_owner_email: ownerEmail, p_owner_name: ownerName,
      p_store_name: storeName, p_slug: slug, p_plan_name: planName, p_amount: amount,
      p_currency: currency, p_started_at: startedAt, p_expires_at: expiresAt,
    });
    if (transactionError) {
      await admin.auth.admin.deleteUser(invitedUserId);
      throw new Error(transactionError.message);
    }
    revalidatePath("/platform"); revalidatePath("/platform/tenants"); revalidatePath("/platform/subscriptions");
    return { success: "Tenant created and Store Owner invitation sent." };
  } catch (error) {
    if (invitedUserId) {
      try { await createAdminClient().auth.admin.deleteUser(invitedUserId); }
      catch (cleanupError) { console.error("Failed to clean up invited user after tenant creation failure", cleanupError); }
    }
    const message = error instanceof Error ? error.message : "Tenant creation failed.";
    return { error: message.includes("SUPABASE_SERVICE_ROLE_KEY") ? "Server configuration is incomplete: SUPABASE_SERVICE_ROLE_KEY is required to invite a Store Owner." : message };
  }
}

export async function recordSubscriptionRevenue(formData: FormData): Promise<ActionResult> {
  const context = await requireRole(["SUPER_ADMIN"]);
  try {
    const subscriptionId = requiredText(formData.get("subscriptionId"), "Subscription");
    const amount = Number(requiredText(formData.get("amount"), "Amount"));
    const reference = String(formData.get("reference") ?? "").trim() || null;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be zero or greater.");
    const supabase = await createClient();
    const { data: subscription } = await supabase.from("subscriptions").select("id, tenant_id, currency").eq("id", subscriptionId).maybeSingle();
    if (!subscription) throw new Error("Subscription could not be found.");
    const { error } = await supabase.from("subscription_revenue_records").insert({ tenant_id: subscription.tenant_id, subscription_id: subscription.id, amount, currency: subscription.currency, recorded_by: context.profile.id, reference });
    if (error) throw new Error(error.message);
    revalidatePath("/platform"); revalidatePath("/platform/revenue");
    return { success: "Revenue record added." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Revenue could not be recorded." }; }
}

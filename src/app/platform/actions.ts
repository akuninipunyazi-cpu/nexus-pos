"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getInviteRedirectUrl } from "@/lib/site-url";

type ActionResult = { error?: string; success?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredText(value: FormDataEntryValue | null, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseDate(value: FormDataEntryValue | null, label: string) {
  const raw = requiredText(value, label);
  // datetime-local has no zone; interpret it consistently as the product's
  // established Asia/Jakarta business timezone rather than the server's UTC.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00+07:00` : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function parsePlanPrice(value: FormDataEntryValue | null) {
  const amount = requiredText(value, "Price");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) throw new Error("Price must be a non-negative amount with up to two decimals.");
  return amount;
}

export async function createTenant(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  let invitedUserId: string | null = null;
  try {
    const storeName = requiredText(formData.get("storeName"), "Store name");
    const slug = requiredText(formData.get("slug"), "Store slug").toLowerCase();
    const ownerName = requiredText(formData.get("ownerName"), "Store Owner name");
    const ownerEmail = requiredText(formData.get("ownerEmail"), "Store Owner email").toLowerCase();
    const planId = requiredText(formData.get("planId"), "Subscription plan");
    const startedAt = parseDate(formData.get("startedAt"), "Start date");
    const isTrial = String(formData.get("isTrial")) === "true";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Store slug can use lowercase letters, numbers, and hyphens.");

    const admin = createAdminClient();
    const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, { data: { full_name: ownerName }, redirectTo: await getInviteRedirectUrl() });
    if (invitationError || !invitation.user) throw new Error("The Store Owner invitation could not be sent.");
    invitedUserId = invitation.user.id;

    const supabase = await createClient();
    const { error: transactionError } = await supabase.rpc("create_tenant_with_owner_plan", {
      p_owner_user_id: invitedUserId, p_owner_email: ownerEmail, p_owner_name: ownerName,
      p_store_name: storeName, p_slug: slug, p_plan_id: planId,
      p_started_at: startedAt, p_is_trial: isTrial,
    });
    if (transactionError) {
      throw new Error("Tenant could not be created. Check the store details and selected plan.");
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

function parsePlanLimit(value: FormDataEntryValue | null, label: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number or left blank for unlimited.`);
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return number;
}

export async function createSubscriptionPlan(formData: FormData): Promise<ActionResult> {
  const context = await requireRole(["SUPER_ADMIN"]);
  try {
    const name = requiredText(formData.get("name"), "Plan name");
    const code = requiredText(formData.get("code"), "Plan code").toLowerCase();
    const price = parsePlanPrice(formData.get("price"));
    const durationDays = Number(requiredText(formData.get("durationDays"), "Duration"));
    const currency = requiredText(formData.get("currency"), "Currency").toUpperCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) throw new Error("Plan code must use lowercase letters, numbers, and hyphens.");
    if (!Number.isSafeInteger(durationDays) || durationDays < 1) throw new Error("Duration must be at least one day.");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code.");
    const supabase = await createClient();
    const { error } = await supabase.from("subscription_plans").insert({
      name, code, price, currency, duration_days: durationDays,
      max_staff: parsePlanLimit(formData.get("maxStaff"), "Staff limit"),
      max_products: parsePlanLimit(formData.get("maxProducts"), "Product limit"),
      max_tables: parsePlanLimit(formData.get("maxTables"), "Table limit"),
      created_by: context.profile.id,
    });
    if (error) throw new Error(error.code === "23505" ? "A plan with this code already exists." : "Plan could not be created.");
    revalidatePath("/platform/plans"); revalidatePath("/platform/tenants/new"); revalidatePath("/platform/subscriptions");
    return { success: "Subscription plan created." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Plan could not be created." }; }
}

export async function updateSubscriptionPlan(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  try {
    const id = requiredText(formData.get("planId"), "Plan");
    const name = requiredText(formData.get("name"), "Plan name");
    const price = parsePlanPrice(formData.get("price"));
    const durationDays = Number(requiredText(formData.get("durationDays"), "Duration"));
    const currency = requiredText(formData.get("currency"), "Currency").toUpperCase();
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || !/^[A-Z]{3}$/.test(currency)) throw new Error("Check the plan price, currency, and duration.");
    const supabase = await createClient();
    const { error } = await supabase.from("subscription_plans").update({
      name, price, currency, duration_days: durationDays,
      max_staff: parsePlanLimit(formData.get("maxStaff"), "Staff limit"),
      max_products: parsePlanLimit(formData.get("maxProducts"), "Product limit"),
      max_tables: parsePlanLimit(formData.get("maxTables"), "Table limit"),
    }).eq("id", id);
    if (error) throw new Error("Plan could not be updated.");
    revalidatePath("/platform/plans"); revalidatePath("/platform/subscriptions"); revalidatePath("/store/dashboard");
    return { success: "Plan updated." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Plan could not be updated." }; }
}

export async function setSubscriptionPlanActive(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  try {
    const id = requiredText(formData.get("planId"), "Plan");
    const isActive = String(formData.get("isActive")) === "true";
    const supabase = await createClient();
    const { error } = await supabase.from("subscription_plans").update({ is_active: !isActive }).eq("id", id);
    if (error) throw new Error("Plan status could not be changed.");
    revalidatePath("/platform/plans"); revalidatePath("/platform/tenants/new"); revalidatePath("/platform/subscriptions");
    return { success: isActive ? "Plan deactivated." : "Plan activated." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Plan status could not be changed." }; }
}

export async function assignSubscriptionPlan(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  try {
    const tenantId = requiredText(formData.get("tenantId"), "Tenant");
    const planId = requiredText(formData.get("planId"), "Plan");
    const requestedStatus = String(formData.get("status"));
    if (requestedStatus !== "TRIAL" && requestedStatus !== "ACTIVE" && requestedStatus !== "SUSPENDED") throw new Error("Choose a valid subscription status.");
    const status = requestedStatus;
    const startedAt = parseDate(formData.get("startedAt"), "Start date");
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_tenant_subscription", {
      p_tenant_id: tenantId, p_plan_id: planId, p_status: status, p_started_at: startedAt,
    });
    if (error) throw new Error(error.code === "P0001" ? "Tenant or active subscription plan could not be found." : "Subscription could not be assigned.");
    revalidatePath("/platform"); revalidatePath("/platform/tenants"); revalidatePath("/platform/subscriptions");
    return { success: "Subscription assigned." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Subscription could not be assigned." }; }
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
    if (error) throw new Error("Revenue record could not be saved.");
    revalidatePath("/platform"); revalidatePath("/platform/revenue");
    return { success: "Revenue record added." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Revenue could not be recorded." }; }
}

async function processTenantAuthCleanup(jobId: string): Promise<{ pendingAccounts: number | null }> {
  try {
    const admin = createAdminClient();
    const supabase = await createClient();
    const { data: job, error: jobError } = await admin
      .from("tenant_auth_cleanup_jobs")
      .select("pending_auth_user_ids")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) return { pendingAccounts: null };
    if (!job) return { pendingAccounts: 0 };

    for (const userId of job.pending_auth_user_ids as string[]) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) {
        const { data: existingUser, error: lookupError } = await admin.auth.admin.getUserById(userId);
        const alreadyDeleted = !lookupError && !existingUser.user;
        const notFound = lookupError?.status === 404;
        if (!alreadyDeleted && !notFound) continue;
      }

      // The database only acknowledges IDs placed in this protected job by
      // delete_tenant_data; browser input cannot choose an Auth user to remove.
      const { error: acknowledgementError } = await supabase.rpc("ack_tenant_auth_cleanup_user", {
        p_job_id: jobId,
        p_user_id: userId,
      });
      if (acknowledgementError) continue;
    }

    const { data: remainingJob, error: remainingError } = await admin
      .from("tenant_auth_cleanup_jobs")
      .select("pending_auth_user_ids")
      .eq("id", jobId)
      .maybeSingle();
    if (remainingError) return { pendingAccounts: null };
    return { pendingAccounts: remainingJob?.pending_auth_user_ids.length ?? 0 };
  } catch {
    return { pendingAccounts: null };
  }
}

export async function deleteTenant(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const confirmedSlug = String(formData.get("confirmedSlug") ?? "").trim();
  if (!UUID_PATTERN.test(tenantId)) return { error: "Tenant selection is invalid." };
  if (!confirmedSlug || confirmedSlug.length > 120) return { error: "Enter the tenant slug to confirm deletion." };

  let data: unknown;
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("delete_tenant_data", {
      p_tenant_id: tenantId,
      p_confirmed_slug: confirmedSlug,
    });
    if (result.error) return { error: "Tenant was not deleted. Check the confirmation and try again." };
    data = result.data;
  } catch {
    return { error: "Tenant was not deleted. Check the confirmation and try again." };
  }
  if (!data) return { error: "Tenant was not deleted. Check the confirmation and try again." };

  const result = data as { cleanup_job_id: string | null; login_account_count: number };
  const cleanup = result.cleanup_job_id
    ? await processTenantAuthCleanup(result.cleanup_job_id)
    : { pendingAccounts: 0 };

  revalidatePath("/platform");
  revalidatePath("/platform/tenants");
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform/subscriptions");
  revalidatePath("/platform/audit-logs");

  if (cleanup.pendingAccounts === 0) {
    return { success: `Tenant and its ${result.login_account_count} linked login account(s) were permanently deleted.` };
  }
  if (cleanup.pendingAccounts === null) {
    return { success: "Tenant data was deleted. Some linked login accounts still need server cleanup; use the pending cleanup section to retry." };
  }
  return { success: `Tenant data was deleted. ${cleanup.pendingAccounts} linked login account(s) still need cleanup; use the pending cleanup section to retry.` };
}

export async function retryTenantAuthCleanup(formData: FormData): Promise<ActionResult> {
  await requireRole(["SUPER_ADMIN"]);
  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!UUID_PATTERN.test(jobId)) return { error: "Cleanup request is invalid." };

  const cleanup = await processTenantAuthCleanup(jobId);
  if (cleanup.pendingAccounts === 0) return { success: "All remaining login accounts were deleted." };
  if (cleanup.pendingAccounts === null) return { error: "Account cleanup could not be completed. Please retry." };
  return { error: `${cleanup.pendingAccounts} login account(s) remain. Please retry cleanup.` };
}

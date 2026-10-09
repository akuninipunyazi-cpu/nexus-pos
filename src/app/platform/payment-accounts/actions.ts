"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function updatePartnerMerchantStatus(formData: FormData): Promise<{ error?: string; success?: string }> {
  await requireRole(["SUPER_ADMIN"]);
  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (formData.get("confirmed") !== "yes") return { error: "Confirm the status in Midtrans before saving." };
  if (!merchantId || merchantId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(merchantId)) return { error: "Merchant reference is invalid." };
  if (!["ACTIVE", "SUSPENDED", "REJECTED"].includes(status)) return { error: "Merchant status is invalid." };
  const supabase = await createClient();
  const result = await supabase.rpc("set_midtrans_partner_merchant_status", {
    p_provider_merchant_id: merchantId,
    p_status: status,
  });
  if (result.error || !result.data) return { error: "Merchant status could not be updated." };
  revalidatePath("/platform/payment-accounts");
  revalidatePath("/store/settings/payments");
  revalidatePath("/order");
  return { success: `Merchant status set to ${status}.` };
}

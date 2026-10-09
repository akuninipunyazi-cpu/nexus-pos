"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMidtransSnapOrder, getMidtransBrowserConfig, trustedMidtransRedirect } from "@/lib/midtrans";
import { redirect } from "next/navigation";

type CheckoutResult = {
  error?: string;
  orderId?: string;
  snapToken?: string;
  redirectUrl?: string;
  clientKey?: string;
  snapScriptUrl?: string;
};

function field(formData: FormData, key: string, max: number) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > max) throw new Error("invalid input");
  return value;
}

export async function signOutAndContinueRegistration(formData: FormData): Promise<never> {
  const planCode = String(formData.get("planCode") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(planCode)) redirect("/register");

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) redirect(`/register?plan=${encodeURIComponent(planCode)}&state=signout_failed`);

  redirect(`/register?plan=${encodeURIComponent(planCode)}`);
}

export async function startSubscriptionCheckout(formData: FormData): Promise<CheckoutResult> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.email || !user.email_confirmed_at) {
      return { error: "Masuk dan verifikasi email terlebih dahulu sebelum checkout." };
    }

    const planCode = field(formData, "planCode", 64).toLowerCase();
    const ownerName = field(formData, "ownerName", 120);
    const storeName = field(formData, "storeName", 120);
    const expectedAmount = field(formData, "expectedAmount", 32);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(planCode)) return { error: "Paket tidak valid. Pilih paket yang tersedia." };
    if (!/^\d{1,12}$/.test(expectedAmount)) return { error: "Harga paket tidak valid. Muat ulang halaman paket." };

    // Fail before creating a pending order if deployment credentials are absent.
    const browserConfig = getMidtransBrowserConfig();
    const { data: orderData, error: orderError } = await supabase.rpc("create_self_service_subscription_order", {
      p_plan_code: planCode,
      p_owner_name: ownerName,
      p_store_name: storeName,
      p_expected_amount: expectedAmount,
    });
    if (orderError?.message.includes("plan price changed")) {
      return { error: "Harga paket baru saja berubah. Muat ulang halaman paket sebelum membayar." };
    }
    if (orderError || !orderData || typeof orderData.order_id !== "string") {
      return { error: "Checkout tidak dapat dimulai. Pastikan akun belum memiliki workspace dan paket masih tersedia." };
    }

    const orderId = orderData.order_id as string;
    const { data: claimData, error: claimError } = await supabase.rpc("claim_subscription_snap_checkout", { p_order_id: orderId });
    if (claimError || !claimData || typeof claimData !== "object") {
      return { error: "Sesi checkout tidak dapat disiapkan. Muat ulang halaman lalu coba kembali." };
    }

    const claim = claimData as Record<string, unknown>;
    if (claim.state === "PROCESSING") {
      return { error: "Checkout sedang disiapkan. Tunggu sebentar lalu coba kembali." };
    }

    let snapToken: string;
    let redirectUrl: string;
    if (claim.state === "READY" && typeof claim.snap_token === "string" && typeof claim.redirect_url === "string") {
      snapToken = claim.snap_token;
      redirectUrl = trustedMidtransRedirect(claim.redirect_url);
    } else if (claim.state === "CLAIMED") {
      const amount = Number(claim.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || claim.currency !== "IDR"
        || typeof claim.plan_name !== "string" || typeof claim.owner_name !== "string") {
        await createAdminClient().rpc("release_subscription_snap_checkout", { p_order_id: orderId });
        return { error: "Data paket tidak memenuhi syarat checkout online." };
      }

      try {
        const snap = await createMidtransSnapOrder({
          orderId,
          amount,
          planName: claim.plan_name,
          customerName: claim.owner_name,
          customerEmail: user.email,
        });
        const admin = createAdminClient();
        const { data: attached, error: attachError } = await admin.rpc("complete_subscription_snap_checkout", {
          p_order_id: orderId,
          p_snap_token: snap.token,
          p_redirect_url: snap.redirectUrl,
          p_transaction_id: snap.transactionId,
        });
        if (attachError || attached !== true) throw new Error("checkout response could not be saved");
        snapToken = snap.token;
        redirectUrl = snap.redirectUrl;
      } catch {
        await createAdminClient().rpc("release_subscription_snap_checkout", { p_order_id: orderId });
        return { error: "Midtrans belum dapat menyiapkan pembayaran. Tidak ada pembayaran yang dikonfirmasi; coba lagi." };
      }
    } else {
      return { error: "Checkout tidak tersedia. Silakan mulai ulang dari halaman paket." };
    }

    return {
      orderId,
      snapToken,
      redirectUrl,
      clientKey: browserConfig.clientKey,
      snapScriptUrl: browserConfig.snapScriptUrl,
    };
  } catch {
    return { error: "Checkout belum dapat dimulai. Coba kembali beberapa saat lagi." };
  }
}

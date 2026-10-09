import Link from "next/link";
import { redirect } from "next/navigation";
import { PaymentStatusView } from "@/components/public/payment-status-view";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Status pembayaran | POS-CAFE" };

export default async function SubscriptionPaymentPage({ searchParams }: { searchParams: Promise<{ order_id?: string; return?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = params.order_id ?? "";
  if (!/^PCSUB-[A-F0-9]{32}$/.test(orderId)) {
    return <main className="payment-status-page"><section className="payment-status-panel"><p className="landing-kicker">Checkout subscription</p><h1>Pesanan tidak ditemukan.</h1><p>Masuk dengan akun yang digunakan untuk membuat pesanan.</p><Link href="/login">Kembali ke login</Link></section></main>;
  }

  const { data: order, error } = await supabase
    .from("subscription_orders")
    .select("order_id, payment_status, tenant_id")
    .eq("order_id", orderId)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (error || !order) {
    return <main className="payment-status-page"><section className="payment-status-panel"><p className="landing-kicker">Checkout subscription</p><h1>Pesanan tidak ditemukan.</h1><p>Referensi tersebut tidak dapat diakses oleh akun ini.</p><Link href="/">Kembali ke POS-CAFE</Link></section></main>;
  }

  if (order.payment_status === "PAID") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.is_active && profile.role === "STORE_OWNER" && profile.tenant_id === order.tenant_id) {
      redirect("/store/dashboard");
    }
    return <main className="payment-status-page"><PaymentStatusView orderId={order.order_id} status="PROVISIONING" returnState="" /></main>;
  }

  return <main className="payment-status-page"><PaymentStatusView orderId={order.order_id} status={order.payment_status} returnState={params.return ?? ""} /></main>;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { SubscriptionCheckoutForm } from "@/components/public/subscription-checkout-form";
import { getPublicSubscriptionPlan, getPublicSubscriptionPlans } from "@/lib/public-plans";
import { getMidtransBrowserConfig } from "@/lib/midtrans";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME } from "@/lib/roles";
import type { AppRole } from "@/lib/roles";

export const metadata = { title: "Checkout paket | POS-CAFE" };

function metadataText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 120) : "";
}

export default async function RegistrationCompletePage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?registration=continue");

  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (profileError) return <main className="account-page"><p className="form-error">Akun belum dapat diverifikasi. Silakan muat ulang halaman.</p></main>;
  if (profile) {
    if (!profile.is_active) redirect("/unauthorized");
    redirect(ROLE_HOME[profile.role as AppRole]);
  }
  if (!user.email_confirmed_at || !user.email) redirect("/login?registration=continue");

  const code = params.plan ?? metadataText(user.user_metadata?.selected_plan_code);
  const [plan, plans] = await Promise.all([
    code ? getPublicSubscriptionPlan(code).catch(() => null) : Promise.resolve(null),
    getPublicSubscriptionPlans().catch(() => []),
  ]);
  let checkoutReady = false;
  try { getMidtransBrowserConfig(); checkoutReady = true; } catch { checkoutReady = false; }

  return <main className="account-page">
    <header className="account-header"><Link className="landing-brand" href="/"><span className="landing-brand-mark">P</span><span>POS-CAFE</span></Link><span className="account-email">{user.email}</span></header>
    <div className="account-layout account-layout-checkout">
      <aside className="account-context"><p className="landing-kicker">Checkout subscription</p><h1>Satu langkah lagi menuju workspace toko Anda.</h1><p>Tenant dan subscription akan dibuat setelah server menerima dan memverifikasi konfirmasi pembayaran Midtrans.</p><div className="account-security-note"><span aria-hidden="true">✓</span><p>Harga paket dibaca dari database. Data kartu, PIN, dan OTP dimasukkan hanya di halaman pembayaran Midtrans.</p></div></aside>
      <section className="account-panel">
        <p className="landing-kicker">Ringkasan pesanan</p>
        {plan ? <>
          <div className="checkout-summary"><div><span>Paket</span><strong>{plan.name}</strong></div><div><span>Durasi</span><strong>{plan.duration_days} hari</strong></div><div><span>Akun</span><strong>{user.email}</strong></div><div className="checkout-total"><span>Total</span><strong>{new Intl.NumberFormat("id-ID", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(plan.price)}</strong></div></div>
          {plan.can_checkout && checkoutReady
            ? <SubscriptionCheckoutForm plan={plan} email={user.email} initialOwnerName={metadataText(user.user_metadata?.full_name)} initialStoreName={metadataText(user.user_metadata?.store_name)} />
            : <div className="account-blocked"><strong>Pembayaran belum tersedia</strong><p>Paket atau kredensial pembayaran belum siap. Tidak ada tenant yang dibuat dan tidak ada pembayaran yang dikonfirmasi.</p><Link className="account-inline-link" href="/#pricing">Kembali ke paket</Link></div>}
        </> : <>
          <p className="account-muted">Paket yang dipilih tidak lagi tersedia. Pilih paket aktif untuk melanjutkan.</p>
          <div className="account-plan-links">{plans.map((item) => <Link key={item.id} href={`/register/complete?plan=${encodeURIComponent(item.code)}`}>{item.name}<span>{new Intl.NumberFormat("id-ID", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.price)}</span></Link>)}</div>
          {plans.length === 0 && <p className="form-error" role="alert">Paket belum dapat dimuat saat ini.</p>}
        </>}
      </section>
    </div>
  </main>;
}

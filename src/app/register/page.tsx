import Link from "next/link";
import { redirect } from "next/navigation";
import { RegistrationForm } from "@/components/public/registration-form";
import { getPublicSubscriptionPlan, getPublicSubscriptionPlans } from "@/lib/public-plans";
import { getMidtransBrowserConfig } from "@/lib/midtrans";
import { getApplicationUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { signOutAndContinueRegistration } from "@/app/register/actions";

export const metadata = { title: "Buat akun | POS-CAFE" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ plan?: string; state?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [plan, plans] = await Promise.all([
    params.plan ? getPublicSubscriptionPlan(params.plan).catch(() => null) : Promise.resolve(null),
    getPublicSubscriptionPlans().catch(() => []),
  ]);

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (profile) {
      const roleHome: Record<string, string> = {
        SUPER_ADMIN: "/platform/tenants",
        STORE_OWNER: "/store/dashboard",
        CASHIER: "/cashier/orders",
        KITCHEN_ADMIN: "/kitchen/queue",
      };
      const home = roleHome[profile.role] ?? "/unauthorized";
      if (!profile.is_active) redirect("/unauthorized");

      return <main className="account-page">
        <header className="account-header"><Link className="landing-brand" href="/"><span className="landing-brand-mark">P</span><span>POS-CAFE</span></Link><span className="account-email">{user.email}</span></header>
        <div className="account-layout">
          <aside className="account-context"><p className="landing-kicker">Registrasi owner</p><h1>Akun ini sudah terhubung ke workspace.</h1><p>Untuk membuat workspace baru dengan paket pilihan, gunakan akun Store Owner yang berbeda. Akun yang sedang masuk tidak akan diubah.</p></aside>
          <section className="account-panel">
            <p className="landing-kicker">Paket yang dipilih</p>
            <h2>{plan ? plan.name : "Lanjutkan dengan akun owner"}</h2>
            {params.state === "signout_failed" && <p className="form-error" role="alert">Akun belum berhasil dikeluarkan. Coba lagi sebelum melanjutkan pendaftaran.</p>}
            <p className="account-muted">Setelah keluar, Anda dapat membuat akun owner baru, memverifikasi email, lalu membayar paket melalui Midtrans. Klik paket tidak membuka pembayaran sebelum langkah tersebut selesai.</p>
            <form action={signOutAndContinueRegistration}>
              <input type="hidden" name="planCode" value={plan?.code ?? ""} />
              <button className="landing-button landing-button-dark account-submit" type="submit">Keluar dan lanjutkan pendaftaran</button>
            </form>
            <p><Link className="account-inline-link" href={home}>Kembali ke workspace akun ini</Link></p>
            {!plan && plans.length > 0 && <div className="account-plan-links">{plans.map((item) => <Link key={item.id} href={`/register?plan=${encodeURIComponent(item.code)}`}>{item.name}<span>{item.currency} {new Intl.NumberFormat("id-ID").format(item.price)}</span></Link>)}</div>}
          </section>
        </div>
      </main>;
    }
    redirect(`/register/complete${params.plan ? `?plan=${encodeURIComponent(params.plan)}` : ""}`);
  }

  const callbackUrl = new URL("/auth/callback", await getApplicationUrl()).toString();
  let checkoutReady = false;
  try { getMidtransBrowserConfig(); checkoutReady = true; } catch { checkoutReady = false; }

  return <main className="account-page">
    <header className="account-header"><Link className="landing-brand" href="/"><span className="landing-brand-mark">P</span><span>POS-CAFE</span></Link><Link href="/login">Sudah punya akun? Masuk</Link></header>
    <div className="account-layout">
      <aside className="account-context"><p className="landing-kicker">Workspace coffee shop</p><h1>Mulai dengan operasional yang saling terhubung.</h1><p>Buat akun owner, verifikasi email, lalu lanjutkan ke pembayaran paket yang dipilih.</p><div className="account-steps"><span><b>01</b> Akun & email</span><span><b>02</b> Informasi toko</span><span><b>03</b> Checkout aman</span></div></aside>
      <section className="account-panel">
        <p className="landing-kicker">Registrasi owner</p>
        <h2>{plan ? `Pilih ${plan.name}` : "Pilih paket untuk melanjutkan"}</h2>
        {params.state === "confirmation_failed" && <p className="form-error" role="alert">Tautan verifikasi tidak dapat diproses atau sudah kedaluwarsa. Silakan masuk jika akun sudah aktif, atau mulai pendaftaran kembali.</p>}
        {plan ? <RegistrationForm plan={plan} callbackUrl={callbackUrl} checkoutReady={checkoutReady} /> : <>
          <p className="account-muted">Paket mungkin tidak aktif atau tautannya tidak valid. Pilih paket yang tersedia.</p>
          <div className="account-plan-links">{plans.map((item) => <Link key={item.id} href={`/register?plan=${encodeURIComponent(item.code)}`}>{item.name}<span>{item.currency} {new Intl.NumberFormat("id-ID").format(item.price)}</span></Link>)}</div>
          {plans.length === 0 && <p className="form-error" role="alert">Paket belum dapat dimuat. Silakan kembali lagi nanti.</p>}
        </>}
      </section>
    </div>
  </main>;
}

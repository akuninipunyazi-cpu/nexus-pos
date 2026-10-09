"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicSubscriptionPlan } from "@/lib/public-plans";
import { createClient } from "@/lib/supabase/client";

export function RegistrationForm({
  plan,
  callbackUrl,
  checkoutReady,
}: {
  plan: PublicSubscriptionPlan;
  callbackUrl: string;
  checkoutReady: boolean;
}) {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!checkoutReady || !plan.can_checkout) {
      setError("Pendaftaran berbayar belum tersedia untuk paket ini.");
      return;
    }
    if (password !== confirmation) {
      setError("Konfirmasi password belum sama.");
      return;
    }
    if (password.length < 8) {
      setError("Gunakan password minimal 8 karakter.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: callbackUrl,
          data: {
            full_name: ownerName.trim(),
            store_name: storeName.trim(),
            selected_plan_code: plan.code,
          },
        },
      });
      if (signupError) throw signupError;

      if (data.session) {
        router.replace(`/register/complete?plan=${encodeURIComponent(plan.code)}`);
        router.refresh();
      } else {
        setSent(true);
      }
    } catch {
      setError("Akun belum dapat dibuat. Periksa data Anda atau coba masuk jika email sudah terdaftar.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return <div className="account-confirmation" role="status">
      <span className="account-confirmation-mark" aria-hidden="true">✓</span>
      <h3>Periksa email Anda</h3>
      <p>Jika alamat dapat digunakan, Supabase Auth akan mengirim tautan verifikasi. Buka tautan tersebut untuk melanjutkan checkout.</p>
      <p className="account-confirmation-email">{email}</p>
      <Link className="account-inline-link" href="/login">Sudah verifikasi? Masuk untuk melanjutkan</Link>
    </div>;
  }

  return <>
    {!checkoutReady || !plan.can_checkout ? <div className="account-blocked"><strong>Checkout belum tersedia</strong><p>Paket ini belum dapat dibayar secara online. Tidak ada tenant atau subscription yang dibuat.</p></div> : <>
      <div className="account-selected-plan"><span>{plan.name} · {plan.duration_days} hari</span><strong>{new Intl.NumberFormat("id-ID", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(plan.price)}</strong></div>
      <form className="account-form" onSubmit={submit}>
        <label>Nama owner<input autoComplete="name" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} maxLength={120} required /></label>
        <label>Nama toko<input autoComplete="organization" value={storeName} onChange={(event) => setStoreName(event.target.value)} maxLength={120} required /></label>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
        <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        <label>Konfirmasi password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required /></label>
        <input type="hidden" name="expectedAmount" value={String(plan.price)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="landing-button landing-button-dark account-submit" type="submit" disabled={pending}>{pending ? "Membuat akun…" : "Buat akun dan lanjutkan"}<span aria-hidden="true">→</span></button>
        <p className="account-terms-note">Dengan melanjutkan, Anda akan diminta memverifikasi email. Pembayaran diproses di halaman aman Midtrans.</p>
      </form>
    </>}
  </>;
}

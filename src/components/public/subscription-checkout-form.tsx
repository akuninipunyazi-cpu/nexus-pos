"use client";

import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startSubscriptionCheckout } from "@/app/register/actions";
import type { PublicSubscriptionPlan } from "@/lib/public-plans";

declare global {
  interface Window {
    snap?: {
      pay: (token: string, callbacks?: {
        onSuccess?: () => void;
        onPending?: () => void;
        onError?: () => void;
        onClose?: () => void;
      }) => void;
    };
  }
}

type CheckoutLaunch = {
  orderId: string;
  snapToken: string;
  redirectUrl: string;
  clientKey: string;
  snapScriptUrl: string;
};

export function SubscriptionCheckoutForm({
  plan,
  email,
  initialOwnerName,
  initialStoreName,
}: {
  plan: PublicSubscriptionPlan;
  email: string;
  initialOwnerName: string;
  initialStoreName: string;
}) {
  const router = useRouter();
  const [launch, setLaunch] = useState<CheckoutLaunch | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const launchedOrder = useRef<string | null>(null);

  useEffect(() => {
    if (!launch || !scriptReady || !window.snap || launchedOrder.current === launch.orderId) return;
    launchedOrder.current = launch.orderId;
    setClosed(false);
    const paymentStatusUrl = (state: string) => `/subscription/payment?order_id=${encodeURIComponent(launch.orderId)}&return=${state}`;
    window.snap.pay(launch.snapToken, {
      onSuccess: () => router.push(paymentStatusUrl("success")),
      onPending: () => router.push(paymentStatusUrl("pending")),
      onError: () => router.push(paymentStatusUrl("error")),
      onClose: () => setClosed(true),
    });
  }, [launch, scriptReady, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await startSubscriptionCheckout(new FormData(event.currentTarget));
    setPending(false);
    if (result.error || !result.orderId || !result.snapToken || !result.redirectUrl || !result.clientKey || !result.snapScriptUrl) {
      setError(result.error ?? "Checkout tidak dapat disiapkan. Silakan coba lagi.");
      return;
    }
    launchedOrder.current = null;
    setLaunch({
      orderId: result.orderId,
      snapToken: result.snapToken,
      redirectUrl: result.redirectUrl,
      clientKey: result.clientKey,
      snapScriptUrl: result.snapScriptUrl,
    });
  }

  return <>
    {launch && <Script
      src={launch.snapScriptUrl}
      data-client-key={launch.clientKey}
      strategy="afterInteractive"
      onLoad={() => setScriptReady(true)}
      onError={() => setError("Jendela Midtrans tidak dapat dimuat. Gunakan tautan checkout aman di bawah.")}
    />}
    <form className="account-form checkout-form" onSubmit={submit}>
      <label>Nama owner<input name="ownerName" autoComplete="name" defaultValue={initialOwnerName} maxLength={120} required /></label>
      <label>Nama toko<input name="storeName" autoComplete="organization" defaultValue={initialStoreName} maxLength={120} required /></label>
      <label>Email akun<input value={email} readOnly aria-readonly="true" /></label>
      <input type="hidden" name="planCode" value={plan.code} />
      <input type="hidden" name="expectedAmount" value={String(plan.price)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="landing-button landing-button-dark account-submit" type="submit" disabled={pending || !plan.can_checkout}>
        {pending ? "Menyiapkan pembayaran…" : "Bayar dengan Midtrans"}<span aria-hidden="true">→</span>
      </button>
      {launch && !closed && !error && <p className="checkout-open-note" role="status">Checkout Midtrans sedang dibuka. Jika belum terlihat, buka tautan aman di bawah.</p>}
      {launch && (closed || error) && <a className="checkout-fallback" href={launch.redirectUrl} target="_blank" rel="noopener noreferrer">Lanjutkan ke checkout Ke NEXUS <span aria-hidden="true">↗</span></a>}
      <p className="account-terms-note">Midtrans Snap menampilkan QRIS atau transfer bank jika metode tersebut aktif pada akun merchant. Nominal berasal dari database; tenant dibuat setelah notifikasi terverifikasi.</p>
    </form>
  </>;
}

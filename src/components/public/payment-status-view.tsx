"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function PaymentStatusView({ orderId, status, returnState }: { orderId: string; status: string; returnState: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(status === "PENDING");
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    if (status !== "PENDING") return;
    let active = true;
    let attempts = 0;
    const supabase = createClient();

    const check = async () => {
      const { data, error } = await supabase
        .from("subscription_orders")
        .select("payment_status")
        .eq("order_id", orderId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setCheckFailed(true);
        setChecking(false);
        return;
      }
      if (data?.payment_status && data.payment_status !== "PENDING") {
        setChecking(false);
        router.refresh();
        return;
      }
      attempts += 1;
      if (attempts >= 30) setChecking(false);
    };

    const timer = window.setInterval(() => { void check(); }, 3000);
    void check();
    return () => { active = false; window.clearInterval(timer); };
  }, [orderId, router, status]);

  const pendingText = returnState === "success"
    ? "Halaman pembayaran selesai, tetapi status belum dianggap berhasil sampai server memverifikasinya."
    : "Pembayaran menunggu konfirmasi dari Midtrans.";

  return <section className="payment-status-panel" aria-live="polite">
    {status === "PENDING" ? <>
      <span className="payment-status-mark pending" aria-hidden="true">…</span>
      <p className="landing-kicker">Verifikasi pembayaran</p>
      <h1>Pembayaran sedang diproses.</h1>
      <p>{checking ? pendingText : checkFailed ? "Status belum dapat diperbarui. Muat ulang halaman untuk mencoba lagi." : "Belum ada konfirmasi pembayaran. Anda dapat memeriksa kembali statusnya."}</p>
      <button type="button" className="payment-refresh" onClick={() => router.refresh()}>Periksa status</button>
      <small>Referensi pesanan {orderId}</small>
    </> : status === "FAILED" || status === "EXPIRED" || status === "CANCELLED" ? <>
      <span className="payment-status-mark failed" aria-hidden="true">!</span>
      <p className="landing-kicker">Checkout subscription</p>
      <h1>{status === "EXPIRED" ? "Waktu pembayaran berakhir." : status === "CANCELLED" ? "Pembayaran dibatalkan." : "Pembayaran tidak berhasil."}</h1>
      <p>Tenant belum dibuat dan subscription belum diaktifkan. Anda dapat memilih paket kembali.</p>
      <Link className="landing-button landing-button-dark" href="/#pricing">Kembali ke paket <span aria-hidden="true">→</span></Link>
      <small>Referensi pesanan {orderId}</small>
    </> : status === "PROVISIONING" ? <>
      <span className="payment-status-mark pending" aria-hidden="true">✓</span>
      <p className="landing-kicker">Pembayaran terverifikasi</p>
      <h1>Workspace sedang disiapkan.</h1>
      <p>Pembayaran telah diterima. Muat ulang halaman sebentar lagi untuk membuka workspace owner.</p>
      <button type="button" className="payment-refresh" onClick={() => router.refresh()}>Periksa workspace</button>
      <small>Referensi pesanan {orderId}</small>
    </> : <>
      <span className="payment-status-mark pending" aria-hidden="true">✓</span>
      <p className="landing-kicker">Checkout subscription</p>
      <h1>Status pesanan tidak dapat ditampilkan.</h1>
      <p>Periksa halaman ini kembali atau hubungi administrator platform dengan referensi pesanan.</p>
      <small>Referensi pesanan {orderId}</small>
    </>}
  </section>;
}

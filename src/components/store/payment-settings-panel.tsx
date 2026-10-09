"use client";

import { useState, useTransition } from "react";
import { beginPartnerMerchantOnboarding } from "@/app/store/actions";

type Account = { merchantId: string | null; merchantName: string; status: string; activatedAt: string | null };

const labels: Record<string, string> = {
  PENDING: "Registration not confirmed",
  SUBMITTED: "Verification in progress",
  ACTIVE: "Active",
  REJECTED: "Action required",
  SUSPENDED: "Suspended",
};

export function PaymentSettingsPanel({ account, partnerConfigured }: { account: Account | null; partnerConfigured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const status = account?.status ?? "NOT_CONNECTED";

  function connect() {
    setMessage(null);
    startTransition(async () => {
      const result = await beginPartnerMerchantOnboarding();
      setMessage(result.error ?? result.success ?? "");
      setError(Boolean(result.error));
      if (!result.error) window.location.reload();
    });
  }

  return <section className="payment-settings-panel" aria-labelledby="midtrans-title">
    <div className="payment-settings-heading">
      <div><p className="eyebrow">Customer payment provider</p><h2 id="midtrans-title">Midtrans</h2></div>
      <span className={`status status-${status === "ACTIVE" ? "active" : status === "NOT_CONNECTED" ? "pending" : "expired"}`}>
        {labels[status] ?? "Not connected"}
      </span>
    </div>
    {status === "NOT_CONNECTED" ? <>
      <p>Connect a Midtrans merchant account to accept QRIS from customers. POS-CAFE submits the store profile already on your account; payment credentials are never requested here.</p>
      {!partnerConfigured && <p className="payment-settings-note">Partner onboarding is not configured yet. Contact the platform administrator.</p>}
      <button className="primary-button compact" type="button" disabled={!partnerConfigured || pending} onClick={connect}>
        {pending ? "Connecting…" : "Connect Midtrans"}
      </button>
    </> : <>
      <p>{status === "SUBMITTED" && "Midtrans is reviewing this merchant. QRIS becomes available after activation is confirmed."}
        {status === "ACTIVE" && "Customers can now pay this store’s dine-in orders using QRIS."}
        {status === "PENDING" && "The registration request could not be confirmed. Contact the platform administrator before trying again."}
        {status === "REJECTED" && "Midtrans did not approve this merchant application. Contact the platform administrator for the next step."}
        {status === "SUSPENDED" && "QRIS payments are paused for this merchant. Contact the platform administrator."}</p>
      {account?.merchantId && <dl className="payment-account-details"><div><dt>Merchant</dt><dd>{account.merchantName}</dd></div><div><dt>Merchant ID</dt><dd>{account.merchantId}</dd></div></dl>}
    </>}
    {message && <p className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{message}</p>}
  </section>;
}

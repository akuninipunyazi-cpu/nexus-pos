"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updatePartnerMerchantStatus } from "@/app/platform/payment-accounts/actions";

export function PaymentAccountStatusForm({ merchantId, merchantName, defaultStatus }: { merchantId: string; merchantName: string; defaultStatus: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updatePartnerMerchantStatus(formData);
      setMessage(result.error ?? result.success ?? null);
      setIsError(Boolean(result.error));
    });
  }
  return <form onSubmit={submit} className="payment-account-action">
    <input type="hidden" name="merchantId" value={merchantId}/>
    <label><input type="checkbox" name="confirmed" value="yes" required/> I verified this status in Midtrans</label>
    <select name="status" defaultValue={defaultStatus} aria-label={`Status for ${merchantName}`}>
      <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="REJECTED">Rejected</option>
    </select>
    <button className="text-button" disabled={pending}>{pending ? "Saving…" : "Save status"}</button>
    {message && <small className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</small>}
  </form>;
}

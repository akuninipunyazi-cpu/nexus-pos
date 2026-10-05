"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "@/app/platform/actions";

export function CreateTenantForm() {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setError(null); startTransition(async () => { const result = await createTenant(new FormData(form)); if (result.error) setError(result.error); else router.push("/platform/tenants"); }); }
  return <form className="form-grid" onSubmit={submit}>
    <div className="form-section"><p className="form-section-title">Store information</p><div className="two-col"><Field label="Store name" name="storeName" placeholder="Kopi Senja" /><Field label="Store slug" name="slug" placeholder="kopi-senja" /></div></div>
    <div className="form-section"><p className="form-section-title">Store Owner</p><div className="two-col"><Field label="Full name" name="ownerName" placeholder="Ayu Pratama" /><Field label="Email" name="ownerEmail" type="email" placeholder="ayu@example.com" /></div><p className="field-help">An invitation will be sent. No password is created or shown here.</p></div>
    <div className="form-section"><p className="form-section-title">Subscription</p><div className="two-col"><Field label="Plan name" name="planName" placeholder="Monthly" /><Field label="Amount" name="amount" type="number" min="0" step="0.01" placeholder="0" /><Field label="Currency" name="currency" defaultValue="IDR" maxLength={3} /><Field label="Start" name="startedAt" type="datetime-local" /><Field label="Expiry" name="expiresAt" type="datetime-local" /></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" type="button" onClick={() => router.back()}>Cancel</button><button className="primary-button compact" type="submit" disabled={pending}>{pending ? "Creating..." : "Create tenant"}</button></div>
  </form>;
}
function Field({ label, name, type = "text", placeholder, min, step, defaultValue, maxLength }: { label: string; name: string; type?: string; placeholder?: string; min?: string; step?: string; defaultValue?: string; maxLength?: number }) { return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} placeholder={placeholder} min={min} step={step} defaultValue={defaultValue} maxLength={maxLength} required /></div>; }
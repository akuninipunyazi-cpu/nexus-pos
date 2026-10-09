"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "@/app/platform/actions";

type PlanOption = { id: string; name: string; code: string; price: number | string; currency: string; duration_days: number; max_staff: number | null; max_products: number | null; max_tables: number | null };

export function CreateTenantForm({ plans }: { plans: PlanOption[] }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setError(null); startTransition(async () => { const result = await createTenant(new FormData(form)); if (result.error) setError(result.error); else router.push("/platform/tenants"); }); }
  return <form className="form-grid" onSubmit={submit}>
    <div className="form-section"><p className="form-section-title">Store information</p><div className="two-col"><Field label="Store name" name="storeName" placeholder="Kopi Senja" /><Field label="Store slug" name="slug" placeholder="kopi-senja" /></div></div>
    <div className="form-section"><p className="form-section-title">Store Owner</p><div className="two-col"><Field label="Full name" name="ownerName" placeholder="Ayu Pratama" /><Field label="Email" name="ownerEmail" type="email" placeholder="ayu@example.com" /></div><p className="field-help">An invitation will be sent. No password is created or shown here.</p></div>
    <div className="form-section"><p className="form-section-title">Subscription</p>{plans.length === 0 ? <p className="field-help">Create an active subscription plan before creating a tenant.</p> : <div className="two-col"><div className="field"><label htmlFor="planId">Plan</label><select id="planId" name="planId" defaultValue="" required><option value="" disabled>Select a plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {new Intl.NumberFormat("id-ID", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(Number(plan.price))} · {plan.duration_days} days</option>)}</select></div><Field label="Start" name="startedAt" type="datetime-local" /><div className="field"><label htmlFor="isTrial">Initial status</label><select id="isTrial" name="isTrial" defaultValue="false"><option value="false">Active</option><option value="true">Trial</option></select></div></div>}<p className="field-help">Expiry is calculated from the selected plan duration. Limits apply to trials too.</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" type="button" onClick={() => router.back()}>Cancel</button><button className="primary-button compact" type="submit" disabled={pending || plans.length === 0}>{pending ? "Creating..." : "Create tenant"}</button></div>
  </form>;
}
function Field({ label, name, type = "text", placeholder, min, step, defaultValue, maxLength }: { label: string; name: string; type?: string; placeholder?: string; min?: string; step?: string; defaultValue?: string; maxLength?: number }) { return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} placeholder={placeholder} min={min} step={step} defaultValue={defaultValue} maxLength={maxLength} required /></div>; }

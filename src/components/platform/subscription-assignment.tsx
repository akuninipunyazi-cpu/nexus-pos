"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { assignSubscriptionPlan } from "@/app/platform/actions";

type TenantOption = { id: string; name: string; slug: string };
type PlanOption = { id: string; name: string; code: string; price: number | string; currency: string; duration_days: number };

export function SubscriptionAssignment({ tenants, plans }: { tenants: TenantOption[]; plans: PlanOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await assignSubscriptionPlan(data);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "Saved.");
      if (!result.error) router.refresh();
    });
  }

  return <section className="inline-section"><div className="section-heading"><div><p className="eyebrow">Tenant assignment</p><h2>Assign or renew a plan</h2></div></div>{tenants.length === 0 || plans.length === 0 ? <div className="plain-empty">Create a tenant and an active plan before assigning a subscription.</div> : <form className="product-form" onSubmit={submit}><select name="tenantId" defaultValue="" required><option value="" disabled>Select tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.slug})</option>)}</select><select name="planId" defaultValue="" required><option value="" disabled>Select active plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_days} days</option>)}</select><select name="status" defaultValue="ACTIVE"><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="SUSPENDED">Suspended</option></select><input name="startedAt" type="datetime-local" aria-label="Subscription start" required/><button className="primary-button compact" disabled={pending}>{pending ? "Assigning…" : "Assign subscription"}</button></form>}{message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}<p className="field-help">Expiry is calculated from the plan duration. Reassignment keeps the previous subscription record as history.</p></section>;
}

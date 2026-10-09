"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSubscriptionPlan, setSubscriptionPlanActive, updateSubscriptionPlan } from "@/app/platform/actions";

export type SubscriptionPlanRow = {
  id: string; name: string; code: string; price: number | string; currency: string;
  duration_days: number; max_staff: number | null; max_products: number | null;
  max_tables: number | null; is_active: boolean;
};

export function PlanManagement({ plans }: { plans: SubscriptionPlanRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>, action: typeof createSubscriptionPlan | typeof updateSubscriptionPlan) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await action(data);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "Saved.");
      if (!result.error) router.refresh();
    });
  }

  function toggle(plan: SubscriptionPlanRow) {
    const data = new FormData();
    data.set("planId", plan.id);
    data.set("isActive", String(plan.is_active));
    startTransition(async () => {
      const result = await setSubscriptionPlanActive(data);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "Saved.");
      if (!result.error) router.refresh();
    });
  }

  return <><section className="inline-section"><div className="section-heading"><div><p className="eyebrow">Platform pricing</p><h2>Create plan</h2></div></div><form className="product-form" onSubmit={(event) => submit(event, createSubscriptionPlan)}><input name="name" placeholder="Plan name" maxLength={80} required/><input name="code" placeholder="plan-code" pattern="[a-z0-9]+(-[a-z0-9]+)*" required/><input name="price" type="number" min="0" step="0.01" placeholder="Price" required/><input name="currency" defaultValue="IDR" minLength={3} maxLength={3} required/><input name="durationDays" type="number" min="1" step="1" placeholder="Duration in days" required/><input name="maxStaff" type="number" min="0" step="1" placeholder="Max staff (blank = unlimited)"/><input name="maxProducts" type="number" min="0" step="1" placeholder="Max products (blank = unlimited)"/><input name="maxTables" type="number" min="0" step="1" placeholder="Max tables (blank = unlimited)"/><button className="primary-button compact" disabled={pending}>{pending ? "Saving…" : "Create plan"}</button></form><p className="field-help">A blank limit means unlimited. Zero means no resources of that type are allowed.</p>{message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}</section><section className="platform-section"><div className="section-heading"><div><p className="eyebrow">Available plans</p><h2>Plan definitions</h2></div></div>{plans.length === 0 ? <div className="plain-empty">No plans yet. Create a plan before assigning subscriptions.</div> : <div className="table-wrap"><table><thead><tr><th>Plan</th><th>Price</th><th>Duration</th><th>Limits</th><th>Status</th><th>Action</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><form className="plan-edit-form" onSubmit={(event) => submit(event, updateSubscriptionPlan)}><input type="hidden" name="planId" value={plan.id}/><input aria-label={`${plan.name} name`} name="name" defaultValue={plan.name} maxLength={80} required/><small>{plan.code}</small><div className="plan-edit-fields"><input aria-label="Price" name="price" type="number" min="0" step="0.01" defaultValue={String(plan.price)} required/><input aria-label="Currency" name="currency" defaultValue={plan.currency} minLength={3} maxLength={3} required/><input aria-label="Duration days" name="durationDays" type="number" min="1" step="1" defaultValue={plan.duration_days} required/><input aria-label="Max staff; blank is unlimited" name="maxStaff" type="number" min="0" step="1" defaultValue={plan.max_staff ?? ""} placeholder="Staff ∞"/><input aria-label="Max products; blank is unlimited" name="maxProducts" type="number" min="0" step="1" defaultValue={plan.max_products ?? ""} placeholder="Products ∞"/><input aria-label="Max tables; blank is unlimited" name="maxTables" type="number" min="0" step="1" defaultValue={plan.max_tables ?? ""} placeholder="Tables ∞"/><button className="text-button" disabled={pending}>Save plan</button></div></form></td><td>{new Intl.NumberFormat("id-ID", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(Number(plan.price))}</td><td>{plan.duration_days} days</td><td>Staff {plan.max_staff ?? "Unlimited"}<br/>Products {plan.max_products ?? "Unlimited"}<br/>Tables {plan.max_tables ?? "Unlimited"}</td><td><span className={`status status-${plan.is_active ? "active" : "expired"}`}>{plan.is_active ? "Active" : "Inactive"}</span></td><td><button className="text-button" disabled={pending} onClick={() => toggle(plan)}>{plan.is_active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>}</section></>;
}

"use client";

import { FormEvent, useState, useTransition } from "react";
import { recordSubscriptionRevenue } from "@/app/platform/actions";

type Option = { id: string; label: string };
export function RevenueForm({ subscriptions }: { subscriptions: Option[] }) {
  const [pending, startTransition] = useTransition(); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setMessage(null); setError(null); startTransition(async () => { const result = await recordSubscriptionRevenue(new FormData(form)); if (result.error) setError(result.error); else { setMessage(result.success ?? "Saved."); form.reset(); } }); }
  return <form className="inline-form" onSubmit={submit}><select name="subscriptionId" required defaultValue=""><option value="" disabled>Select subscription</option>{subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.label}</option>)}</select><input name="amount" type="number" min="0" step="0.01" placeholder="Amount" required /><input name="reference" placeholder="Reference (optional)" /><button className="primary-button compact" type="submit" disabled={pending}>{pending ? "Saving..." : "Record revenue"}</button>{error && <span className="form-error">{error}</span>}{message && <span className="form-success">{message}</span>}</form>;
}
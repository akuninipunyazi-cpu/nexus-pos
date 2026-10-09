"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { deleteTenant, retryTenantAuthCleanup } from "@/app/platform/actions";

type CleanupJob = {
  job_id: string;
  tenant_name: string;
  tenant_slug: string;
  pending_accounts: number;
  created_at: string;
};

export function DeleteTenantControl({ tenantId, tenantName, tenantSlug }: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmedSlug, setConfirmedSlug] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("tenantId", tenantId);
    formData.set("confirmedSlug", confirmedSlug);
    startTransition(async () => {
      const result = await deleteTenant(formData);
      setMessage(result.error ?? result.success ?? "Tenant deletion could not be completed.");
      setIsError(Boolean(result.error));
      if (!result.error) {
        setOpen(false);
        setConfirmedSlug("");
        router.refresh();
      }
    });
  }

  return <div className="tenant-delete-control">
    <button type="button" className="text-button tenant-delete-trigger" aria-expanded={open} onClick={() => { setOpen((value) => !value); setMessage(""); }}>
      {open ? "Cancel" : "Delete"}
    </button>
    {open && <form className="tenant-delete-confirmation" onSubmit={submit}>
      <strong>Delete {tenantName} permanently?</strong>
      <p>This removes its orders, payments, menu, inventory, purchasing, subscriptions, notifications, audit history, and linked Store Owner, Cashier, and Kitchen login accounts. This cannot be undone.</p>
      <label htmlFor={`delete-tenant-${tenantId}`}>Type <code>{tenantSlug}</code> to confirm</label>
      <input id={`delete-tenant-${tenantId}`} value={confirmedSlug} onChange={(event) => setConfirmedSlug(event.target.value)} autoComplete="off" maxLength={120} required />
      <button className="tenant-delete-confirm-button" type="submit" disabled={pending || confirmedSlug !== tenantSlug}>
        {pending ? "Deleting tenant…" : "Delete tenant and all its data"}
      </button>
    </form>}
    {message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}
  </div>;
}

export function PendingTenantCleanupList({ jobs }: { jobs: CleanupJob[] }) {
  if (!jobs.length) return null;
  return <section className="tenant-cleanup-section" aria-labelledby="tenant-cleanup-heading">
    <div><p className="eyebrow">Account cleanup</p><h2 id="tenant-cleanup-heading">Login accounts still being removed</h2>
      <p>Tenant data has already been deleted. Retry any remaining Supabase login-account cleanup here.</p></div>
    <ul>{jobs.map((job) => <li key={job.job_id}>
      <div><strong>{job.tenant_name}</strong><small>{job.tenant_slug} · {job.pending_accounts} account(s) pending · requested {job.created_at}</small></div>
      <RetryTenantCleanupButton jobId={job.job_id} />
    </li>)}</ul>
  </section>;
}

function RetryTenantCleanupButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  function retry() {
    const formData = new FormData();
    formData.set("jobId", jobId);
    startTransition(async () => {
      const result = await retryTenantAuthCleanup(formData);
      setMessage(result.error ?? result.success ?? "Cleanup could not be completed.");
      setIsError(Boolean(result.error));
      if (!result.error) router.refresh();
    });
  }

  return <div className="tenant-cleanup-action"><button type="button" className="secondary-button compact" onClick={retry} disabled={pending}>
    {pending ? "Retrying…" : "Retry cleanup"}
  </button>{message && <small className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</small>}</div>;
}

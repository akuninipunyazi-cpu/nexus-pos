"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOwnerNotificationRead } from "@/app/store/actions";

type NotificationItem = { id: string; notification_type: string; title: string; message: string; read_at: string | null; created_at: string };

export function NotificationCenter({ items, unreadCount, initialError = null }: { items: NotificationItem[]; unreadCount: number; initialError?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialError);

  function markRead(id: string) {
    const form = new FormData();
    form.set("notificationId", id);
    setError(null);
    startTransition(async () => {
      const result = await markOwnerNotificationRead(form);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return <section className="notification-center" aria-label="Subscription notifications">
    <button className="notification-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M15 7a5 5 0 0 0-10 0c0 6-2 6-2 7h14c0-1-2-1-2-7M8 17h4" strokeLinecap="round" strokeLinejoin="round"/></svg> Notifications {unreadCount > 0 && <b aria-label={`${unreadCount} unread`}>{unreadCount}</b>}
    </button>
    {open && <div className="notification-panel"><div className="notification-panel-heading"><strong>Notifications</strong><span>{unreadCount} unread</span></div>{error && <p className="form-error" role="alert">{error}</p>}
      {items.length === 0 ? <p className="notification-empty">You’re up to date.</p> : <ul>{items.map((item) => <li className={item.read_at ? "is-read" : "is-unread"} key={item.id}><div><strong>{item.title}</strong><p>{item.message}</p><time dateTime={item.created_at}>{formatJakarta(item.created_at)}</time></div>{!item.read_at && <button type="button" className="text-button" disabled={pending} onClick={() => markRead(item.id)}>Mark read</button>}</li>)}</ul>}
    </div>}
  </section>;
}

function formatJakarta(value: string) { return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value)); }

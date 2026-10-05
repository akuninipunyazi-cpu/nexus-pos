import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { NAVIGATION } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/roles";

export async function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getSessionContext();
  const profile = context?.profile;
  const items = profile ? NAVIGATION[profile.role] : [];
  const initials = profile?.full_name?.slice(0, 1).toUpperCase() ?? profile?.email.slice(0, 1).toUpperCase() ?? "?";

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">K</span><span>Kopi Kasir</span></div>{profile && <p className="role-note">{ROLE_LABELS[profile.role]}<br />{profile.tenant_id ? "Tenant workspace" : "Platform workspace"}</p>}<nav className="nav" aria-label="Primary navigation">{items.map((item) => <Link className="nav-link" href={item.href} key={item.href}>{item.label}</Link>)}</nav></aside><div className="main"><header className="topbar"><span className="topbar-context">Foundation workspace</span>{profile && <div className="profile-chip"><span>{profile.full_name ?? profile.email}</span><span className="avatar" aria-hidden="true">{initials}</span></div>}</header><main className="content">{children}</main></div></div>;
}

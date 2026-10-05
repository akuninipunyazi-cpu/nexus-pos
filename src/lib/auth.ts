import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/roles";

export async function getSessionContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, tenant_id, role, full_name, email, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.is_active === false) return null;

  return { user, profile: profile as { id: string; tenant_id: string | null; role: AppRole; full_name: string | null; email: string; is_active: boolean } };
}

export async function requireRole(allowedRoles: AppRole[]) {
  const context = await getSessionContext();
  if (!context) redirect("/login");

  if (!allowedRoles.includes(context.profile.role)) {
    redirect("/unauthorized");
  }

  return context;
}

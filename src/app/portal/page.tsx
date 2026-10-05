import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/roles";

export default async function PortalPage() {
  const context = await requireRole(["SUPER_ADMIN", "STORE_OWNER", "CASHIER", "KITCHEN_ADMIN"]);
  redirect(ROLE_HOME[context.profile.role]);
}

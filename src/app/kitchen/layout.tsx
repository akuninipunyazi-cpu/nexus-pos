import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";

export default async function KitchenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireRole(["KITCHEN_ADMIN"]);
  return <AppShell>{children}</AppShell>;
}

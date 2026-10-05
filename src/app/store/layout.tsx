import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";

export default async function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireRole(["STORE_OWNER"]);
  return <AppShell>{children}</AppShell>;
}

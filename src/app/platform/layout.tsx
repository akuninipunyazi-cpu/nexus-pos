import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";

export default async function PlatformLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireRole(["SUPER_ADMIN"]);
  return <AppShell>{children}</AppShell>;
}

import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";

export default async function CashierLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireRole(["CASHIER"]);
  return <AppShell>{children}</AppShell>;
}

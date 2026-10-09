import { AppShell } from "@/components/app-shell";
import { NotificationCenter } from "@/components/store/notification-center";
import { getOwnerNotifications } from "@/lib/notifications";

export default async function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const notifications = await getOwnerNotifications();
  return <AppShell><NotificationCenter items={notifications.items} unreadCount={notifications.unreadCount} initialError={notifications.error}/>{children}</AppShell>;
}

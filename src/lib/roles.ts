export const ROLES = [
  "SUPER_ADMIN",
  "STORE_OWNER",
  "CASHIER",
  "KITCHEN_ADMIN",
] as const;

export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: "Super Admin",
  STORE_OWNER: "Store Owner",
  CASHIER: "Cashier",
  KITCHEN_ADMIN: "Kitchen Admin",
};

export const ROLE_HOME: Record<AppRole, string> = {
  SUPER_ADMIN: "/platform/tenants",
  STORE_OWNER: "/store/dashboard",
  CASHIER: "/cashier/orders",
  KITCHEN_ADMIN: "/kitchen/queue",
};

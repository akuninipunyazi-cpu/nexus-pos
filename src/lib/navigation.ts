import type { AppRole } from "@/lib/roles";
export type NavItem={label:string;href:string};
export const NAVIGATION:Record<AppRole,NavItem[]>={
 SUPER_ADMIN:[{label:"Overview",href:"/platform"},{label:"Tenants",href:"/platform/tenants"},{label:"Plans",href:"/platform/plans"},{label:"Subscriptions",href:"/platform/subscriptions"},{label:"Payment accounts",href:"/platform/payment-accounts"},{label:"Audit log",href:"/platform/audit-logs"},{label:"Revenue",href:"/platform/revenue"}],
 STORE_OWNER:[{label:"Overview",href:"/store/dashboard"},{label:"Staff",href:"/store/staff"},{label:"Products",href:"/store/products"},{label:"Categories",href:"/store/categories"},{label:"Tables",href:"/store/tables"},{label:"Inventory",href:"/store/inventory"},{label:"Recipes",href:"/store/recipes"},{label:"Suppliers",href:"/store/suppliers"},{label:"Purchase requests",href:"/store/purchase-requests"},{label:"Purchase orders",href:"/store/purchase-orders"},{label:"Waste",href:"/store/waste"},{label:"Analytics",href:"/store/analytics"},{label:"Reports",href:"/store/reports"},{label:"Payment settings",href:"/store/settings/payments"}],
 CASHIER:[{label:"Orders",href:"/cashier/orders"},{label:"Pending cash",href:"/cashier/pending-cash"},{label:"Transactions",href:"/cashier/transactions"},{label:"Takeaway",href:"/cashier/takeaway"}],
 KITCHEN_ADMIN:[{label:"Kitchen queue",href:"/kitchen/queue"},{label:"Inventory",href:"/kitchen/inventory"},{label:"Recipes",href:"/kitchen/recipes"},{label:"Purchase requests",href:"/kitchen/purchase-requests"},{label:"Waste",href:"/kitchen/waste"}],
};

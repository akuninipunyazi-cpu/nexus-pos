# Routes and Authorization Map

Auth identifies the Supabase user. The server loads the profile role and derives tenant scope; the client never chooses tenant scope.

## Route groups

/platform/* -> SUPER_ADMIN, platform SaaS data only.
/store/* -> STORE_OWNER, own tenant.
/cashier/* -> CASHIER, own tenant.
/kitchen/* -> KITCHEN_ADMIN, own tenant.
/order/* -> public customer, one resolved tenant/table.

## Platform

/platform/tenants: view tenants and subscriptions.
/platform/tenants/new: create tenant, owner invitation, and subscription.
/platform/subscriptions: manually manage subscriptions.
/platform/revenue: view recorded subscription revenue.

Super Admin does not automatically query operational store orders, payments, inventory, or sales.

## Store Owner

/store/dashboard
/store/staff
/store/products
/store/categories
/store/tables
/store/inventory
/store/waste
/store/analytics

These manage or report only the owner tenant. Staff invitations are limited to CASHIER and KITCHEN_ADMIN.

## Cashier

/cashier/orders
/cashier/pending-cash
/cashier/transactions
/cashier/takeaway

Cashier can view relevant orders, create DINE_IN/TAKEAWAY orders, and confirm received cash. Cashier cannot create users, manage subscriptions, or edit inventory.

/kitchen/queue
/kitchen/inventory
/kitchen/waste

Kitchen Admin can process paid orders, update preparation state, update stock, and record waste. Kitchen Admin cannot manage users, subscriptions, or sales analytics.

## Public customer routes

/order/[tenantSlug]/[tableToken]
/order/[tenantSlug]/[tableToken]/checkout
/order/[tenantSlug]/[tableToken]/status/[orderId]

Resolve table and tenant together. Validate that all products, prices, and table data belong to that tenant. Public input cannot set tenant_id, payment paid, or kitchen status. Customer status access uses a scoped public order token.

## Enforcement

Every protected mutation: authenticate; load server profile; derive tenant; check role; validate same-tenant foreign keys; execute under RLS; publish tenant-scoped events. Responses must not reveal whether another tenant ID exists.
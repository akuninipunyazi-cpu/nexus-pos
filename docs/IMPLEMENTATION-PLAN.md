# Implementation Plan

Documentation only; no full application implementation in this step.

## Phase 1: Foundation

Create Next.js/TypeScript structure, Supabase clients, environment validation, migrations, RLS, server role/tenant helpers, layouts, navigation, and permission/state-transition tests.

## Phase 2: Super Admin

Tenant creation, Store Owner invitation, manual subscriptions, expiry calculation, recorded subscription revenue, and platform-only dashboards.

## Phase 3: Store Owner

Dashboard, staff invitations, categories, products, recipe mappings, tables, opaque ordering tokens, QR/NFC URL display, inventory, and waste.

## Phase 4: Customer

Public table resolution, mobile menu, categories, products, cart, checkout, DINE_IN ordering, pending cash, mock QRIS abstraction, and public order status.

## Phase 5: Cashier

Pending cash queue, authorized confirmation, transaction history, and cashier-created DINE_IN/TAKEAWAY orders using shared order/payment logic.

## Phase 6: Kitchen

Paid-order queue, PREPARING/READY/COMPLETED transitions, recipe-based consumption on PREPARING, idempotency, stock, and waste.

## Phase 7: Realtime

Tenant-scoped new-order, payment, kitchen-status, and inventory events with reconnect/error handling.

## Phase 8: Analytics and hardening

Store Owner metrics, platform subscription metrics, mobile review, RLS/auth/payment/state-machine/tenant-isolation tests, and no-data/no-fake-metric checks.

## Security review

Tenant isolation: tenant_id on all tenant data; RLS derives scope from profile; opaque table tokens resolve one tenant/table; same-tenant foreign keys are checked transactionally; realtime channels are tenant-scoped.

Payment: cash checkout creates PENDING; QRIS is paid only by verified server handling; webhooks are idempotent; totals and price snapshots are server-calculated; redirects and client payment statuses are ignored; paid orders cannot be paid or queued twice.

Inventory: consumption only on PREPARING; missing recipes do nothing; movements are idempotent; stock changes are movements; waste cost requires available cost.

Authorization: server and RLS role checks; Store Owner may invite only two staff roles; Cashier cannot manage staff/subscriptions/stock; Kitchen Admin cannot access sales/subscriptions; Super Admin has platform scope only.

## Assumptions to centralize

Supabase Realtime and Auth email invitations are configured. QR is presentation only. NFC is a generated URL. The EXPIRING_SOON threshold is one centralized application constant.
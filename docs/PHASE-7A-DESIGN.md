# Phase 7A Design: Business and Operational Analytics

## Scope

Phase 7A is read-only analytics for Store Owners. It queries existing transactional data and does not create a second source of truth.

Domains:

- Sales
- Product performance
- Current inventory and consumption
- Purchasing and suppliers
- Kitchen operations

Food Waste UI/workflow, product margin/costing, forecasting, supplier scoring, accounting, payroll, automatic purchasing, and real QRIS remain out of scope.

## Access and tenant scope

Only authenticated `STORE_OWNER` users can execute `get_store_analytics`. The function derives `tenant_id` from the authenticated profile and accepts no tenant identifier from the caller. `SUPER_ADMIN`, Cashier, Kitchen Admin, anonymous users, and users without a tenant are rejected.

The analytics page is protected by the existing `/store` authorization layout.

## Date boundaries

The current tenant schema has no timezone field. For this MVP, all preset boundaries use `Asia/Jakarta`:

- Today: Jakarta midnight through the next Jakarta midnight.
- Last 7 days: the current Jakarta date plus the six preceding dates.
- Last 30 days: the current Jakarta date plus the 29 preceding dates.

The resulting UTC instants are passed to the server-side analytics RPC. Custom ranges are not implemented because no existing tenant timezone configuration exists to make them unambiguous.

## Metric definitions

### Sales

A qualifying sale is an order with `payment_status = PAID`, `order_status <> CANCELLED`, and `created_at` inside the selected period.

- Revenue: sum of authoritative `orders.total`.
- Orders: count of qualifying orders.
- AOV: revenue divided by qualifying order count; null when the count is zero.
- Items sold: sum of `order_items.quantity` for qualifying orders.
- Order type: grouped by existing `DINE_IN` and `TAKEAWAY` values.
- Payment method: grouped by persisted paid `payments.method` values, including `CASH` and `QRIS`/mock QRIS records.

### Products

Product units and revenue use historical `order_items.quantity` and `order_items.line_total` snapshots. Active products and products with historical sales in the period are shown. Current product prices are never used to reconstruct historical revenue.

### Inventory

Current stock is derived from the existing signed movement ledger. `CONSUME` is the only movement included in consumption analytics. `WASTE` is excluded from normal product consumption but remains part of the outbound stock balance.

Low stock uses the existing `minimum_stock` threshold and the current UI convention: current stock less than or equal to minimum stock. Out of stock is current stock less than or equal to zero. No inventory valuation is calculated.

### Purchasing

- Pending requests: `SUBMITTED` requests.
- Open purchase orders: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `ORDERED`, and `PARTIALLY_RECEIVED`.
- Receiving activity: receipts and quantities whose `received_at` is in the selected period.
- Received value: received quantity multiplied by the persisted purchase-order line `unit_price`, only when every relevant receipt line has a price. This is recorded receiving value, not an accounting cash-settlement measure.
- Supplier overview: active supplier count and factual purchase-order/received-order counts.

### Operations

- Completed orders: orders with `order_status = COMPLETED` and `completed_at` in the period.
- Current queue: current counts of `QUEUED`, `PREPARING`, and `READY`.
- Average preparation time: average of `preparing_at - queued_at` for rows with both timestamps and a non-negative duration.
- Orders by hour: qualifying order volume grouped by Jakarta-local hour from `created_at`.

Missing timestamps are excluded; no timestamp is inferred.

## Server architecture

The Store Owner page calls the stable, tenant-scoped `get_store_analytics` SECURITY DEFINER function. It validates the role, tenant, period, and product sort server-side, and returns aggregates plus the small tables needed by the UI. Transactional tables remain authoritative. No analytics mutation or client-side full-dataset aggregation is used.

Indexes added in migration 0021 support tenant/date filtering for orders, inventory movements, and receipts.

## Intentional non-features

Phase 7A does not implement:

- Product margin or cost accounting
- AI forecasting or demand prediction
- Supplier ratings or scoring
- Accounting or payroll
- Food Waste UI/workflow
- Automatic purchasing
- Real QRIS integration
- Phase 7B dashboard redesign
- Phase 7C reports/export

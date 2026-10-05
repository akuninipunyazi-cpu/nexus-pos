# Phase 6.2 Design: Inventory, Recipes, and Supply Chain

## Scope

Phase 6.2 extends the existing tenant-scoped Coffee POS with inventory, recipe/BOM configuration, transactional consumption at Kitchen QUEUED to PREPARING, suppliers, purchase requests, purchase orders, receiving, low-stock visibility, and tenant-scoped realtime updates.

It does not implement food waste, real QRIS, accounting, payroll, loyalty, marketing, delivery, or forecasting.

## Design decisions and minimal assumptions

- Inventory stock is stored in one canonical unit per item: gram, kilogram, milliliter, liter, piece, bottle, or pack.
- Recipe quantities must use the inventory item's canonical unit. MVP does not silently convert units.
- Supplier purchase-unit conversion is not active in MVP. Supplier item metadata may record a purchase unit, but receiving must use the inventory item's canonical unit unless an explicit configured conversion is later added.
- A product has at most one recipe configuration. Editing the recipe does not rewrite history because actual consumption rows persist the quantities used at the time of preparation.
- A product without an active recipe is allowed to enter PREPARING without inventory movement; no consumption is fabricated.
- Negative stock is rejected. There is no backorder or automatic purchasing behavior.
- Store Owner owns inventory configuration, recipes, suppliers, purchase-order creation/approval, and receiving. Kitchen Admin can view inventory/recipes, create purchase requests, and perform controlled stock adjustments; Kitchen Admin cannot approve requests or receive goods in this MVP. This follows the explicit role matrix and avoids granting approval authority implicitly.
- Purchase requests are created by Kitchen Admin or Store Owner; only Store Owner can approve/reject/cancel them.
- Purchase orders are created and approved by Store Owner. Receiving is Store Owner-only.
- Purchase request submission uses a caller-supplied idempotency key. Consumption is protected by unique consumption rows and a transactional order transition. Receiving is protected by a unique receipt idempotency key and receipt-item constraints.
- Inventory movements are append-only ledger entries. Current stock is derived from the signed movement sum, with row locks on the inventory item during consumption, adjustment, and receiving.
- Phase 6.2.1 adds the WASTE movement type as an outbound ledger foundation only. It adds no Food Waste UI or workflow.
- Receipt payloads reject duplicate purchase-order item lines before mutation; unique-constraint errors are treated as idempotent only when a persisted receipt exists for the same key.

## Entities

- inventory_items: tenant, name, stock unit, minimum stock, optional target stock, active state.
- inventory_movements: append-only signed ledger context with item, quantity, unit, movement type, order/purchase/receipt context, actor, and optional idempotency key.
- recipes: tenant/product, active state, creator and update metadata.
- recipe_items: recipe-to-inventory-item quantities with same-tenant composite foreign keys and unique item per recipe.
- inventory_consumption: persisted per-order-item/per-ingredient quantities used for historical integrity and duplicate protection.
- suppliers: tenant-scoped supplier contact record.
- supplier_inventory_items: many-to-many supplier/item relationship, optional SKU, purchase unit metadata, last known price, preferred flag.
- purchase_requests and purchase_request_items: low-stock requests with approval state.
- purchase_orders and purchase_order_items: supplier orders with ordered and received quantities.
- inventory_receipts and inventory_receipt_items: idempotent partial/full receiving records.

All tenant-owned records use tenant_id; related records use same-tenant composite foreign keys where integrity depends on two tenant-owned entities.

## Consumption transaction

The existing transition_kitchen_order RPC remains the only Kitchen state transition boundary.

For QUEUED to PREPARING, inside one transaction it:

1. authenticates and verifies KITCHEN_ADMIN;
2. locks the order and verifies tenant, payment_status = PAID, and current state;
3. locks relevant inventory items;
4. loads active recipes and calculates order quantity times recipe quantity on the server;
5. rejects the transition if required stock is insufficient;
6. writes inventory_consumption and CONSUME movements once;
7. changes the order to PREPARING.

A repeated request sees the existing state/consumption and returns an idempotent result. Realtime events only trigger reconciliation.

## Receiving transaction

A Store Owner submits a receipt idempotency key and receipt lines. The receiving RPC locks the PO and items, verifies the PO belongs to the authenticated tenant and is in APPROVED, ORDERED, or PARTIALLY_RECEIVED, rejects quantities above outstanding amounts, writes receipt rows and RECEIVE movements, and updates the PO to PARTIALLY_RECEIVED or RECEIVED.

## Realtime

Existing Supabase Postgres Changes is reused. inventory_movements, purchase_requests, purchase_orders, and inventory_receipts are added to the existing Realtime publication. Authenticated tenant subscribers use RLS-backed tenant filters. No cross-tenant channel is introduced. A slower server refresh remains only as recovery fallback.

## Interface plan

Store Owner routes:
- /store/inventory
- /store/recipes
- /store/suppliers
- /store/purchase-requests
- /store/purchase-orders

Kitchen Admin routes:
- /kitchen/inventory
- /kitchen/recipes
- /kitchen/purchase-requests

The UI uses the existing ink/paper/mineral/roast design system: dense tables, compact inline forms, status badges, and direct operational actions. Empty states are database-derived and no metrics are fabricated.

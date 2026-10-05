# Architecture Decisions

Status: accepted MVP decisions.

## Stack and boundaries

- Next.js App Router with TypeScript.
- Supabase Auth, Postgres, RLS, and Realtime.
- Server route handlers/server actions are the trusted mutation boundary.
- Customers use public table-ordering routes without accounts.
- Every tenant-owned record has tenant_id.

## Inventory

Products may map to recipe ingredients. Inventory is consumed only when an order enters PREPARING. Cart creation and unpaid cash-order creation do not consume stock. Products without recipes cause no automatic deduction. Consumption is idempotent.

## Subscriptions

Subscriptions belong to tenants and contain tenant_id, plan_name, amount, currency, started_at, expires_at, and status. Statuses are ACTIVE, EXPIRING_SOON, and EXPIRED. Super Admin manages them manually. There is no billing gateway in MVP. Subscription revenue comes only from recorded revenue/payment records.

## Authentication

Supabase Auth manages staff identities. Store Owner invites staff by email and assigns CASHIER or KITCHEN_ADMIN. Plaintext passwords are never stored or shown. Authorization is server-side and enforced by RLS.

## Orders

The shared order model supports DINE_IN and TAKEAWAY. DINE_IN may reference a table; TAKEAWAY does not require one. Both use the same payment and kitchen flow.

## Ready handoff

MVP implements READY and customer-visible status only. Physical calling-device integration is out of scope. The state/event model remains extensible for a future adapter.

## Payment security

Cash remains PENDING until an authorized Cashier confirms it. QRIS uses a provider interface; a mock provider is allowed in development. Frontend redirects never mark payment paid. Only verified server results or authorized Cashier confirmation can do so.
## Phase 6.2 decisions (inventory and supply chain)

Phase 6.2 uses canonical inventory stock units (gram, kilogram, milliliter, liter, piece, bottle, pack). Recipe quantities must match the inventory item's canonical unit; MVP does not silently convert units. Supplier purchase-unit conversion is not active until explicitly configured, so receiving uses the canonical stock unit.

Historical recipe integrity is preserved by persisting actual inventory_consumption rows at the atomic Kitchen QUEUED to PREPARING transition. Editing the current recipe cannot change prior consumption. Products without active recipes do not generate consumption movements and do not block preparation.

The inventory balance is an append-only signed movement ledger. Consumption, receiving, and adjustments lock the relevant inventory rows and calculate stock in the same transaction. Negative stock is rejected. Consumption is de-duplicated by unique order-item/ingredient records; receiving uses a unique receipt idempotency key and receipt-item constraints; purchase request submission uses a caller-supplied idempotency key.

For MVP, Store Owner controls inventory configuration, recipes, suppliers, purchase orders, approval, and receiving. Kitchen Admin can view inventory and recipes, create purchase requests, and perform controlled adjustment movements, but cannot approve requests or receive goods. This follows the explicit role matrix and avoids granting ambiguous approval authority.


The 0019 hardening migration revokes direct authenticated writes to recipe detail, purchase request, purchase order, and receipt tables. Their SECURITY DEFINER RPCs are the only write boundary; RLS remains the read boundary. Adjustment idempotency keys are payload-bound and conflicting reuse is rejected.

Phase 6.2.1 adds WASTE to the append-only inventory movement ledger as an outbound foundation for Phase 6.3, without adding Food Waste UI or workflow. receive_purchase_order rejects duplicate purchase-order item lines before receipt mutation, and only a persisted receipt found by idempotency key can be returned as an idempotent replay.
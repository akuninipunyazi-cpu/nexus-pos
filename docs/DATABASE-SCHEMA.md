# Database Schema Design

Every tenant-owned table has non-null tenant_id. Same-tenant foreign-key checks and RLS are required.

## Platform and identity

tenants: id, name, slug, status, created_at.

profiles: id (Supabase Auth user ID), tenant_id nullable only for SUPER_ADMIN, role, full_name, email, created_at. Roles: SUPER_ADMIN, STORE_OWNER, CASHIER, KITCHEN_ADMIN.

subscriptions: id, tenant_id, plan_name, amount, currency, started_at, expires_at, status, created_by, created_at.

subscription_revenue_records: id, tenant_id, subscription_id, amount, currency, recorded_at, recorded_by, reference. Platform revenue uses this table only.

## Catalog

categories: id, tenant_id, name, sort_order, is_active.

products: id, tenant_id, category_id, name, description, price, image_url, is_active, created_at.

tables: id, tenant_id, table_number, public_token, status, created_at. public_token is opaque and unique; it is not the table number.

## Orders

orders: id, tenant_id, order_number, order_type (DINE_IN or TAKEAWAY), table_id nullable, source (CUSTOMER or CASHIER), order_status, payment_status, notes, created_by, created_at, updated_at.

order_items: id, tenant_id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, notes.

payments: id, tenant_id, order_id, method (CASH or QRIS), status, provider, provider_payment_id, paid_at, confirmed_by, created_at, updated_at. Provider event IDs are idempotent/unique where present.

Order statuses: PENDING_PAYMENT, PAID, QUEUED, PREPARING, READY, DELIVERING, COMPLETED, CANCELLED.
Payment statuses: PENDING, PAID, FAILED, CANCELLED.

## Inventory and waste

ingredients: id, tenant_id, name, unit, cost_per_unit, low_stock_threshold, is_active.

product_ingredients: id, tenant_id, product_id, ingredient_id, quantity_per_product.

inventory_balances: id, tenant_id, ingredient_id, quantity, updated_at.

inventory_movements: id, tenant_id, ingredient_id, movement_type (STOCK_IN, ADJUSTMENT, CONSUMPTION, WASTE), quantity_delta, order_id, food_waste_id, recorded_by, created_at. Consumption has an idempotency key/unique constraint per order, ingredient, and movement type.

food_waste: id, tenant_id, ingredient_id, quantity, reason, unit_cost, recorded_by, created_at. Reasons: EXPIRED, DAMAGED, OVERPRODUCTION, PREPARATION_ERROR, OTHER.

## Derived rules

Analytics are tenant-scoped queries, not duplicated analytics data. Only paid orders enter the kitchen. Inventory consumption happens on transition into PREPARING. Missing recipes cause no consumption. Retried events cannot duplicate payments, transitions, or movements.
# BUILD: Multi-Tenant SaaS Coffee POS

## 0. MANDATORY FIRST STEP — INSTALL FRONTEND DESIGN SKILL

Before writing, modifying, or generating ANY application code, run:

```bash
npx skills add https://github.com/anthropics/skills --skill frontend-design
```

Verify that the skill was successfully installed and available.

Do NOT start coding before this step is completed.

Use the installed `frontend-design` skill as a design constraint throughout the entire implementation.

---

# 1. IMPORTANT: UNDERSTAND THE PRODUCT BEFORE CODING

You are building a **Web-based Multi-Tenant SaaS Coffee POS**, not a simple cashier application.

The product has three major layers:

1. **Super Admin Platform**
2. **Store Owner / Tenant**
3. **Store Operations + Customer Ordering**

The most important architectural concept is:

> This is a MULTI-TENANT SaaS application.

The person who owns the SaaS platform is the **Super Admin Platform**.

A coffee shop/cafe/restaurant that subscribes to the SaaS becomes a **Tenant / Store**.

Each Tenant has its own:

- Store Owner
- Cashiers
- Kitchen/Admin Dapur
- Products
- Categories
- Tables/Seats
- Orders
- Payments
- Inventory
- Food waste records
- Sales data
- Analytics

Data from one tenant MUST NEVER leak into another tenant.

---

# 2. SOURCE OF TRUTH

There is an existing Excalidraw flowchart for this system:

`SISTEM-POS-COFFE.excalidraw`

There is also a role/permission matrix.

Treat these as the primary product requirements.

Do NOT silently replace the intended architecture with your own interpretation.

If something is explicitly defined in the flowchart, follow it.

If something is NOT defined:

1. Do not invent a complex feature.
2. Do not assume business rules that were never requested.
3. Use the simplest implementation necessary.
4. Clearly mark the assumption.
5. If the missing information is critical to architecture/security/data integrity, STOP and ask before implementing it.

The goal is to prevent hallucinated requirements.

---

# 3. PRODUCT MODEL

The hierarchy is:

```text
SUPER ADMIN PLATFORM
        |
        +---- TENANT / STORE A
        |       |
        |       +---- STORE OWNER
        |       +---- CASHIER
        |       +---- KITCHEN ADMIN
        |       +---- TABLES
        |       +---- PRODUCTS
        |       +---- ORDERS
        |       +---- PAYMENTS
        |       +---- INVENTORY
        |
        +---- TENANT / STORE B
        |       |
        |       +---- STORE OWNER
        |       +---- CASHIER
        |       +---- KITCHEN ADMIN
        |       +---- ...
        |
        +---- TENANT / STORE C
```

The SaaS subscription belongs to the **Tenant/Store**, NOT to an individual cashier or kitchen staff member.

Example:

```text
Tenant: Kopi Senja
Subscription:
  status: ACTIVE
  started_at: ...
  expires_at: ...
```

All staff accounts belong to that tenant.

---

# 4. ROLES AND PERMISSIONS

Implement exactly these conceptual roles:

## A. SUPER ADMIN PLATFORM

This is the SaaS owner/platform owner.

Responsibilities:

- Create tenant/store accounts
- Create/manage Store Owner accounts
- View all tenants
- View subscription status
- View remaining subscription time
- View total subscription revenue
- Manage tenant subscription lifecycle
- View platform-level statistics

The Super Admin is NOT the operational admin of individual stores.

The Super Admin should NOT automatically have access to every store's operational POS data unless explicitly implemented as a separate platform-support permission.

---

## B. STORE OWNER / ADMIN TOKO

This is the customer who subscribes to the SaaS.

Responsibilities:

- Manage store information
- Manage staff
- Add Cashier accounts
- Add Kitchen/Admin Dapur accounts
- Manage products
- Manage categories
- Manage tables/seats
- Generate unique ordering URLs
- Generate QR code for tables
- Manage NFC/QR table identifiers
- View sales
- View cashflow
- Monitor inventory
- Monitor supply chain
- Monitor kitchen activity
- Monitor food waste
- View business analytics

The Store Owner controls ONLY their own tenant.

---

## C. CASHIER

Responsibilities:

- Access cashier dashboard
- View relevant orders
- Process cash payments
- Confirm cash payments
- View sales relevant to cashier operations
- Handle cashier-side transaction workflow

Cashier cannot:

- Create another cashier
- Create Store Owner
- Manage tenant subscription
- Edit inventory unless explicitly permitted
- Access another tenant

---

## D. KITCHEN / ADMIN DAPUR

Responsibilities:

- Receive paid/confirmed orders
- View kitchen order queue
- Update preparation status
- Manage kitchen inventory
- Update stock
- Record ingredient usage
- Record food waste
- Monitor remaining stock

Kitchen staff cannot:

- Manage subscription
- Create Store Owner
- Create Cashier
- Access another tenant's data

---

# 5. REQUIRED PERMISSION MATRIX

Use this as the baseline:

| Role | Add Cashier | View Sales | Edit Stock | Add Store Owner |
|---|---:|---:|---:|---:|
| Super Admin Platform | No | No* | No | Yes |
| Store Owner | Yes | Yes | Yes | No |
| Cashier | No | Yes | No | No |
| Kitchen Admin | No | No | Yes | No |

`*` Super Admin Platform may have platform-level subscription/revenue analytics, but that is NOT the same as accessing operational sales data of every store.

Do not expand permissions without a requirement.

---

# 6. MULTI-TENANCY IS NON-NEGOTIABLE

Every tenant-owned entity must be associated with a tenant.

Conceptually:

```text
tenant
  |
  +-- users
  +-- products
  +-- categories
  +-- tables
  +-- orders
  +-- order_items
  +-- payments
  +-- inventory
  +-- food_waste
  +-- analytics
```

Use a consistent `tenant_id` strategy.

Never trust a tenant ID supplied directly by an untrusted client.

The authenticated user's tenant must determine the accessible tenant scope.

Every protected query/mutation must enforce tenant isolation.

Examples:

```text
Store A cashier
    ↓
can access Store A orders

Store A cashier
    X
cannot access Store B orders
```

This requirement applies to:

- API
- Server actions
- Database queries
- Dashboard
- Realtime subscriptions
- URLs
- Mutations
- Reports

---

# 7. CUSTOMER ORDERING SYSTEM

The POS is NOT only a cashier system.

Customers must be able to order directly from their table.

Each table/seat has a unique public ordering identity.

Example:

```text
/order/seat-1
/order/seat-2
/order/seat-3
```

However, because this is multi-tenant, the implementation MUST ensure that:

```text
Store A / seat-1
```

cannot be confused with:

```text
Store B / seat-1
```

The internal data model must identify both:

```text
tenant_id
table_id
```

A public URL may use a tenant slug + table slug or a secure public table token.

Do not rely solely on `seat-1` as a globally unique identifier.

---

# 8. NFC + QR FLOW

The table can have an NFC card/tag and QR code.

Example:

```text
TABLE 01

[NFC]

[QR]
Scan to Order
```

Customer flow:

```text
NFC / QR
    ↓
Unique Table URL
    ↓
Customer Menu
    ↓
Select Product
    ↓
Cart
    ↓
Checkout
    ↓
Payment
```

The customer should NOT need to create an account just to browse/order unless authentication becomes necessary later.

The customer interface should be frictionless.

---

# 9. CUSTOMER UI

The customer experience is extremely important.

The customer page should immediately show:

- Store/menu context
- Categories
- Products
- Price
- Product image where useful
- Add to cart
- Cart
- Checkout

Do NOT create unnecessary marketing copy.

Avoid sections such as:

```text
"Welcome to your extraordinary culinary journey..."
"Experience the finest coffee..."
"Discover our amazing..."
```

Do not use generic AI-generated copy.

The UI should feel like a real production ordering interface.

The customer should be able to understand what to do within seconds.

---

# 10. CUSTOMER ORDER FLOW

Implement the conceptual state:

```text
CUSTOMER OPENS TABLE URL
        ↓
TABLE IDENTIFIED
        ↓
MENU LOADED
        ↓
CUSTOMER SELECTS PRODUCT
        ↓
CART
        ↓
CHECKOUT
        ↓
PAYMENT METHOD
      /     \
    CASH    QRIS
```

For CASH:

```text
CASH SELECTED
      ↓
ORDER CREATED
      ↓
PAYMENT STATUS = PENDING
      ↓
CASHIER DASHBOARD
      ↓
CUSTOMER PAYS CASH
      ↓
CASHIER CONFIRMS
      ↓
PAYMENT STATUS = PAID
      ↓
KITCHEN
```

Do NOT mark a cash order as paid merely because the customer selected "Cash".

---

# 11. QRIS FLOW

QRIS must conceptually follow:

```text
CUSTOMER
   ↓
CREATE PAYMENT
   ↓
QRIS PAYMENT
   ↓
PAYMENT PROVIDER
   ↓
PAYMENT CONFIRMATION / WEBHOOK
   ↓
SERVER VERIFICATION
   ↓
PAYMENT STATUS = PAID
   ↓
ORDER ENTERS KITCHEN
```

Do not treat a frontend redirect alone as proof of successful payment.

If a real QRIS/payment provider is not configured in the development environment:

- Build a clean payment abstraction/interface.
- Use a mock payment provider for development.
- Clearly label it as mock.
- Do NOT pretend that real QRIS integration exists.
- Do NOT fabricate API credentials or webhook responses.

---

# 12. ORDER STATES

Use explicit order states rather than vague "success" states.

At minimum design for:

```text
PENDING_PAYMENT
PAID
QUEUED
PREPARING
READY
DELIVERING
COMPLETED
CANCELLED
```

Payment states should be separate from order states.

For example:

```text
order_status:
PREPARING

payment_status:
PAID
```

Do NOT combine payment state and kitchen/order state into one field.

---

# 13. CASHIER DASHBOARD

The Cashier Dashboard should focus on operational work.

Core areas:

```text
Orders
Pending Cash Payments
Paid Orders
Transaction History
```

For cash orders:

```text
Pending Cash
      ↓
Customer pays
      ↓
Cashier confirms
      ↓
Paid
```

The cashier should be able to clearly distinguish:

```text
PENDING
PAID
CANCELLED
```

Do not clutter the cashier UI with analytics that are primarily intended for Store Owner.

---

# 14. KITCHEN DASHBOARD

The kitchen should receive appropriate orders after payment is confirmed.

Conceptual flow:

```text
PAID
 ↓
KITCHEN QUEUE
 ↓
PREPARING
 ↓
READY
 ↓
DELIVERY / CUSTOMER NOTIFICATION
 ↓
COMPLETED
```

Kitchen UI should prioritize:

- Order number
- Table
- Items
- Quantity
- Notes
- Time
- Current status

Avoid unnecessary decorative UI.

---

# 15. INVENTORY / SUPPLY CHAIN

The Store Owner and Kitchen Admin need visibility into supply chain and stock.

The system should support the concept of:

```text
Ingredients
    ↓
Inventory
    ↓
Product consumption
    ↓
Remaining stock
```

Also support:

```text
Food Waste
```

Example:

```text
Ingredient
Quantity
Reason
Timestamp
Recorded by
```

Do not invent an overly sophisticated ERP system.

Build the simplest useful inventory model that supports the requested POS workflow.

---

# 16. FOOD WASTE

The system should allow the kitchen/store to record unused or wasted food/ingredients.

Examples of reasons:

```text
Expired
Damaged
Overproduction
Preparation Error
Other
```

The Store Owner should be able to monitor:

```text
Waste quantity
Waste cost
Waste frequency
```

Only implement metrics that can actually be calculated from available data.

Do not create fake analytics.

---

# 17. STORE OWNER ANALYTICS

The Store Owner dashboard should provide a holistic operational view.

Relevant areas include:

### Sales

- Revenue
- Number of orders
- Average order value
- Sales trends

### Cashflow

- Cash sales
- QRIS sales
- Total incoming payments
- Transaction status

### Inventory

- Current stock
- Low stock
- Stock movement
- Ingredient usage

### Kitchen

- Orders waiting
- Orders preparing
- Orders ready
- Preparation activity

### Food Waste

- Waste quantity
- Waste cost
- Waste trend

Do not show a metric if the underlying data does not exist.

---

# 18. SUPER ADMIN DASHBOARD

The Super Admin dashboard is for managing the SaaS platform itself.

Core areas:

```text
Tenants
Subscriptions
Subscription Revenue
Active Tenants
Expiring Subscriptions
```

For each tenant, show:

```text
Store Name
Owner
Subscription Status
Started At
Expires At
Remaining Time
```

Remaining subscription time should be calculated from actual timestamps, not hardcoded text.

Example:

```text
29 days remaining
```

The countdown/status should update correctly as time passes.

---

# 19. TENANT CREATION FLOW

Super Admin should be able to:

```text
SUPER ADMIN
    ↓
ADD TENANT
    ↓
Store Information
    ↓
Create Store Owner Account
    ↓
Set Subscription
    ↓
Tenant Created
```

After creation, the Store Owner should immediately have access to the store system according to the defined permissions.

Do not require the Super Admin to manually create every cashier/table/product unless explicitly necessary.

---

# 20. TABLE MANAGEMENT

Store Owner should have:

```text
Seat Management
```

Example:

```text
Table 01
Table 02
Table 03
...
```

For each table:

```text
table_id
tenant_id
table_number
public_identifier
status
ordering_url
```

Store Owner should be able to generate/view:

```text
QR Code
NFC URL
```

Do not claim that the web application can physically write NFC tags unless an appropriate browser/device workflow actually supports it.

The system can generate the URL that should be encoded into the NFC tag.

---

# 21. REALTIME REQUIREMENTS

Where the product explicitly says realtime, implement a real realtime mechanism appropriate to the chosen stack.

Examples:

```text
New order
    ↓
Kitchen dashboard updates
```

```text
Payment confirmed
    ↓
Cashier/order state updates
```

```text
Inventory changed
    ↓
Owner dashboard updates
```

Do not fake realtime with unnecessary polling unless there is a clear technical reason.

If realtime infrastructure is unavailable, create the architecture so it can be added cleanly.

---

# 22. DATABASE DESIGN

Before implementing complex features, design the core data model.

At minimum, think in terms of:

```text
tenants
users
subscriptions
tables
products
categories
orders
order_items
payments
inventory_items
inventory_movements
food_waste
```

Additional tables may be introduced only when justified.

Do not create dozens of unnecessary tables just to appear sophisticated.

Every database relationship must have a clear reason.

---

# 23. AUTHENTICATION AND AUTHORIZATION

Authentication and authorization must be separate concepts.

```text
Authentication
=
Who are you?

Authorization
=
What are you allowed to do?
```

The role system must be enforced server-side.

Do NOT rely only on hiding buttons in the frontend.

For example:

```text
Cashier sees no "Add User" button
```

is NOT sufficient.

The backend must also reject:

```text
POST /users
```

from a Cashier.

---

# 24. UI/UX DESIGN DIRECTION

The UI must be:

- Modern
- Minimal
- Elegant
- Calm
- Professional
- Information-dense where appropriate
- Easy to scan
- Fast to understand
- Production-oriented

Avoid:

- AI-slop aesthetics
- Excessive gradients
- Excessive glassmorphism
- Giant hero sections
- Huge decorative text
- Excessive rounded cards
- Random floating blobs
- Neon gradients
- Excessive animations
- Fake testimonials
- Unnecessary illustrations
- Marketing-style copy inside operational dashboards
- "Welcome to your amazing..." type text
- Excessive badges
- Excessive shadows
- Card-within-card-within-card layouts

Do not make every UI element a rounded card.

Use hierarchy through:

- Typography
- Spacing
- Grid
- Alignment
- Borders
- Subtle contrast
- Consistent navigation

The visual language should resemble a serious modern SaaS/productivity application, not an AI-generated landing page.

---

# 25. CUSTOMER UI DESIGN

Customer ordering is NOT a marketing landing page.

When the customer opens:

```text
/order/...
```

go directly to:

```text
Menu
```

The priority is:

```text
Category
Product
Price
Add
Cart
Checkout
```

Minimize text.

The customer should not have to scroll through a large hero section before seeing food.

---

# 26. DASHBOARD DESIGN

Dashboards should be information-first.

Use appropriate layouts such as:

```text
Sidebar
Top bar
Main content
Tables
Charts
Compact stat blocks
```

Do not create 20 KPI cards.

Only show metrics that matter for the current role.

Super Admin sees SaaS metrics.

Store Owner sees business metrics.

Cashier sees transaction operations.

Kitchen sees kitchen operations.

---

# 27. RESPONSIVENESS

The application must work properly on:

- Desktop
- Tablet
- Mobile

The customer ordering interface is especially important on mobile.

The dashboard can prioritize desktop/tablet while remaining responsive.

---

# 28. ARCHITECTURE RULE

Before coding the full application:

1. Inspect the existing repository.
2. Identify the current framework.
3. Identify the existing database/auth setup.
4. Identify installed dependencies.
5. Reuse existing architecture when reasonable.
6. Do not rewrite the entire project unnecessarily.
7. Do not install random dependencies.
8. Do not replace working infrastructure without a reason.

If there is no existing project architecture, choose a reasonable production stack and explicitly state the chosen stack before implementation.

---

# 29. IMPLEMENTATION STRATEGY

Do NOT attempt to blindly generate the entire system in one huge step.

Work in phases.

## Phase 1 — Understand

Inspect:

- repository
- existing code
- environment
- flowchart
- role matrix

Then produce a concise implementation plan.

Do not code yet.

## Phase 2 — Architecture

Define:

- application architecture
- route structure
- role model
- tenant isolation
- database model
- authentication strategy
- order state model
- payment abstraction
- realtime strategy

## Phase 3 — Foundation

Implement:

- authentication
- tenant model
- roles
- authorization
- base layout
- navigation
- database structure

## Phase 4 — Super Admin

Implement:

- tenant creation
- Store Owner creation
- subscriptions
- subscription status
- subscription revenue
- remaining subscription time

## Phase 5 — Store Owner

Implement:

- dashboard
- staff management
- product management
- table management
- QR/NFC URL generation
- inventory
- waste
- analytics

## Phase 6 — Customer

Implement:

- table URL
- menu
- cart
- checkout
- payment selection
- order creation
- order status

## Phase 7 — Cashier

Implement:

- cashier dashboard
- cash payment confirmation
- order management
- transaction records

## Phase 8 — Kitchen

Implement:

- kitchen queue
- preparation state
- stock interaction
- waste recording

## Phase 9 — Realtime

Connect appropriate realtime events between:

```text
Customer
Cashier
Kitchen
Store Owner
```

## Phase 10 — Testing

Test:

- authentication
- authorization
- tenant isolation
- order creation
- cash payment
- QRIS mock flow
- inventory changes
- table routing
- subscription expiry
- realtime updates
- mobile customer flow

---

# 30. ANTI-HALLUCINATION RULES

These rules are mandatory.

### Rule 1

Never invent a feature simply because it is common in POS systems.

### Rule 2

Never invent API credentials.

### Rule 3

Never pretend an external payment gateway is working if it is not configured.

### Rule 4

Never pretend NFC hardware writing is implemented if only URL generation exists.

### Rule 5

Never invent business metrics.

### Rule 6

Never silently change the role hierarchy.

### Rule 7

Never silently change the flowchart's intended behavior.

### Rule 8

Never allow frontend-only authorization.

### Rule 9

Never allow cross-tenant data access.

### Rule 10

If a requirement is ambiguous and the ambiguity affects:

- security
- database structure
- payment
- tenant isolation
- authentication
- authorization
- financial data

STOP and ask for clarification before implementing it.

For low-impact UI decisions, choose the simplest reasonable option and document the assumption.

---

# 31. IMPORTANT DISTINCTION

Do not confuse these two concepts:

```text
SUPER ADMIN PLATFORM
=
Owner of the SaaS product
```

and:

```text
STORE OWNER
=
Customer who subscribes to the SaaS
```

The hierarchy is:

```text
YOU
SUPER ADMIN
   ↓
TENANTS
   ↓
STORE OWNERS
   ↓
STAFF
   ├── CASHIER
   └── KITCHEN ADMIN
```

Customers ordering food are not staff users.

They interact with the public table-ordering flow.

---

# 32. DO NOT OVERBUILD

The goal is a functional, coherent MVP foundation.

Do not add:

- loyalty systems
- CRM
- employee payroll
- accounting ERP
- marketing automation
- delivery marketplace
- advanced AI recommendation engine
- reservation system
- unnecessary notifications
- unnecessary settings

unless explicitly requested later.

Build the system described here first.

---

# 33. FINAL SUCCESS CRITERIA

The implementation is successful only if this complete scenario works conceptually:

```text
SUPER ADMIN
    ↓
Creates Tenant
    ↓
Creates Store Owner
    ↓
Sets Subscription
    ↓
Store Owner logs in
    ↓
Creates Cashier + Kitchen Admin
    ↓
Creates Products
    ↓
Creates Tables
    ↓
System generates unique table URLs
    ↓
QR/NFC can point to those URLs
    ↓
Customer opens table URL
    ↓
Customer sees menu immediately
    ↓
Customer adds products
    ↓
Customer checks out
    ↓
Customer chooses CASH or QRIS
    ↓
Payment state is handled correctly
    ↓
Paid order enters kitchen
    ↓
Kitchen prepares order
    ↓
Order becomes READY
    ↓
Customer receives/gets the order
    ↓
Transaction is recorded
    ↓
Inventory is updated according to the implemented inventory rule
    ↓
Food waste can be recorded
    ↓
Store Owner sees updated business data
    ↓
Historical data becomes available for analytics
    ↓
Super Admin can see tenant subscription status
```

The system should feel like **one coherent product**, not a collection of unrelated dashboards.

Before implementing each major phase, verify that it fits the architecture above.

Do not optimize for "more features".

Optimize for:

**correctness → clarity → security → tenant isolation → usability → visual quality.**
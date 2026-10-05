import Link from "next/link";
import { requireRole } from "@/lib/auth";
import {
  duration,
  getStoreAnalytics,
  money,
  normalizeProductSort,
  normalizeRange,
  number,
  type AnalyticsData,
} from "@/lib/analytics";

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="analytics-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="plain-empty">{children}</div>;
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return <section className="analytics-section"><div className="section-heading"><div><h2>{title}</h2></div>{aside}</div>{children}</section>;
}

function AnalyticsBody({ data, range, sort }: { data: AnalyticsData; range: string; sort: string }) {
  const revenue = Number(data.sales.revenue);
  const orderCount = Number(data.sales.orders);
  const aov = data.sales.aov === null ? null : Number(data.sales.aov);
  const hourMax = Math.max(...data.operations.orders_by_hour.map((item) => Number(item.orders)), 1);

  return <>
    <section className="analytics-metrics">
      <Metric label="Paid revenue" value={money(revenue)} note="Paid, non-cancelled orders" />
      <Metric label="Qualifying orders" value={number(orderCount)} />
      <Metric label="Average order value" value={money(aov)} note={orderCount ? undefined : "No qualifying orders"} />
      <Metric label="Items sold" value={number(data.sales.items_sold)} />
      <Metric label="Current queue" value={number(Number(data.operations.queued_count) + Number(data.operations.preparing_count) + Number(data.operations.ready_count))} />
    </section>

    <Section title="Sales mix">
      <div className="analytics-columns">
        <div className="analytics-table"><h3>Order type</h3>{data.sales.by_order_type.length === 0 ? <Empty>No paid orders in this period.</Empty> : <table><thead><tr><th>Type</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>{data.sales.by_order_type.map((row) => <tr key={row.order_type}><td>{row.order_type.replace("_", " ")}</td><td>{number(row.orders)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table>}</div>
        <div className="analytics-table"><h3>Payment method</h3>{data.sales.by_payment_method.length === 0 ? <Empty>No paid payments in this period.</Empty> : <table><thead><tr><th>Method</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>{data.sales.by_payment_method.map((row) => <tr key={row.method}><td>{row.method === "QRIS" ? "QRIS / mock provider" : row.method}</td><td>{number(row.orders)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table>}</div>
      </div>
    </Section>

    <Section title="Product performance" aside={<div className="analytics-switch"><Link className={sort === "revenue" ? "selected" : ""} href={"/store/analytics?range=" + range + "&sort=revenue"}>Revenue</Link><Link className={sort === "units" ? "selected" : ""} href={"/store/analytics?range=" + range + "&sort=units"}>Units</Link></div>}>
      {data.products.length === 0 ? <Empty>No product sales in this period.</Empty> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Units sold</th><th>Revenue</th></tr></thead><tbody>{data.products.map((product) => <tr key={product.product_id}><td>{product.product_name}</td><td>{product.category_name}</td><td>{number(product.units_sold)}</td><td>{money(product.revenue)}</td></tr>)}</tbody></table></div>}
    </Section>

    <Section title="Inventory">
      <div className="analytics-mini-grid">
        <Metric label="Inventory items" value={number(data.inventory.item_count)} />
        <Metric label="Low stock" value={number(data.inventory.low_stock_count)} />
        <Metric label="Out of stock" value={number(data.inventory.out_of_stock_count)} />
        <Metric label="Consumed" value={number(data.inventory.consumption_quantity)} note="Ledger CONSUME movements" />
      </div>
      <div className="analytics-columns analytics-columns-spaced">
        <div className="analytics-table"><h3>Current stock</h3>{data.inventory.items.length === 0 ? <Empty>No inventory items configured.</Empty> : <table><thead><tr><th>Item</th><th>Current</th><th>Minimum</th><th>Status</th></tr></thead><tbody>{data.inventory.items.map((item) => <tr key={item.id}><td>{item.name}<small>{item.unit}</small></td><td>{number(item.current_stock)}</td><td>{number(item.minimum_stock)}</td><td><span className={"status status-" + item.stock_status.toLowerCase()}>{item.stock_status.replace("_", " ")}</span></td></tr>)}</tbody></table>}</div>
        <div className="analytics-table"><h3>Consumption in period</h3>{data.inventory.consumption_by_item.length === 0 ? <Empty>No consumption recorded in this period.</Empty> : <table><thead><tr><th>Item</th><th>Quantity</th></tr></thead><tbody>{data.inventory.consumption_by_item.map((item) => <tr key={item.inventory_item_id}><td>{item.item_name}<small>{item.unit}</small></td><td>{number(item.quantity)}</td></tr>)}</tbody></table>}</div>
      </div>
    </Section>

    <Section title="Purchasing">
      <div className="analytics-mini-grid">
        <Metric label="Pending requests" value={number(data.purchasing.pending_request_count)} />
        <Metric label="Open purchase orders" value={number(data.purchasing.open_purchase_order_count)} />
        <Metric label="Receipts" value={number(data.purchasing.receipt_count)} />
        <Metric label="Received quantity" value={number(data.purchasing.received_quantity)} />
      </div>
      <p className="analytics-note">{data.purchasing.received_value_available ? "Recorded receiving value: " + money(data.purchasing.received_value) : "Receiving value unavailable because one or more receipt lines have no persisted unit price."}</p>
      <div className="analytics-table">{data.purchasing.suppliers.length === 0 ? <Empty>No active suppliers configured.</Empty> : <table><thead><tr><th>Supplier</th><th>Purchase orders</th><th>Received orders</th></tr></thead><tbody>{data.purchasing.suppliers.map((supplier) => <tr key={supplier.supplier_id}><td>{supplier.supplier_name}</td><td>{number(supplier.purchase_orders)}</td><td>{number(supplier.received_orders)}</td></tr>)}</tbody></table>}</div>
    </Section>

    <Section title="Kitchen operations">
      <div className="analytics-mini-grid">
        <Metric label="Completed in period" value={number(data.operations.completed_orders)} />
        <Metric label="Queued now" value={number(data.operations.queued_count)} />
        <Metric label="Preparing now" value={number(data.operations.preparing_count)} />
        <Metric label="Ready now" value={number(data.operations.ready_count)} />
        <Metric label="Average preparation" value={duration(data.operations.average_preparation_seconds)} note="preparing_at minus queued_at" />
      </div>
      <div className="hour-chart"><h3>Paid order volume by Jakarta hour</h3>{data.operations.orders_by_hour.length === 0 ? <Empty>No qualifying order volume in this period.</Empty> : <div className="hour-bars">{data.operations.orders_by_hour.map((item) => <div className="hour-bar-row" key={item.hour}><span>{String(item.hour).padStart(2, "0")}:00</span><div><i style={{ width: Math.max(4, (Number(item.orders) / hourMax) * 100) + "%" }} /></div><b>{number(item.orders)}</b></div>)}</div>}</div>
    </Section>
  </>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; sort?: string }> }) {
  const context = await requireRole(["STORE_OWNER"]);
  if (!context.profile.tenant_id) return <Empty>Analytics require a tenant-owned Store Owner profile.</Empty>;
  const params = await searchParams;
  const range = normalizeRange(params.range);
  const sort = normalizeProductSort(params.sort);
  const data = await getStoreAnalytics(range, sort);

  return <>
    <div className="page-heading-row"><div><p className="eyebrow">Store workspace</p><h1 className="page-title">Analytics</h1><p className="page-intro">Factual sales, stock, purchasing, and kitchen activity for this store.</p></div><div className="analytics-period"><span>Period</span><div>{(["today", "7d", "30d"] as const).map((key) => <Link key={key} className={range === key ? "selected" : ""} href={"/store/analytics?range=" + key + "&sort=" + sort}>{key === "today" ? "Today" : key === "7d" ? "7 days" : "30 days"}</Link>)}</div></div></div>
    {!data ? <div className="plain-empty large-empty"><h2>Analytics unavailable.</h2><p>The server could not load tenant analytics. No values were fabricated.</p></div> : <AnalyticsBody data={data} range={range} sort={sort} />}
  </>;
}

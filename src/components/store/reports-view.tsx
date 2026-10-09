import type { ReactNode } from "react";
import type { AnalyticsData } from "@/lib/analytics";
import { REPORT_DISPLAY_LIMIT, type ReportKind } from "@/lib/reports";

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "-";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes < 1 ? "<1 min" : `${minutes} min`;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="report-empty">{children}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="report-section"><div className="section-heading"><h2>{title}</h2></div>{children}</section>;
}

function Summary({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return <div className="report-summary-grid">{items.map((item) => <div className="report-summary" key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</div>)}</div>;
}

function LimitNote({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <p className="report-note">Showing the first {formatNumber(shown)} of {formatNumber(total)} rows. Use the CSV export for the full available result.</p> : null;
}

function TableFrame({ children }: { children: ReactNode }) {
  return <div className="report-table-wrap"><table className="report-table">{children}</table></div>;
}

function SalesReport({ data }: { data: AnalyticsData }) {
  return <>
    <Summary items={[
      { label: "Revenue", value: formatMoney(data.sales.revenue), note: "Paid, non-cancelled orders" },
      { label: "Orders", value: formatNumber(data.sales.orders) },
      { label: "Average order value", value: formatMoney(data.sales.aov), note: data.sales.orders ? undefined : "No qualifying orders" },
      { label: "Items sold", value: formatNumber(data.sales.items_sold) },
    ]} />
    <div className="report-two-column">
      <Section title="DINE_IN vs TAKEAWAY"><TableFrame><thead><tr><th>Order type</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>{data.sales.by_order_type.length === 0 ? <tr><td colSpan={3}><Empty>No qualifying orders in this period.</Empty></td></tr> : data.sales.by_order_type.map((item) => <tr key={item.order_type}><td>{item.order_type.replaceAll("_", " ")}</td><td>{formatNumber(item.orders)}</td><td>{formatMoney(item.revenue)}</td></tr>)}</tbody></TableFrame></Section>
      <Section title="Cash vs QRIS"><TableFrame><thead><tr><th>Payment method</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>{data.sales.by_payment_method.length === 0 ? <tr><td colSpan={3}><Empty>No paid payments in this period.</Empty></td></tr> : data.sales.by_payment_method.map((item) => <tr key={item.method}><td>{item.method === "QRIS" ? "QRIS / mock provider" : item.method}</td><td>{formatNumber(item.orders)}</td><td>{formatMoney(item.revenue)}</td></tr>)}</tbody></TableFrame></Section>
    </div>
  </>;
}

function ProductsReport({ data }: { data: AnalyticsData }) {
  const rows = data.products.slice(0, REPORT_DISPLAY_LIMIT);
  return <>
    <Summary items={[{ label: "Products in report", value: formatNumber(data.products.length) }, { label: "Items sold", value: formatNumber(data.sales.items_sold) }, { label: "Store revenue", value: formatMoney(data.sales.revenue), note: "Sales report total" }]} />
    <Section title="Product performance">{rows.length === 0 ? <Empty>No product sales in this period.</Empty> : <TableFrame><thead><tr><th>Product</th><th>Category</th><th>Units sold</th><th>Revenue</th></tr></thead><tbody>{rows.map((item) => <tr key={item.product_id}><td>{item.product_name}</td><td>{item.category_name}</td><td>{formatNumber(item.units_sold)}</td><td>{formatMoney(item.revenue)}</td></tr>)}</tbody></TableFrame>}<LimitNote shown={rows.length} total={data.products.length} /></Section>
  </>;
}

function InventoryReport({ data }: { data: AnalyticsData }) {
  const rows = data.inventory.items.slice(0, REPORT_DISPLAY_LIMIT);
  const consumption = data.inventory.consumption_by_item.slice(0, REPORT_DISPLAY_LIMIT);
  return <>
    <Summary items={[{ label: "Inventory items", value: formatNumber(data.inventory.item_count) }, { label: "Low stock", value: formatNumber(data.inventory.low_stock_count) }, { label: "Out of stock", value: formatNumber(data.inventory.out_of_stock_count) }, { label: "Consumed", value: formatNumber(data.inventory.consumption_quantity), note: "CONSUME movements" }]} />
    <Section title="Current stock">{rows.length === 0 ? <Empty>No inventory items are configured.</Empty> : <TableFrame><thead><tr><th>Item</th><th>Unit</th><th>Current</th><th>Minimum</th><th>Status</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td>{formatNumber(item.current_stock)}</td><td>{formatNumber(item.minimum_stock)}</td><td><span className={`report-status ${item.stock_status.toLowerCase()}`}>{item.stock_status.replaceAll("_", " ")}</span></td></tr>)}</tbody></TableFrame>}<LimitNote shown={rows.length} total={data.inventory.items.length} /></Section>
    <Section title="Consumption in period">{consumption.length === 0 ? <Empty>No consumption recorded in this period.</Empty> : <TableFrame><thead><tr><th>Item</th><th>Unit</th><th>Quantity</th></tr></thead><tbody>{consumption.map((item) => <tr key={item.inventory_item_id}><td>{item.item_name}</td><td>{item.unit}</td><td>{formatNumber(item.quantity)}</td></tr>)}</tbody></TableFrame>}<LimitNote shown={consumption.length} total={data.inventory.consumption_by_item.length} /></Section>
  </>;
}

function PurchasingReport({ data }: { data: AnalyticsData }) {
  const rows = data.purchasing.suppliers.slice(0, REPORT_DISPLAY_LIMIT);
  return <>
    <Summary items={[{ label: "Pending requests", value: formatNumber(data.purchasing.pending_request_count) }, { label: "Open purchase orders", value: formatNumber(data.purchasing.open_purchase_order_count) }, { label: "Receipts", value: formatNumber(data.purchasing.receipt_count) }, { label: "Suppliers", value: formatNumber(data.purchasing.supplier_count) }]} />
    <Section title="Receiving and supplier activity"><p className="report-note">{data.purchasing.received_value_available ? `Recorded receiving value: ${formatMoney(data.purchasing.received_value)}. This is receiving value, not accounting settlement.` : "Recorded receiving value is unavailable because one or more receipt lines have no persisted unit price."} Received quantity in the selected period: {formatNumber(data.purchasing.received_quantity)}. Request, open-order, and supplier counts are current snapshots; supplier order counts use the existing 7A overview.</p>{rows.length === 0 ? <Empty>No supplier activity is recorded in this period.</Empty> : <TableFrame><thead><tr><th>Supplier</th><th>Purchase orders</th><th>Received orders</th></tr></thead><tbody>{rows.map((item) => <tr key={item.supplier_id}><td>{item.supplier_name}</td><td>{formatNumber(item.purchase_orders)}</td><td>{formatNumber(item.received_orders)}</td></tr>)}</tbody></TableFrame>}<LimitNote shown={rows.length} total={data.purchasing.suppliers.length} /></Section>
  </>;
}

function OperationsReport({ data }: { data: AnalyticsData }) {
  const rows = data.operations.orders_by_hour.slice(0, REPORT_DISPLAY_LIMIT);
  return <>
    <Summary items={[{ label: "Completed orders", value: formatNumber(data.operations.completed_orders) }, { label: "Queued now", value: formatNumber(data.operations.queued_count) }, { label: "Preparing now", value: formatNumber(data.operations.preparing_count) }, { label: "Ready now", value: formatNumber(data.operations.ready_count) }, { label: "Average preparation", value: formatDuration(data.operations.average_preparation_seconds), note: "preparing_at minus queued_at" }]} />
    <Section title="Orders by Jakarta-local hour">{rows.length === 0 ? <Empty>No qualifying order volume in this period.</Empty> : <TableFrame><thead><tr><th>Hour</th><th>Orders</th></tr></thead><tbody>{rows.map((item) => <tr key={item.hour}><td>{String(item.hour).padStart(2, "0")}:00</td><td>{formatNumber(item.orders)}</td></tr>)}</tbody></TableFrame>}<LimitNote shown={rows.length} total={data.operations.orders_by_hour.length} /></Section>
  </>;
}

export function ReportsView({ data, report }: { data: AnalyticsData; report: ReportKind }) {
  if (report === "products") return <ProductsReport data={data} />;
  if (report === "inventory") return <InventoryReport data={data} />;
  if (report === "purchasing") return <PurchasingReport data={data} />;
  if (report === "operations") return <OperationsReport data={data} />;
  return <SalesReport data={data} />;
}

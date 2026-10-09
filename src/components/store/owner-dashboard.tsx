import Link from "next/link";
import type { ReactNode } from "react";
import type { AnalyticsData } from "@/lib/analytics";

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "-";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes < 1 ? "<1 min" : `${minutes} min`;
}

function Section({
  title,
  children,
  href,
  linkLabel = "View details",
}: {
  title: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <h2>{title}</h2>
        {href && <Link href={href}>{linkLabel} -&gt;</Link>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="dashboard-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="dashboard-empty">{children}</div>;
}

function MixList({
  title,
  rows,
  label,
  supporting,
}: {
  title: string;
  rows: { label: string; value: number; secondary: number }[];
  label: string;
  supporting: string;
}) {
  const max = Math.max(...rows.map((row) => Number(row.value)), 1);

  return (
    <div className="dashboard-mix">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <Empty>No recorded activity in this period.</Empty>
      ) : (
        <div className="dashboard-bars">
          {rows.map((row) => (
            <div className="dashboard-bar-row" key={row.label}>
              <div className="dashboard-bar-topline">
                <strong>{row.label}</strong>
                <span>{formatMoney(row.value)}</span>
              </div>
              <div className="dashboard-bar-track" aria-hidden="true">
                <i style={{ width: `${Math.max(4, (Number(row.value) / max) * 100)}%` }} />
              </div>
              <small>{formatNumber(row.secondary)} {supporting}</small>
            </div>
          ))}
        </div>
      )}
      <span className="dashboard-data-note">{label}</span>
    </div>
  );
}

function stockStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function OwnerDashboard({
  data,
  storeName,
  periodLabel,
}: {
  data: AnalyticsData;
  storeName: string;
  periodLabel: string;
}) {
  const queueCount =
    Number(data.operations.queued_count) +
    Number(data.operations.preparing_count) +
    Number(data.operations.ready_count);
  const outOfStock = data.inventory.items.filter((item) => item.stock_status === "OUT_OF_STOCK");
  const lowStock = data.inventory.items.filter((item) => item.stock_status === "LOW_STOCK");
  const attentionItems = [
    outOfStock.length > 0 && {
      label: "Out of stock",
      value: formatNumber(outOfStock.length),
      href: "/store/inventory",
    },
    lowStock.length > 0 && {
      label: "Low stock",
      value: formatNumber(lowStock.length),
      href: "/store/inventory",
    },
    Number(data.purchasing.pending_request_count) > 0 && {
      label: "Pending purchase requests",
      value: formatNumber(data.purchasing.pending_request_count),
      href: "/store/purchase-requests",
    },
    Number(data.purchasing.open_purchase_order_count) > 0 && {
      label: "Open purchase orders",
      value: formatNumber(data.purchasing.open_purchase_order_count),
      href: "/store/purchase-orders",
    },
    queueCount > 0 && {
      label: "Kitchen queue",
      value: formatNumber(queueCount),
      href: "/kitchen/queue",
    },
  ].filter(Boolean) as { label: string; value: string; href: string }[];
  const products = data.products.slice(0, 5);
  const stockIssues = [...outOfStock, ...lowStock.filter((item) => item.stock_status !== "OUT_OF_STOCK")].slice(0, 6);
  const hourly = [...data.operations.orders_by_hour]
    .sort((a, b) => Number(b.orders) - Number(a.orders))
    .slice(0, 4);
  const hourlyMax = Math.max(...hourly.map((item) => Number(item.orders)), 1);

  return (
    <div className="owner-dashboard">
      <div className="page-heading-row dashboard-heading">
        <div>
          <p className="eyebrow">Store workspace</p>
          <h1 className="page-title">{storeName}</h1>
          <p className="page-intro">A read-only operating view built from recorded store activity.</p>
        </div>
        <div className="dashboard-context">
          <span>Dashboard period</span>
          <strong>{periodLabel} - Asia/Jakarta</strong>
          <small>Updated from the analytics service</small>
        </div>
      </div>

      <section className="dashboard-kpi-grid" aria-label="Store performance summary">
        <Kpi label="Revenue" value={formatMoney(data.sales.revenue)} note="Paid, non-cancelled orders" />
        <Kpi label="Orders" value={formatNumber(data.sales.orders)} />
        <Kpi label="Average order value" value={formatMoney(data.sales.aov)} note={data.sales.orders ? undefined : "No qualifying orders"} />
        <Kpi label="Items sold" value={formatNumber(data.sales.items_sold)} />
      </section>

      <Section title="Needs attention" href="/store/analytics" linkLabel="Open analytics">
        {attentionItems.length === 0 ? (
          <div className="dashboard-clear-state">
            <strong>No immediate signals from the recorded data.</strong>
            <span>Inventory, purchasing, and kitchen counts are currently within the available view.</span>
          </div>
        ) : (
          <div className="dashboard-attention-grid">
            {attentionItems.map((item) => (
              <Link href={item.href} className="dashboard-attention-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>Open related view -&gt;</small>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <div className="dashboard-two-column">
        <Section title="Sales overview" href="/store/analytics" linkLabel="Full analytics">
          <div className="dashboard-mix-grid">
            <MixList
              title="Order type"
              rows={data.sales.by_order_type.map((row) => ({
                label: row.order_type.replaceAll("_", " "),
                value: Number(row.revenue),
                secondary: Number(row.orders),
              }))}
              label="Revenue shown from qualifying paid orders."
              supporting="orders"
            />
            <MixList
              title="Payment method"
              rows={data.sales.by_payment_method.map((row) => ({
                label: row.method === "QRIS" ? "QRIS / mock provider" : row.method,
                value: Number(row.revenue),
                secondary: Number(row.orders),
              }))}
              label="Payment labels follow persisted transaction values."
              supporting="orders"
            />
          </div>
        </Section>

        <Section title="Kitchen now" href="/kitchen/queue" linkLabel="Open kitchen">
          <div className="dashboard-stat-list">
            <div><span>Queued</span><strong>{formatNumber(data.operations.queued_count)}</strong></div>
            <div><span>Preparing</span><strong>{formatNumber(data.operations.preparing_count)}</strong></div>
            <div><span>Ready</span><strong>{formatNumber(data.operations.ready_count)}</strong></div>
            <div><span>Completed in period</span><strong>{formatNumber(data.operations.completed_orders)}</strong></div>
            <div><span>Average preparation</span><strong>{formatDuration(data.operations.average_preparation_seconds)}</strong></div>
          </div>
          {hourly.length > 0 && (
            <div className="dashboard-hours">
              <h3>Highest recorded order-volume hours</h3>
              {hourly.map((item) => (
                <div className="dashboard-hour-row" key={item.hour}>
                  <span>{String(item.hour).padStart(2, "0")}:00</span>
                  <div><i style={{ width: `${Math.max(5, (Number(item.orders) / hourlyMax) * 100)}%` }} /></div>
                  <b>{formatNumber(item.orders)}</b>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="dashboard-two-column">
        <Section title="Product performance" href="/store/analytics" linkLabel="View all products">
          {products.length === 0 ? (
            <Empty>No product sales in this period.</Empty>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
                <tbody>{products.map((product) => <tr key={product.product_id}><td>{product.product_name}<small>{product.category_name}</small></td><td>{formatNumber(product.units_sold)}</td><td>{formatMoney(product.revenue)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Inventory health" href="/store/inventory" linkLabel="Open inventory">
          <div className="dashboard-status-grid">
            <div><span>Inventory items</span><strong>{formatNumber(data.inventory.item_count)}</strong></div>
            <div className="dashboard-status-warning"><span>Low stock</span><strong>{formatNumber(data.inventory.low_stock_count)}</strong></div>
            <div className="dashboard-status-alert"><span>Out of stock</span><strong>{formatNumber(data.inventory.out_of_stock_count)}</strong></div>
          </div>
          {stockIssues.length === 0 ? (
            <Empty>No low-stock or out-of-stock items recorded.</Empty>
          ) : (
            <div className="dashboard-stock-list">
              {stockIssues.map((item) => <div key={item.id}><div><strong>{item.name}</strong><small>{item.unit}</small></div><span className={`dashboard-stock-status ${item.stock_status.toLowerCase()}`}>{stockStatusLabel(item.stock_status)}</span><b>{formatNumber(item.current_stock)}</b></div>)}
            </div>
          )}
        </Section>
      </div>

      <Section title="Purchasing and supply chain" href="/store/purchase-requests" linkLabel="Open purchasing">
        <div className="dashboard-status-grid dashboard-purchasing-grid">
          <div><span>Pending requests</span><strong>{formatNumber(data.purchasing.pending_request_count)}</strong></div>
          <div><span>Open purchase orders</span><strong>{formatNumber(data.purchasing.open_purchase_order_count)}</strong></div>
          <div><span>Receipts in period</span><strong>{formatNumber(data.purchasing.receipt_count)}</strong></div>
          <div><span>Suppliers</span><strong>{formatNumber(data.purchasing.supplier_count)}</strong></div>
        </div>
        <p className="dashboard-note">{data.purchasing.received_value_available ? `Recorded receiving value: ${formatMoney(data.purchasing.received_value)}.` : "Recorded receiving value is unavailable because one or more receipt lines have no persisted unit price."}</p>
      </Section>
    </div>
  );
}

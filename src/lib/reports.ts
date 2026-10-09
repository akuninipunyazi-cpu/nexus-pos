import {
  getStoreAnalytics,
  normalizeRange as normalizeAnalyticsRange,
  type AnalyticsData,
  type AnalyticsRange,
} from "@/lib/analytics";

export type ReportKind = "sales" | "products" | "inventory" | "purchasing" | "operations";

export const REPORT_OPTIONS: { key: ReportKind; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "products", label: "Products" },
  { key: "inventory", label: "Inventory" },
  { key: "purchasing", label: "Purchasing" },
  { key: "operations", label: "Operations" },
];

export const REPORT_DISPLAY_LIMIT = 500;
export const REPORT_EXPORT_LIMIT = 5000;

export function normalizeReport(value: string | undefined): ReportKind {
  return REPORT_OPTIONS.some((option) => option.key === value) ? (value as ReportKind) : "sales";
}

export function normalizeReportRange(value: string | undefined): AnalyticsRange {
  return normalizeAnalyticsRange(value);
}

export function reportLabel(report: ReportKind) {
  return REPORT_OPTIONS.find((option) => option.key === report)?.label ?? "Sales";
}

export function reportRowCount(report: ReportKind, data: AnalyticsData) {
  if (report === "products") return 3 + data.products.length;
  if (report === "inventory") return 3 + data.inventory.items.length + data.inventory.consumption_by_item.length;
  if (report === "purchasing") return 7 + data.purchasing.suppliers.length * 2;
  if (report === "operations") return 8 + data.operations.orders_by_hour.length;
  return 7 + data.sales.by_order_type.length + data.sales.by_payment_method.length;
}

function csvCell(value: string | number | null | undefined) {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+@-]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows: (string | number | null | undefined)[][]) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function reportToCsv(report: ReportKind, range: AnalyticsRange, data: AnalyticsData) {
  if (report === "sales") {
    const rows: (string | number | null | undefined)[][] = [
      ["report", reportLabel(report), "period", range],
      [],
      ["section", "metric", "dimension", "orders", "revenue", "value"],
      ["summary", "revenue", "", "", "", data.sales.revenue],
      ["summary", "orders", "", data.sales.orders, "", ""],
      ["summary", "average_order_value", "", "", "", data.sales.aov],
      ["summary", "items_sold", "", "", "", data.sales.items_sold],
      ...data.sales.by_order_type.map((item) => ["order_type", "breakdown", item.order_type, item.orders, item.revenue, ""]),
      ...data.sales.by_payment_method.map((item) => ["payment_method", "breakdown", item.method, item.orders, item.revenue, ""]),
    ];
    return rowsToCsv(rows);
  }

  if (report === "products") {
    return rowsToCsv([
      ["report", reportLabel(report), "period", range],
      [],
      ["product_id", "product_name", "category_name", "units_sold", "revenue"],
      ...data.products.map((item) => [item.product_id, item.product_name, item.category_name, item.units_sold, item.revenue]),
    ]);
  }

  if (report === "inventory") {
    return rowsToCsv([
      ["report", reportLabel(report), "period", range],
      [],
      ["section", "item_id", "item_name", "unit", "current_stock", "minimum_stock", "stock_status", "quantity"],
      ...data.inventory.items.map((item) => ["current_stock", item.id, item.name, item.unit, item.current_stock, item.minimum_stock, item.stock_status, ""]),
      ...data.inventory.consumption_by_item.map((item) => ["consumption", item.inventory_item_id, item.item_name, item.unit, "", "", "", item.quantity]),
    ]);
  }

  if (report === "purchasing") {
    return rowsToCsv([
      ["report", reportLabel(report), "period", range],
      [],
      ["section", "metric", "supplier_id", "supplier_name", "count", "quantity", "value"],
      ["summary", "pending_requests", "", "", data.purchasing.pending_request_count, "", ""],
      ["summary", "open_purchase_orders", "", "", data.purchasing.open_purchase_order_count, "", ""],
      ["summary", "receipts", "", "", data.purchasing.receipt_count, data.purchasing.received_quantity, data.purchasing.received_value_available ? data.purchasing.received_value : ""],
      ["scope", "Current request, order, and supplier counts are current/all-time 7A values; receipt metrics use the selected period."],
      ...data.purchasing.suppliers.map((item) => ["supplier", "purchase_orders", item.supplier_id, item.supplier_name, item.purchase_orders, "", ""]),
      ...data.purchasing.suppliers.map((item) => ["supplier", "received_orders", item.supplier_id, item.supplier_name, item.received_orders, "", ""]),
    ]);
  }

  return rowsToCsv([
    ["report", reportLabel(report), "period", range],
    [],
    ["section", "metric", "hour", "value"],
    ["summary", "completed_orders", "", data.operations.completed_orders],
    ["summary", "queued_now", "", data.operations.queued_count],
    ["summary", "preparing_now", "", data.operations.preparing_count],
    ["summary", "ready_now", "", data.operations.ready_count],
    ["summary", "average_preparation_seconds", "", data.operations.average_preparation_seconds],
    ...data.operations.orders_by_hour.map((item) => ["orders_by_hour", "orders", item.hour, item.orders]),
  ]);
}

export async function getReportData(range: AnalyticsRange) {
  try {
    return await getStoreAnalytics(range, "revenue");
  } catch {
    return null;
  }
}

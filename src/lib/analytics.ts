import { createClient } from "@/lib/supabase/server";

export type AnalyticsRange = "today" | "7d" | "30d";
export type ProductSort = "revenue" | "units";

export type AnalyticsData = {
  sales: {
    revenue: number;
    orders: number;
    aov: number | null;
    items_sold: number;
    by_order_type: { order_type: string; orders: number; revenue: number }[];
    by_payment_method: { method: string; orders: number; revenue: number }[];
  };
  products: { product_id: string; product_name: string; category_name: string; units_sold: number; revenue: number }[];
  inventory: {
    item_count: number;
    low_stock_count: number;
    out_of_stock_count: number;
    consumption_quantity: number;
    items: { id: string; name: string; unit: string; minimum_stock: number; current_stock: number; stock_status: string }[];
    consumption_by_item: { inventory_item_id: string; item_name: string; unit: string; quantity: number }[];
  };
  purchasing: {
    pending_request_count: number;
    open_purchase_order_count: number;
    receipt_count: number;
    received_quantity: number;
    received_value: number | null;
    received_value_available: boolean;
    supplier_count: number;
    suppliers: { supplier_id: string; supplier_name: string; purchase_orders: number; received_orders: number }[];
  };
  operations: {
    completed_orders: number;
    queued_count: number;
    preparing_count: number;
    ready_count: number;
    average_preparation_seconds: number | null;
    orders_by_hour: { hour: number; orders: number }[];
  };
};

const jakartaParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
};

export function normalizeRange(value: string | undefined): AnalyticsRange {
  return value === "7d" || value === "30d" ? value : "today";
}

export function normalizeProductSort(value: string | undefined): ProductSort {
  return value === "units" ? "units" : "revenue";
}

export function getAnalyticsPeriod(range: AnalyticsRange) {
  const now = new Date();
  const current = jakartaParts(now);
  const currentMidnightUtc = Date.UTC(current.year, current.month - 1, current.day);
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const startJakarta = new Date(currentMidnightUtc - (days - 1) * 86400000);
  const endJakarta = new Date(currentMidnightUtc + 86400000);
  const jakartaOffset = 7 * 60 * 60 * 1000;
  return {
    start: new Date(startJakarta.getTime() - jakartaOffset),
    end: new Date(endJakarta.getTime() - jakartaOffset),
    label: range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days",
  };
}

export async function getStoreAnalytics(
  range: AnalyticsRange,
  productSort: ProductSort,
): Promise<AnalyticsData | null> {
  const period = getAnalyticsPeriod(range);
  const db = await createClient();
  const result = await db.rpc("get_store_analytics", {
    p_start: period.start.toISOString(),
    p_end: period.end.toISOString(),
    p_product_sort: productSort,
  });
  if (result.error || !result.data) return null;
  return result.data as AnalyticsData;
}

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "�w^~)�t";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function number(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "�w^~)�t";
  const totalMinutes = Math.round(Number(seconds) / 60);
  if (totalMinutes < 1) return "<1 min";
  return totalMinutes + " min";
}

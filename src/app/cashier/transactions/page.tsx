import { CashierOrderList } from "@/components/cashier/order-list";
import { getCashierOrders, requireCashier } from "@/lib/cashier";

export default async function TransactionsPage() { const { tenantId } = await requireCashier(); const orders = await getCashierOrders(); return <><p className="eyebrow">Cashier</p><h1 className="page-title">Transactions</h1><p className="page-intro">Tenant-scoped payment and order history.</p><section className="platform-section"><CashierOrderList tenantId={tenantId} orders={orders} filter="paid" enableLiveUpdates={false} /></section><section className="platform-section"><div className="section-heading"><h2>All orders</h2></div><CashierOrderList tenantId={tenantId} orders={orders} filter="all" /></section></> }

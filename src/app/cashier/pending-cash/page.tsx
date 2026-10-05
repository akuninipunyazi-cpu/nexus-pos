import { CashierOrderList } from "@/components/cashier/order-list";
import { getCashierOrders, requireCashier } from "@/lib/cashier";

export default async function PendingCashPage() { const { tenantId } = await requireCashier(); const orders = await getCashierOrders(); return <><p className="eyebrow">Cashier</p><h1 className="page-title">Pending cash</h1><p className="page-intro">Confirm only after cash has actually been received.</p><section className="platform-section"><CashierOrderList tenantId={tenantId} orders={orders} filter="pending" /></section></> }
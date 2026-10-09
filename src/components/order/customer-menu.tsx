"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicOrder, getPublicOrderStatus, retryPublicQrisPayment } from "@/app/order/actions";
import { createClient } from "@/lib/supabase/client";

type Product = { id: string; name: string; description: string | null; price: number | string; image_url: string | null; category: string };
type Category = { name: string };
type CartItem = { id: string; name: string; price: number; quantity: number; note: string };

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function CustomerMenu({ tenantSlug, tenantName, tableToken, tableNumber, categories, products }: {
  tenantSlug: string; tenantName: string; tableToken: string; tableNumber: string; categories: Category[]; products: Product[];
}) {
  const router = useRouter();
  const storageKey = `coffee-cart:${tenantSlug}:${tableToken}`;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [category, setCategory] = useState("ALL");
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const saved = window.localStorage.getItem(storageKey); if (saved) setCart(JSON.parse(saved)); } catch {} setReady(true); }, [storageKey]);
  useEffect(() => { if (ready) window.localStorage.setItem(storageKey, JSON.stringify(cart)); }, [cart, ready, storageKey]);
  const visible = category === "ALL" ? products : products.filter((product) => product.category === category);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  function add(product: Product) {
    setCart((current) => {
      const found = current.find((item) => item.id === product.id);
      if (found) return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { id: product.id, name: product.name, price: Number(product.price), quantity: 1, note: "" }];
    });
  }
  return <main className="customer-order">
    <header className="customer-header"><p className="customer-store">{tenantName}</p><h1>Menu</h1><p>Table {tableNumber}</p></header>
    <nav className="customer-categories" aria-label="Categories"><button className={category === "ALL" ? "selected" : ""} onClick={() => setCategory("ALL")}>All</button>{categories.map((item) => <button key={item.name} className={category === item.name ? "selected" : ""} onClick={() => setCategory(item.name)}>{item.name}</button>)}</nav>
    <section className="customer-products">{visible.length === 0 ? <div className="customer-empty">No items in this category.</div> : visible.map((product) => <article className="customer-product" key={product.id}><div><p className="customer-product-category">{product.category}</p><h2>{product.name}</h2>{product.description && <p>{product.description}</p>}<strong>{money.format(Number(product.price))}</strong></div><button className="add-button" onClick={() => add(product)} aria-label={`Add ${product.name}`}>+</button></article>)}</section>
    {totalItems > 0 && <button className="cart-bar" onClick={() => router.push(`/order/${tenantSlug}/${tableToken}/checkout`)}><span><b>{totalItems}</b> items</span><strong>{money.format(total)}</strong><span>View cart</span></button>}
    <div className="sr-only" aria-live="polite">{totalItems} items in cart</div><div className="customer-cart-data" aria-hidden="true">{cart.map((item) => <span key={item.id}>{item.note}</span>)}</div>
  </main>;
}

export function CheckoutClient({ tenantSlug, tableToken, tableNumber, qrisAvailable }: { tenantSlug: string; tableToken: string; tableNumber: string; qrisAvailable: boolean }) {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [method, setMethod] = useState<"CASH" | "QRIS">("CASH");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const storageKey = `coffee-cart:${tenantSlug}:${tableToken}`;
  const orderKeyStorage = `${storageKey}:order-key`;
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => { try { const saved = window.localStorage.getItem(storageKey); if (saved) setCart(JSON.parse(saved)); let key = window.localStorage.getItem(orderKeyStorage); if (!key) { key = crypto.randomUUID(); window.localStorage.setItem(orderKeyStorage, key); } setIdempotencyKey(key); } catch {} }, [orderKeyStorage, storageKey]);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  function change(id: string, delta: number) { setCart((current) => current.flatMap((item) => item.id !== id ? [item] : item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta }])); }
  function updateNote(id: string, value: string) { setCart((current) => current.map((item) => item.id === id ? { ...item, note: value.slice(0, 500) } : item)); }
  async function place() {
    setError(null);
    if (!cart.length) { setError("Your cart is empty."); return; }
    setPending(true);
    const form = new FormData();
    form.set("tenantSlug", tenantSlug); form.set("tableToken", tableToken); form.set("paymentMethod", method);
    const requestKey = idempotencyKey || crypto.randomUUID();
    form.set("idempotencyKey", requestKey);
    form.set("items", JSON.stringify(cart.map((item) => ({ product_id: item.id, quantity: item.quantity, note: item.note }))));
    const result = await createPublicOrder(form);
    setPending(false);
    if (!result.data) { setError(result.error ?? "This order could not be created."); return; }
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(orderKeyStorage);
    if (method === "QRIS" && result.data.checkout_url) { window.location.assign(result.data.checkout_url); return; }
    if (result.error) setError(result.error);
    router.push(`/order/${tenantSlug}/${tableToken}/status/${result.data.order_id}?access=${encodeURIComponent(result.data.customer_access_token)}`);
  }
  return <main className="customer-checkout">
    <button className="back-link" onClick={() => router.back()}>← Menu</button>
    <header className="checkout-header"><p className="customer-store">Table {tableNumber}</p><h1>Checkout</h1></header>
    {cart.length === 0 ? <div className="customer-empty"><h2>Your cart is empty.</h2><button className="primary-button compact" onClick={() => router.back()}>Back to menu</button></div> : <>
      <section className="checkout-items">{cart.map((item) => <article className="checkout-item" key={item.id}><div><h2>{item.name}</h2><p>{money.format(item.price)} each</p><input className="item-note" value={item.note} maxLength={500} onChange={(event) => updateNote(item.id, event.target.value)} placeholder="Add a note (optional)" /></div><div className="quantity-control"><button onClick={() => change(item.id, -1)} aria-label={`Decrease ${item.name}`}>−</button><span>{item.quantity}</span><button onClick={() => change(item.id, 1)} aria-label={`Increase ${item.name}`}>+</button></div><strong>{money.format(item.price * item.quantity)}</strong></article>)}</section>
      <section className="checkout-total"><span>Total</span><strong>{money.format(total)}</strong></section>
      <section className="payment-choice"><h2>Payment</h2><label className={method === "CASH" ? "payment-option selected" : "payment-option"}><input type="radio" checked={method === "CASH"} onChange={() => setMethod("CASH")} />Cash <small>Pay at the cashier</small></label>
        {qrisAvailable ? <label className={method === "QRIS" ? "payment-option selected" : "payment-option"}><input type="radio" checked={method === "QRIS"} onChange={() => setMethod("QRIS")} />QRIS <small>Continue to Midtrans secure checkout</small></label> : <p className="payment-settings-note">QRIS is not enabled for this store. Cash is still available.</p>}
      </section>
      {error && <p className="customer-error" role="alert">{error}</p>}
      <button className="place-order" disabled={pending || (method === "QRIS" && !qrisAvailable)} onClick={place}>{pending ? "Creating order..." : method === "QRIS" ? "Continue to QRIS" : "Place order"}</button>
    </>}
  </main>;
}

type StatusData = {
  order_number: string; table_number: string; order_status: string; payment_status: string; payment_method?: string;
  payment_attempt?: { status: string; checkout_url: string | null; expires_at: string | null } | null;
  total: number | string; items: { name: string; quantity: number; line_total: number | string }[];
};

export function OrderStatus({ initial, tenantSlug, tableToken, orderId, accessToken }: { initial: StatusData; tenantSlug: string; tableToken: string; orderId: string; accessToken: string }) {
  const [data, setData] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    async function refreshStatus() {
      const form = new FormData(); form.set("tenantSlug", tenantSlug); form.set("tableToken", tableToken); form.set("orderId", orderId); form.set("accessToken", accessToken);
      const result = await getPublicOrderStatus(form);
      if (result.data) setData(result.data as unknown as StatusData);
      else if (result.error) setNotice(result.error);
    }
    const supabase = createClient();
    const channel = supabase.channel("customer-order:" + accessToken)
      .on("broadcast", { event: "order.updated" }, (event: { payload?: { order_id?: string } }) => { if (event.payload?.order_id === orderId) void refreshStatus(); })
      .subscribe((status: string) => { if (status === "SUBSCRIBED") void refreshStatus(); });
    const fallback = window.setInterval(() => void refreshStatus(), 30000);
    return () => { window.clearInterval(fallback); void supabase.removeChannel(channel); };
  }, [accessToken, orderId, tableToken, tenantSlug]);

  async function retryQris() {
    setRetrying(true); setNotice(null);
    const form = new FormData(); form.set("tenantSlug", tenantSlug); form.set("tableToken", tableToken); form.set("orderId", orderId); form.set("accessToken", accessToken);
    const result = await retryPublicQrisPayment(form); setRetrying(false);
    if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
    else if (result.error) setNotice(result.error);
    else setNotice("Payment setup is still processing. Refresh this page shortly.");
  }

  const stages = ["PENDING_PAYMENT", "QUEUED", "PREPARING", "READY", "COMPLETED"];
  const current = stages.indexOf(data.order_status);
  const attempt = data.payment_attempt;
  return <main className="customer-status">
    <header className="status-header"><p className="customer-store">Table {data.table_number}</p><h1>Order #{data.order_number}</h1><p>Live status updates</p></header>
    <section className="status-payment"><span>Payment</span><strong>{data.payment_status === "PAID" ? "Paid" : data.payment_status === "PENDING" ? "Pending" : data.payment_status}</strong></section>
    {data.payment_method === "QRIS" && data.payment_status !== "PAID" && <section className="qris-status" aria-live="polite">
      <h2>{attempt?.status === "EXPIRED" ? "QRIS expired" : attempt?.status === "FAILED" ? "Payment failed" : attempt?.status === "CANCELLED" ? "Payment cancelled" : "Waiting for QRIS payment"}</h2>
      <p>{attempt?.expires_at ? `Payment window ends ${new Date(attempt.expires_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB.` : "Payment confirmation comes from Midtrans."}</p>
      {attempt?.checkout_url && <a className="secondary-button" href={attempt.checkout_url} target="_blank" rel="noreferrer">Open Midtrans QRIS checkout</a>}
      {(!attempt || ["EXPIRED", "FAILED"].includes(attempt.status)) && <button className="primary-button compact" type="button" disabled={retrying} onClick={retryQris}>{retrying ? "Preparing…" : "Try QRIS again"}</button>}
    </section>}
    <section className="status-steps">{stages.map((stage, index) => <div className={index <= current ? "status-step current" : "status-step"} key={stage}><span>{index + 1}</span><p>{stage === "PENDING_PAYMENT" ? "Order received" : stage.charAt(0) + stage.slice(1).toLowerCase()}</p></div>)}</section>
    <section className="status-order-items">{data.items.map((item) => <div key={item.name + "-" + item.quantity}><span>{item.quantity} × {item.name}</span><strong>{money.format(Number(item.line_total))}</strong></div>)}<div className="status-total"><span>Total</span><strong>{money.format(Number(data.total))}</strong></div></section>
    {notice && <p className="customer-error" role="alert">{notice}</p>}
  </main>;
}

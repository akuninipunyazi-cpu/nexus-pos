"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { createPurchaseRequest, setPurchaseRequestStatus } from "@/app/inventory-actions";

type InventoryItem = { id: string; name: string; unit: string };
type RequestItem = { inventory_item_id: string; item_name: string; quantity: number | string; unit: string };
type RequestRow = { id: string; request_number: string; status: string; supplier_name: string | null; items: RequestItem[] };
type Supplier = { id: string; name: string };
type DraftItem = { inventoryItemId: string; quantity: string };

export function RequestWorkspace({ requests, suppliers, inventoryItems, owner = false }: { requests: RequestRow[]; suppliers: Supplier[]; inventoryItems: InventoryItem[]; owner?: boolean }) {
  const [items, setItems] = useState<DraftItem[]>([{ inventoryItemId: "", quantity: "" }]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    const selected = items.filter((item) => item.inventoryItemId && item.quantity);
    if (!selected.length || selected.length !== items.length || selected.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setSuccess(false);
      setMessage("Pilih bahan dan masukkan jumlah lebih dari nol untuk setiap baris.");
      return;
    }
    if (new Set(selected.map((item) => item.inventoryItemId)).size !== selected.length) {
      setSuccess(false);
      setMessage("Setiap bahan hanya boleh ditambahkan satu kali.");
      return;
    }

    const formData = new FormData(form);
    formData.set("items", JSON.stringify(selected.map((item) => ({ inventory_item_id: item.inventoryItemId, quantity: Number(item.quantity) }))));
    idempotencyKey.current ??= crypto.randomUUID();
    formData.set("idempotencyKey", idempotencyKey.current);
    startTransition(async () => {
      try {
        const result = await createPurchaseRequest(formData);
        setSuccess(result.ok);
        setMessage(result.message);
        if (result.ok) {
          idempotencyKey.current = null;
          setItems([{ inventoryItemId: "", quantity: "" }]);
          form.reset();
        }
      } catch {
        setSuccess(false);
        setMessage("Purchase request belum dapat dikirim. Muat ulang halaman dan coba lagi.");
      }
    });
  }

  return <><section className="inline-section"><div className="section-heading"><div><p className="eyebrow">Purchase request</p><h2>Create request</h2></div></div><form className="product-form" onSubmit={submit}><div className="inventory-form-lines">{items.map((item, index) => <div className="inventory-form-line" key={index}><select aria-label={`Inventory item ${index + 1}`} value={item.inventoryItemId} onChange={(event) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, inventoryItemId: event.target.value } : line))} required><option value="" disabled>Choose inventory item</option>{inventoryItems.map((inventoryItem) => <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} ({inventoryItem.unit})</option>)}</select><input aria-label={`Requested quantity ${index + 1}`} type="number" min="0.001" step="any" inputMode="decimal" placeholder="Quantity" value={item.quantity} onChange={(event) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: event.target.value } : line))} required/><button type="button" className="text-button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></div>)}</div><button type="button" className="secondary-button" disabled={inventoryItems.length === 0} onClick={() => setItems((current) => [...current, { inventoryItemId: "", quantity: "" }])}>Add item</button><select name="supplierId" defaultValue=""><option value="">Supplier optional</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><input name="reason" placeholder="Reason" maxLength={500} required/><textarea name="notes" placeholder="Notes (optional)" maxLength={1000}/><button className="primary-button compact" disabled={pending || inventoryItems.length === 0}>{pending ? "Sending…" : "Submit request"}</button>{inventoryItems.length === 0 && <p className="field-help">Create an active inventory item before requesting a purchase.</p>}{message && <p className={success ? "form-success" : "form-error"} role={success ? "status" : "alert"}>{message}</p>}</form></section><div className="table-wrap"><table><thead><tr><th>Request</th><th>Items</th><th>Status</th><th>Action</th></tr></thead><tbody>{requests.length ? requests.map((request) => <tr key={request.id}><td>{request.request_number}<small>{request.supplier_name ?? "No supplier"}</small></td><td>{request.items.map((item) => <span className="list-chip" key={item.inventory_item_id}>{item.item_name} {item.quantity}{item.unit}</span>)}</td><td><span className={"status status-" + request.status.toLowerCase()}>{request.status}</span></td><td>{owner && request.status === "SUBMITTED" ? <><form action={setPurchaseRequestStatus}><input type="hidden" name="requestId" value={request.id}/><input type="hidden" name="status" value="APPROVED"/><button className="text-button">Approve</button></form><form action={setPurchaseRequestStatus}><input type="hidden" name="requestId" value={request.id}/><input type="hidden" name="status" value="REJECTED"/><button className="text-button">Reject</button></form></> : null}</td></tr>) : <tr><td colSpan={4}>No purchase requests yet.</td></tr>}</tbody></table></div></>;
}

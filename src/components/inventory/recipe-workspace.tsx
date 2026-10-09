"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveRecipe } from "@/app/inventory-actions";

type Product = { id: string; name: string };
type InventoryItem = { id: string; name: string; unit: string };
type RecipeItem = { inventory_item_id: string; inventory_name: string; quantity: number | string; unit: string };
type Recipe = { id: string; product_name: string; is_active: boolean; items: RecipeItem[] };
type DraftItem = { inventoryItemId: string; quantity: string };

export function RecipeWorkspace({ products, inventoryItems = [], recipes, readOnly = false }: { products: Product[]; inventoryItems?: InventoryItem[]; recipes: Recipe[]; readOnly?: boolean }) {
  const [items, setItems] = useState<DraftItem[]>([{ inventoryItemId: "", quantity: "" }]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    const formData = new FormData(event.currentTarget);
    formData.set("items", JSON.stringify(selected.map((item) => {
      const inventoryItem = inventoryItems.find((candidate) => candidate.id === item.inventoryItemId)!;
      return { inventory_item_id: inventoryItem.id, quantity: Number(item.quantity), unit: inventoryItem.unit };
    })));
    startTransition(async () => {
      try {
        const result = await saveRecipe(formData);
        setSuccess(result.ok);
        setMessage(result.message);
        if (result.ok) setItems([{ inventoryItemId: "", quantity: "" }]);
      } catch {
        setSuccess(false);
        setMessage("Recipe belum dapat disimpan. Muat ulang halaman dan coba lagi.");
      }
    });
  }

  return <><section className="inline-section"><div className="section-heading"><div><p className="eyebrow">Recipe / BOM</p><h2>{readOnly ? "Configured recipes" : "Save a recipe"}</h2></div></div>{!readOnly && <form className="product-form" onSubmit={submit}><select name="productId" defaultValue="" required><option value="" disabled>Product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><select name="isActive" defaultValue="true"><option value="true">Active</option><option value="false">Inactive</option></select><div className="inventory-form-lines">{items.map((item, index) => <div className="inventory-form-line" key={index}><select aria-label={`Ingredient ${index + 1}`} value={item.inventoryItemId} onChange={(event) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, inventoryItemId: event.target.value } : line))} required><option value="" disabled>Choose ingredient</option>{inventoryItems.map((inventoryItem) => <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} ({inventoryItem.unit})</option>)}</select><input aria-label={`Quantity ${index + 1}`} type="number" min="0.001" step="any" inputMode="decimal" placeholder="Quantity" value={item.quantity} onChange={(event) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: event.target.value } : line))} required/><button type="button" className="text-button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></div>)}</div><div className="inventory-form-actions"><button type="button" className="secondary-button" disabled={inventoryItems.length === 0} onClick={() => setItems((current) => [...current, { inventoryItemId: "", quantity: "" }])}>Add ingredient</button><button className="primary-button compact" disabled={pending || products.length === 0 || inventoryItems.length === 0}>{pending ? "Saving…" : "Save recipe"}</button></div>{products.length === 0 && <p className="field-help">Create a product before configuring a recipe.</p>}{inventoryItems.length === 0 && <p className="field-help">Create an active inventory item before configuring a recipe.</p>}{message && <p className={success ? "form-success" : "form-error"} role={success ? "status" : "alert"}>{message}</p>}</form>}<p className="field-help">Use each inventory item once and its canonical unit. Recipes are validated server-side; no silent unit conversion.</p></section><div className="table-wrap"><table><thead><tr><th>Product</th><th>Status</th><th>Ingredients</th></tr></thead><tbody>{recipes.length ? recipes.map((recipe) => <tr key={recipe.id}><td>{recipe.product_name}</td><td><span className={"status " + (recipe.is_active ? "status-active" : "status-expired")}>{recipe.is_active ? "Active" : "Inactive"}</span></td><td>{recipe.items.map((item) => <span key={item.inventory_item_id} className="list-chip">{item.inventory_name} {item.quantity}{item.unit}</span>)}</td></tr>) : <tr><td colSpan={3}>No recipes configured.</td></tr>}</tbody></table></div></>;
}

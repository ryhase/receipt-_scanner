"use client";

import { ChangeEvent, useRef, useState } from "react";
import type { Receipt } from "@/lib/receipt";

type State = "idle" | "scanning" | "ready" | "saving" | "saved" | "error";

const emptyReceipt: Receipt = { purchasedAt: null, merchant: null, total: null, currency: null, tax: null, paymentMethod: null, items: [], rawText: null };

export function ReceiptScanner() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>("idle");
  const [receipt, setReceipt] = useState<Receipt>(emptyReceipt);
  const [preview, setPreview] = useState<string>();
  const [message, setMessage] = useState("");

  async function scan(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    if (!image) return;
    setPreview(URL.createObjectURL(image));
    setState("scanning"); setMessage("");
    const data = new FormData(); data.set("image", image);
    try {
      const response = await fetch("/api/scan", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReceipt(body.receipt); setState("ready");
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "読み取りに失敗しました。");
    } finally { event.target.value = ""; }
  }

  function set<K extends keyof Receipt>(key: K, value: Receipt[K]) { setReceipt((current) => ({ ...current, [key]: value })); }
  function addItem() { setReceipt((current) => ({ ...current, items: [...current.items, { name: "", quantity: 1, amount: null }] })); }
  function updateItem(index: number, key: "name" | "quantity" | "amount", value: string) {
    setReceipt((current) => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, [key]: key === "name" ? value : value === "" ? null : Number(value) } : item) }));
  }
  function removeItem(index: number) { setReceipt((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) })); }

  async function save() {
    setState("saving"); setMessage("");
    try {
      const response = await fetch("/api/append", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setState("saved"); setMessage(`${body.sheetName} シートに ${body.rowCount} 行を追加しました。`);
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "保存に失敗しました。"); }
  }

  const busy = state === "scanning" || state === "saving";
  return <div className="shell">
    <header><p className="eyebrow">RECEIPT FLOW</p><h1>レシートを、そのまま帳簿へ。</h1><p className="lead">撮影したレシートを読み取り、内容を確認してから月別のスプレッドシートに追加します。</p></header>
    <section className="grid">
      <div className="card upload-card">
        <h2>1. レシートを撮影</h2>
        <input ref={inputRef} id="receipt-image" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={scan} hidden />
        <button className="upload" onClick={() => inputRef.current?.click()} disabled={busy}>{state === "scanning" ? "読み取り中…" : "カメラまたは画像を選ぶ"}</button>
        <p className="hint">JPEG / PNG / WebP、10MBまで。画像はサーバーに保存しません。</p>
        {preview && <img className="preview" src={preview} alt="選択したレシートのプレビュー" />}
      </div>
      <div className="card">
        <h2>2. 読み取り結果を確認</h2>
        {state === "idle" || state === "scanning" ? <p className="empty">画像を選ぶと、ここに読み取り結果が表示されます。</p> : <ReceiptForm receipt={receipt} set={set} updateItem={updateItem} removeItem={removeItem} addItem={addItem} />}
      </div>
    </section>
    {message && <p className={`notice ${state === "error" ? "error" : "success"}`}>{message}</p>}
    <footer><button className="save" disabled={state !== "ready" && state !== "saved"} onClick={save}>{state === "saving" ? "追加中…" : "3. スプレッドシートへ追加"}</button><p>保存先: 利用日をもとにした <code>YYYYMM</code> シート（なければ自動作成）</p></footer>
  </div>;
}

function ReceiptForm({ receipt, set, updateItem, removeItem, addItem }: { receipt: Receipt; set: <K extends keyof Receipt>(key: K, value: Receipt[K]) => void; updateItem: (index: number, key: "name" | "quantity" | "amount", value: string) => void; removeItem: (index: number) => void; addItem: () => void }) {
  const text = (value: string | null) => value ?? "";
  const numeric = (value: number | null) => value ?? "";
  return <div className="form">
    <div className="fields"><label>利用日<input type="date" value={text(receipt.purchasedAt)} onChange={(e) => set("purchasedAt", e.target.value || null)} /></label><label>店舗名<input value={text(receipt.merchant)} onChange={(e) => set("merchant", e.target.value || null)} /></label><label>合計<input type="number" min="0" step="0.01" value={numeric(receipt.total)} onChange={(e) => set("total", e.target.value === "" ? null : Number(e.target.value))} /></label><label>通貨<input maxLength={3} value={text(receipt.currency)} onChange={(e) => set("currency", e.target.value.toUpperCase() || null)} /></label><label>税額<input type="number" min="0" step="0.01" value={numeric(receipt.tax)} onChange={(e) => set("tax", e.target.value === "" ? null : Number(e.target.value))} /></label><label>支払方法<input value={text(receipt.paymentMethod)} onChange={(e) => set("paymentMethod", e.target.value || null)} /></label></div>
    <div className="items"><div className="items-heading"><h3>品目</h3><button type="button" onClick={addItem}>＋ 追加</button></div>{receipt.items.map((item, index) => <div className="item" key={index}><input aria-label="品目名" placeholder="品目名" value={item.name} onChange={(e) => updateItem(index, "name", e.target.value)} /><input aria-label="数量" type="number" min="0" step="0.01" placeholder="数量" value={numeric(item.quantity)} onChange={(e) => updateItem(index, "quantity", e.target.value)} /><input aria-label="金額" type="number" min="0" step="0.01" placeholder="金額" value={numeric(item.amount)} onChange={(e) => updateItem(index, "amount", e.target.value)} /><button aria-label="品目を削除" type="button" onClick={() => removeItem(index)}>×</button></div>)}</div>
    <label>OCRテキスト<textarea rows={4} value={text(receipt.rawText)} onChange={(e) => set("rawText", e.target.value || null)} /></label>
  </div>;
}

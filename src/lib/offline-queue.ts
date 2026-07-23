// IndexedDB-backed offline queue for sales.
import { supabase } from "@/integrations/supabase/client";
import type { SalePayload } from "./sales-types";

const DB_NAME = "waterbomb-sales";
const STORE = "queue";
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueSale(sale: SalePayload): Promise<void> {
  await tx("readwrite", (s) => s.put(sale));
  emit();
}

export async function listQueue(): Promise<SalePayload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as SalePayload[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(client_id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(client_id));
  emit();
}

export async function queueSize(): Promise<number> {
  return (await listQueue()).length;
}

// simple event emitter for queue changes
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit() {
  listeners.forEach((l) => l());
}

async function sendOne(sale: SalePayload): Promise<{ ok: boolean; permanent?: boolean; error?: string }> {
  const { error } = await supabase.rpc("insert_sale" as never, {
    p_client_id: sale.client_id,
    p_bundle: sale.bundle,
    p_items: sale.items,
    p_price: sale.price,
    p_age_group: sale.age_group,
    p_gender: sale.gender,
    p_group_type: sale.group_type,
    p_headcount: sale.headcount,
    p_foreign_flag: sale.foreign_flag,
    p_upsell: sale.upsell,
    p_weather: sale.weather,
  } as never);
  if (!error) return { ok: true };
  const msg = error.message || "";
  // permanent errors (out of stock, unique conflict handled by RPC as idempotent)
  if (msg.includes("재고 부족") || msg.includes("unknown sku")) {
    return { ok: false, permanent: true, error: msg };
  }
  return { ok: false, error: msg };
}

let flushing = false;
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const items = await listQueue();
    for (const item of items) {
      const res = await sendOne(item);
      if (res.ok) {
        await removeFromQueue(item.client_id);
        sent++;
      } else if (res.permanent) {
        // drop permanent failures so queue doesn't stall
        await removeFromQueue(item.client_id);
        failed++;
      } else {
        failed++;
        break; // network-ish failure: stop and retry later
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

export function startAutoFlush() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    void flushQueue();
  });
  // periodic retry
  setInterval(() => {
    if (navigator.onLine) void flushQueue();
  }, 15000);
  // initial
  if (navigator.onLine) void flushQueue();
}

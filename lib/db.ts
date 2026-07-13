/**
 * IndexedDB helpers — offline-first storage for CardPit.
 *
 * Stores:
 *   cart          — items the vendor added during a deal (keyed by id)
 *   settings      — vendor percentages & condition multipliers (single row)
 *   priceCache    — Cardmarket prices by card ID (TTL enforced in priceService)
 *   inventory     — cards the vendor owns (fase 2)
 *   transactions  — every buy/sell/trade, source for dagoverzicht (fase 2)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Lang } from "./i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Condition = "MT" | "NM" | "EX" | "GD" | "LP" | "PL" | "PO";

export type PaymentMethod = "cash" | "tikkie" | "pin" | "trade" | "other";

export type CartItem = {
  id: string;           // uuid generated client-side
  cardId: string;       // Pokemon TCG API card id
  cardName: string;
  cardSet: string;
  cardImageUrl: string;
  condition: Condition;
  type: "inkoop" | "inruil";
  quantity: number;         // same card × N (bulk buys)
  correctedPrice: number;   // trend × condition% (vendor can override)
  cashBid: number;          // correctedPrice × cashPercentage / 100, per stuk
  tradeBid: number;         // correctedPrice × tradePercentage / 100, per stuk
  addedAt: number;          // Date.now()
};

export type InventoryItem = {
  id: string;
  cardId: string;           // "" for manually added cards without API id
  cardName: string;
  cardSet: string;
  cardImageUrl: string;
  condition: Condition;
  quantity: number;
  purchasePrice: number;    // per stuk, what the vendor paid
  marketPriceAtPurchase: number; // trend at time of purchase (0 if unknown)
  purchasedAt: number;      // Date.now()
  notes: string;
};

export type TransactionRecord = {
  id: string;
  type: "buy" | "sell" | "trade";
  cardId: string;
  cardName: string;
  cardSet: string;
  condition: Condition;
  quantity: number;
  marketPriceAtTime: number;
  purchasePrice: number;    // what vendor paid (buy/trade-in)
  sellPrice: number;        // what vendor received (sell/trade-out)
  paymentMethod: PaymentMethod;
  eventTag: string;         // e.g. "Beurs Utrecht juli"
  createdAt: number;
  notes: string;
};

export type ConditionMultipliers = {
  MT: number;
  NM: number;
  EX: number;
  GD: number;
  LP: number;
  PL: number;
  PO: number;
};

/** Above `from` euro these percentages replace the base percentages. */
export type BidTier = {
  from: number;
  cashPct: number;
  tradePct: number;
};

export type VendorSettings = {
  cashPercentage: number;       // default 60
  tradePercentage: number;      // default 75
  conditionMultipliers: ConditionMultipliers;
  eventTag?: string;            // current beurs, stamped on transactions
  language?: Lang;              // UI language, default "nl"
  rounding?: number;            // round bids to 0 (off) / 0.5 / 1 euro
  bidTiers?: BidTier[];         // price-range percentage overrides
};

export type CachedPrice = {
  cardId: string;
  cardName: string;
  cardSet: string;
  trendPrice: number;
  averageSellPrice: number;
  avg1: number;
  avg7: number;
  avg30: number;
  lowPrice: number;
  fetchedAt: number;   // Date.now() — used for TTL check in priceService
};

// ─── Schema ───────────────────────────────────────────────────────────────────

interface CardPitDB extends DBSchema {
  cart: {
    key: string;           // CartItem.id
    value: CartItem;
    indexes: { "by-type": string };
  };
  settings: {
    key: "vendorSettings";
    value: VendorSettings;
  };
  priceCache: {
    key: string;           // CachedPrice.cardId
    value: CachedPrice;
  };
  inventory: {
    key: string;           // InventoryItem.id
    value: InventoryItem;
    indexes: { "by-card": string };
  };
  transactions: {
    key: string;           // TransactionRecord.id
    value: TransactionRecord;
    indexes: { "by-date": number };
  };
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase<CardPitDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<CardPitDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CardPitDB>("cardpit", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const cartStore = db.createObjectStore("cart", { keyPath: "id" });
          cartStore.createIndex("by-type", "type");
          db.createObjectStore("settings");
          db.createObjectStore("priceCache", { keyPath: "cardId" });
        }
        if (oldVersion < 2) {
          const inv = db.createObjectStore("inventory", { keyPath: "id" });
          inv.createIndex("by-card", "cardId");
          const tx = db.createObjectStore("transactions", { keyPath: "id" });
          tx.createIndex("by-date", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

// ─── Cart helpers ─────────────────────────────────────────────────────────────

export async function getCartItems(): Promise<CartItem[]> {
  const items = await (await getDB()).getAll("cart");
  // Rows written before quantity existed default to 1
  return items.map((i) => ({ ...i, quantity: i.quantity ?? 1 }));
}

export async function addCartItem(item: CartItem): Promise<void> {
  await (await getDB()).put("cart", item);
}

export async function removeCartItem(id: string): Promise<void> {
  await (await getDB()).delete("cart", id);
}

export async function clearCart(): Promise<void> {
  await (await getDB()).clear("cart");
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: VendorSettings = {
  cashPercentage: 60,
  tradePercentage: 75,
  conditionMultipliers: {
    MT: 100,
    NM: 100,
    EX: 80,
    GD: 65,
    LP: 50,
    PL: 35,
    PO: 20,
  },
  eventTag: "",
  language: "nl",
  rounding: 0,
  bidTiers: [],
};

export async function getSettings(): Promise<VendorSettings> {
  const db = await getDB();
  const stored = await db.get("settings", "vendorSettings");
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: VendorSettings): Promise<void> {
  await (await getDB()).put("settings", settings, "vendorSettings");
}

// ─── Price cache helpers ──────────────────────────────────────────────────────

export async function getCachedPrice(
  cardId: string
): Promise<CachedPrice | undefined> {
  return (await getDB()).get("priceCache", cardId);
}

export async function setCachedPrice(price: CachedPrice): Promise<void> {
  await (await getDB()).put("priceCache", price);
}

/**
 * Cached price plus its age in ms. Age is computed here so components can
 * stay pure (no Date.now() during render).
 */
export async function getCachedPriceWithAge(
  cardId: string
): Promise<{ price: CachedPrice; ageMs: number } | undefined> {
  const price = await getCachedPrice(cardId);
  if (!price) return undefined;
  return { price, ageMs: Date.now() - price.fetchedAt };
}

// ─── Inventory helpers ────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
  const items = await (await getDB()).getAll("inventory");
  return items.sort((a, b) => b.purchasedAt - a.purchasedAt);
}

export async function putInventoryItem(item: InventoryItem): Promise<void> {
  await (await getDB()).put("inventory", item);
}

export async function removeInventoryItem(id: string): Promise<void> {
  await (await getDB()).delete("inventory", id);
}

/**
 * Add a card to inventory. If the same card (id + condition + price) already
 * exists, bump its quantity instead of creating a duplicate row.
 */
export async function addToInventory(
  item: Omit<InventoryItem, "id">
): Promise<void> {
  const db = await getDB();
  if (item.cardId) {
    const existing = await db.getAllFromIndex("inventory", "by-card", item.cardId);
    const match = existing.find(
      (e) =>
        e.condition === item.condition &&
        Math.abs(e.purchasePrice - item.purchasePrice) < 0.005
    );
    if (match) {
      match.quantity += item.quantity;
      await db.put("inventory", match);
      return;
    }
  }
  await db.put("inventory", { ...item, id: crypto.randomUUID() });
}

/** Decrement quantity (used on sell / trade-out). Removes the row at 0. */
export async function decrementInventory(
  id: string,
  by: number = 1
): Promise<void> {
  const db = await getDB();
  const item = await db.get("inventory", id);
  if (!item) return;
  item.quantity -= by;
  if (item.quantity <= 0) {
    await db.delete("inventory", id);
  } else {
    await db.put("inventory", item);
  }
}

// ─── Transaction helpers ──────────────────────────────────────────────────────

export async function getTransactions(): Promise<TransactionRecord[]> {
  const txs = await (await getDB()).getAll("transactions");
  return txs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addTransaction(
  tx: Omit<TransactionRecord, "id">
): Promise<void> {
  await (await getDB()).put("transactions", {
    ...tx,
    id: crypto.randomUUID(),
  });
}

export async function removeTransaction(id: string): Promise<void> {
  await (await getDB()).delete("transactions", id);
}

/** Total spent on buys today — the vendor's running "float" counter. */
export async function getTodaySpend(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const txs = await getTransactions();
  return txs
    .filter((t) => t.type === "buy" && t.createdAt >= start.getTime())
    .reduce((s, t) => s + t.purchasePrice * t.quantity, 0);
}

import { getDB, type PriceLookup } from "./db";
import { getSupabase } from "./supabase";

/**
 * Own EU price history, built from every price lookup the app does.
 *
 * - Logging is ALWAYS on (not behind the chart feature flag): each lookup
 *   writes one row per card per day to the local `priceLookups` store,
 *   with a best-effort mirror to the Supabase `price_lookups` table when
 *   cloud sync is configured. Logging never blocks or fails the flow.
 * - Reading is local-only (offline-first): the chart shows whatever this
 *   device has collected. Components go through this service exclusively —
 *   they never touch IndexedDB or Supabase for history themselves.
 */

export type PricePoint = { day: string; price: number };

/** Record today's observed price for a card (or slab/sealed key). */
export async function logPriceLookup(
  cardId: string,
  price: number,
  source: "cardmarket" | "ebay"
): Promise<void> {
  if (!cardId || !(price > 0)) return;
  const day = new Date().toISOString().slice(0, 10);
  const entry: PriceLookup = {
    id: `${cardId}|${day}`,
    cardId,
    price,
    source,
    day,
    createdAt: Date.now(),
  };
  try {
    await (await getDB()).put("priceLookups", entry);
  } catch {
    // storage unavailable — history is a bonus, never an error
  }
  try {
    const supabase = getSupabase();
    if (supabase) {
      void supabase
        .from("price_lookups")
        .upsert({ id: entry.id, card_id: cardId, price, source, day })
        .then(
          () => {},
          () => {} // table missing / offline — silently skip
        );
    }
  } catch {
    // never let cloud sync break the vendor flow
  }
}

/** Local price history for a card, oldest first. */
export async function getPriceHistory(cardId: string): Promise<PricePoint[]> {
  if (!cardId) return [];
  const rows = await (await getDB()).getAllFromIndex(
    "priceLookups",
    "by-card",
    cardId
  );
  return rows
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({ day: r.day, price: r.price }));
}

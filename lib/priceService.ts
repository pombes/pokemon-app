/**
 * priceService.ts
 * ═══════════════════════════════════════════════════════════════════════
 * THE ONLY FILE THAT CALLS THE CARD SEARCH / CARDMARKET PRICE API.
 * Components must never import the API key or call this API directly.
 *
 * Provider: TCGGO (cardmarket-api-tcg.p.rapidapi.com) — one key powers
 * card search, Cardmarket EUR prices, AND the eBay sold-slab data used in
 * app/api/ebay/route.ts. Real Cardmarket prices for singles come straight
 * from prices.cardmarket on each card (7d/30d averages, lowest near-mint).
 *
 * Architecture:
 *   Client component → /api/search route → this file → TCGGO
 *   Client component → /api/price  route → this file → TCGGO
 *   Offline fallback: getCachedPrice() in lib/db.ts (IndexedDB)
 * ═══════════════════════════════════════════════════════════════════════
 */

import "server-only";

// ─── Provider config ──────────────────────────────────────────────────────────

const TCGGO_HOST = "cardmarket-api-tcg.p.rapidapi.com";
const TCGGO_BASE = `https://${TCGGO_HOST}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardSearchResult = {
  id: string;
  name: string;
  set: string;
  number: string;
  imageUrl: string;
};

export type CardPriceData = {
  cardId: string;
  cardName: string;
  cardSet: string;
  trendPrice: number;
  averageSellPrice: number;
  avg1: number;
  avg7: number;
  avg30: number;
  lowPrice: number;
  fetchedAt: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The single API key; null when unconfigured (callers fall back to demo). */
export function getTcggoKey(): string | null {
  const key = process.env.TCGGO_RAPIDAPI_KEY;
  if (!key || key === "your_tcggo_rapidapi_key_here") return null;
  return key;
}

function headers(key: string): HeadersInit {
  return { "x-rapidapi-host": TCGGO_HOST, "x-rapidapi-key": key };
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// The upstream TCGGO API is slow (~2–8s per search). At a fair, vendors look
// up the same popular cards over and over, so caching identical queries for a
// while makes repeats instant and also spares the daily request quota. Lives
// for the life of the server process (per instance).

const SEARCH_TTL = 10 * 60 * 1000; // 10 min
const searchCache = new Map<string, { data: CardSearchResult[]; at: number }>();

function cacheGet<T>(
  cache: Map<string, { data: T; at: number }>,
  key: string,
  ttl: number
): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  if (hit) cache.delete(key);
  return null;
}

/** Human-facing card number: "57/191" when we know the set size, else "57". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cardNumber(card: any): string {
  const num = card?.card_number;
  const printed = card?.episode?.cards_printed_total;
  if (num != null && /^\d+$/.test(String(num)) && printed) {
    return `${num}/${printed}`;
  }
  return num != null ? String(num) : "";
}

/** Map one TCGGO card's Cardmarket block to our price shape (or null). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPriceData(card: any): CardPriceData | null {
  const cm = card?.prices?.cardmarket;
  if (!cm) return null;
  const avg7 = Number(cm["7d_average"]) || 0;
  const avg30 = Number(cm["30d_average"]) || 0;
  const low = Number(cm.lowest_near_mint) || 0;
  // Best "current market" proxy Cardmarket exposes here is the 7-day average;
  // fall back to 30-day, then the lowest near-mint listing.
  const trend = avg7 || avg30 || low;
  if (trend <= 0) return null;
  return {
    cardId: String(card.id),
    cardName: String(card.name ?? ""),
    cardSet: String(card?.episode?.name ?? ""),
    trendPrice: trend,
    averageSellPrice: avg7 || trend,
    avg1: avg7 || trend, // no 1-day field; 7-day is the closest signal
    avg7: avg7 || trend,
    avg30: avg30 || trend,
    lowPrice: low,
    fetchedAt: Date.now(),
  };
}

// ─── Search cards by name ─────────────────────────────────────────────────────
// Returns up to 20 singles, most valuable (7-day average) first.
// Called by: /api/search?q=<query>

export async function searchCards(query: string): Promise<CardSearchResult[]> {
  const key = getTcggoKey();
  if (!key) throw new Error("TCGGO_RAPIDAPI_KEY is not configured.");

  const cacheKey = query.trim().toLowerCase();
  const cached = cacheGet(searchCache, cacheKey, SEARCH_TTL);
  if (cached) return cached;

  const url = `${TCGGO_BASE}/pokemon/cards?search=${encodeURIComponent(query)}&per_page=20`;
  const res = await fetch(url, { headers: headers(key), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Zoekfout: ${res.status} ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await res.json()) as { data: any[] };
  const results = (body.data ?? [])
    .filter((c) => String(c?.type ?? "singles") === "singles")
    .map((card) => ({
      card,
      value: Number(card?.prices?.cardmarket?.["7d_average"]) || 0,
    }))
    .sort((a, b) => b.value - a.value)
    .map(({ card }) => ({
      id: String(card.id),
      name: String(card.name ?? ""),
      set: String(card?.episode?.name ?? ""),
      number: cardNumber(card),
      imageUrl: String(card.image ?? ""),
    }));

  searchCache.set(cacheKey, { data: results, at: Date.now() });
  return results;
}

// ─── Fetch Cardmarket price for one card ─────────────────────────────────────
// Called by: /api/price?cardId=<TCGGO id>&cardName=<name>&cardSet=<set>
// Cache check happens in the calling route: IndexedDB first, only call this
// on a cache miss or stale entry.

export async function fetchCardPrice(
  cardId: string,
  cardName: string,
  cardSet: string = ""
): Promise<CardPriceData | null> {
  const key = getTcggoKey();
  if (!key) throw new Error("TCGGO_RAPIDAPI_KEY is not configured.");

  const res = await fetch(
    `${TCGGO_BASE}/pokemon/cards/${encodeURIComponent(cardId)}`,
    { headers: headers(key), cache: "no-store" }
  );
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await res.json()) as { data: any };
  const price = toPriceData(body?.data);
  if (!price) return null;

  // Preserve the names the client already has if the API omits them.
  return {
    ...price,
    cardName: price.cardName || cardName,
    cardSet: price.cardSet || cardSet,
  };
}

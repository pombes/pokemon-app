/**
 * priceService.ts
 * ═══════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY FILE THAT CALLS THE RAPIDAPI PRICE ENDPOINT.
 * Components must never import the API key or call this API directly.
 * If the provider changes, only this file needs updating.
 *
 * Architecture:
 *   Client component → /api/price route → this file → RapidAPI
 *   Client component → /api/search route → this file → RapidAPI
 *   Offline fallback: getCachedPrice() in lib/db.ts (IndexedDB)
 * ═══════════════════════════════════════════════════════════════════════
 */

import "server-only";

// ─── Provider config ──────────────────────────────────────────────────────────
// Provider: "Pokemon TCG API" by tcggopro on RapidAPI
// Subscribe at: https://rapidapi.com/search/pokemon-tcg
// Free Basic tier: 100 req/day
// Docs: the API mirrors pokemontcg.io — card IDs and response shape are identical

const RAPIDAPI_HOST = "pokemon-tcg-api.p.rapidapi.com";
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;

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

function getApiKey(): string {
  const key = process.env.RAPIDAPI_KEY;
  if (!key || key === "your_rapidapi_key_here") {
    throw new Error(
      "RAPIDAPI_KEY is not configured. Set it in .env.local first."
    );
  }
  return key;
}

function apiHeaders(key: string): HeadersInit {
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": RAPIDAPI_HOST,
    Accept: "application/json",
  };
}

// ─── Search cards by name ─────────────────────────────────────────────────────
// Returns the top 20 results sorted by Cardmarket trend price descending.
// Called by: /api/search?q=<query>

export async function searchCards(query: string): Promise<CardSearchResult[]> {
  const key = getApiKey();

  const url = new URL(`${RAPIDAPI_BASE}/cards`);
  url.searchParams.set("q", `name:${query}*`);
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "-cardmarket.prices.trendPrice");

  const res = await fetch(url.toString(), {
    headers: apiHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Zoekfout: ${res.status} ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await res.json() as { data: any[] };

  return (body.data ?? []).map((card) => ({
    id: card.id as string,
    name: card.name as string,
    set: (card.set?.name ?? "") as string,
    number: (card.number ?? "") as string,
    imageUrl: (card.images?.small ?? "") as string,
  }));
}

// ─── Fetch Cardmarket price for one card ─────────────────────────────────────
// Called by: /api/price?cardId=<id>&cardName=<name>&cardSet=<set>
// Cache check happens in the calling route: check IndexedDB first,
// only call this function on a cache miss or stale entry (>4h old).

export async function fetchCardPrice(
  cardId: string,
  cardName: string,
  cardSet: string = ""
): Promise<CardPriceData | null> {
  const key = getApiKey();

  const url = `${RAPIDAPI_BASE}/cards/${encodeURIComponent(cardId)}`;

  const res = await fetch(url, {
    headers: apiHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await res.json() as { data: any };
  const prices = body?.data?.cardmarket?.prices as Record<string, number> | undefined;

  if (!prices) {
    return null;
  }

  return {
    cardId,
    cardName,
    cardSet,
    trendPrice:        prices.trendPrice        ?? 0,
    averageSellPrice:  prices.averageSellPrice   ?? 0,
    avg1:              prices.avg1               ?? 0,
    avg7:              prices.avg7               ?? 0,
    avg30:             prices.avg30              ?? 0,
    lowPrice:          prices.lowPrice           ?? 0,
    fetchedAt:         Date.now(),
  };
}

import { NextRequest, NextResponse } from "next/server";

/**
 * eBay prices for graded slabs. Three-tier fallback, each optional:
 *
 *   1. TCGGO_RAPIDAPI_KEY  → real sold eBay listings for the exact card +
 *      grade (cardmarket-api-tcg.p.rapidapi.com). Preferred: gives actual
 *      listings with photos/links, filtered to the scanned grade.
 *   2. EBAY_CLIENT_ID/SECRET → eBay Browse API (live fixed-price listings,
 *      not grade-filtered — kept as a secondary option).
 *   3. Neither configured → deterministic demo listings, so the flow is
 *      fully testable offline.
 *
 * Response shape:
 *   { items: EbayItem[], stats: { low, median, avg, count }, searchUrl, demo }
 */

type EbayItem = {
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  url: string;
  condition: string;
};

const MARKETPLACE = process.env.EBAY_MARKETPLACE ?? "EBAY-NL";
const EBAY_DOMAIN = MARKETPLACE === "EBAY-NL" ? "www.ebay.nl" : "www.ebay.com";

// ─── Stats ────────────────────────────────────────────────────────────────────

function computeStats(prices: number[]) {
  if (prices.length === 0) return { low: 0, median: 0, avg: 0, count: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const avg = sorted.reduce((s, p) => s + p, 0) / sorted.length;
  return {
    low: sorted[0],
    median: Math.round(median * 100) / 100,
    avg: Math.round(avg * 100) / 100,
    count: sorted.length,
  };
}

// ─── Tier 1: TCGGO (cardmarket-api-tcg.p.rapidapi.com) ───────────────────────
// Provides real sold eBay listings per card, keyed by the card's catalog id
// (not the pokemontcg.io id we use elsewhere). We resolve that id ourselves
// via a name+set search, then fetch sold offers and filter to the exact
// grading company + grade the vendor scanned.

const TCGGO_HOST = "cardmarket-api-tcg.p.rapidapi.com";
const TCGGO_BASE = `https://${TCGGO_HOST}`;

// Static, approximate FX rates — good enough for an indicative price the
// vendor can (and does, via the editable price field) always override. Not
// a live-rate lookup, to avoid a third external dependency for this.
const FX_TO_EUR: Record<string, number> = { EUR: 1, GBP: 1.17, USD: 0.92 };

function toEur(price: number, currency: string): number {
  const rate = FX_TO_EUR[currency.toUpperCase()] ?? 1;
  return Math.round(price * rate * 100) / 100;
}

function getTcggoKey(): string | null {
  const key = process.env.TCGGO_RAPIDAPI_KEY;
  if (!key || key === "your_tcggo_rapidapi_key_here") return null;
  return key;
}

function tcggoHeaders(key: string): HeadersInit {
  return { "x-rapidapi-host": TCGGO_HOST, "x-rapidapi-key": key };
}

/** Leading digits of a card number: "223/197" → "223", "OBF 223" → "223". */
function normNumber(raw: string): string {
  const m = String(raw).match(/\d+/);
  return m ? m[0] : "";
}

/**
 * Find the exact catalog card — deliberately strict, because this catalog's
 * relevance search can rank an unrelated card first (a modern "Mega
 * Charizard Y ex" ahead of the "Charizard" scanned), and within one set
 * there are often several cards sharing a name (Obsidian Flames alone has
 * Charizard ex #125, #215, #223, #228 at wildly different prices). The card
 * NUMBER is the reliable disambiguator, so we match on it first; set is the
 * tiebreaker. No confident match → null, and the caller falls back rather
 * than show an unverified price as fact.
 */
async function findTcggoCard(
  name: string,
  set: string,
  number: string,
  key: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const url = `${TCGGO_BASE}/pokemon/cards?search=${encodeURIComponent(name)}&per_page=50`;
  const res = await fetch(url, { headers: tcggoHeaders(key), cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (body?.data ?? []) as any[];
  if (results.length === 0) return null;

  const nameLower = name.toLowerCase();
  let pool = results.filter(
    (c) => String(c?.name ?? "").toLowerCase() === nameLower
  );
  if (pool.length === 0) return null;

  // Primary key: exact card number. This is what makes the match trustworthy.
  const num = normNumber(number);
  if (num) {
    const byNumber = pool.filter((c) => normNumber(String(c?.card_number ?? "")) === num);
    if (byNumber.length === 0) return null; // number given but no match → don't guess
    pool = byNumber;
  }

  if (pool.length === 1) return pool[0];

  // Tiebreaker: exact set.
  if (set) {
    const setLower = set.toLowerCase();
    const bySet = pool.find(
      (c) => String(c?.episode?.name ?? "").toLowerCase() === setLower
    );
    if (bySet) return bySet;
  }

  // Still ambiguous and no number to lock it in → refuse rather than guess.
  return num ? pool[0] : null;
}

/** Median from the card's embedded eBay sold data for one company + grade. */
function embeddedMedian(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  card: any,
  company: string,
  grade: string
): { eur: number; sample: number } | null {
  const ebay = card?.prices?.ebay;
  if (!ebay?.graded) return null;
  const byCompany = ebay.graded[company.toLowerCase()];
  const entry = byCompany?.[String(grade)];
  if (!entry || !(entry.median_price > 0)) return null;
  return {
    eur: toEur(Number(entry.median_price), String(ebay.currency ?? "USD")),
    sample: Number(entry.sample_size) || 0,
  };
}

/** Sold eBay listings for a TCGGO card id, newest first per the API. */
async function fetchTcggoSoldOffers(
  id: number,
  key: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const url = `${TCGGO_BASE}/pokemon/ebay-sold-offers?id=${id}&per_page=50&page=1`;
  const res = await fetch(url, { headers: tcggoHeaders(key), cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json();
  return body?.data ?? [];
}

async function fetchViaTcggo(
  name: string,
  set: string,
  number: string,
  company: string,
  grade: string
): Promise<{
  items: EbayItem[];
  stats: ReturnType<typeof computeStats>;
} | null> {
  const key = getTcggoKey();
  if (!key || !name) return null;

  try {
    const card = await findTcggoCard(name, set, number, key);
    if (!card) return null;

    // Individual sold listings for this exact card + grade (clickable).
    const raw = await fetchTcggoSoldOffers(card.id as number, key);
    const listings: EbayItem[] = raw
      .filter(
        (o) =>
          String(o?.company ?? "").toLowerCase() === company.toLowerCase() &&
          String(o?.grade ?? "") === String(grade)
      )
      .map((o) => ({
        title: String(o?.title ?? ""),
        price: toEur(Number(o?.price) || 0, String(o?.currency ?? "USD")),
        currency: "EUR",
        imageUrl: String(o?.image_url ?? ""),
        url: String(o?.url ?? ""),
        condition: `${o?.company ?? ""} ${o?.grade ?? ""}`.trim() || "Graded",
      }))
      .filter((it) => it.price > 0)
      .sort((a, b) => a.price - b.price);

    // Enough real individual sales → they are the most granular truth.
    if (listings.length >= 3) {
      return {
        items: listings.slice(0, 15),
        stats: computeStats(listings.map((i) => i.price)),
      };
    }

    // Otherwise fall back to the card's aggregated median for this grade.
    const median = embeddedMedian(card, company, grade);
    if (median) {
      return {
        items: listings, // may be a handful; UI still shows "view all on eBay"
        stats: {
          low: median.eur,
          median: median.eur,
          avg: median.eur,
          count: median.sample,
        },
      };
    }

    // We found the card but have no eBay data for this grade → let the
    // caller fall back rather than invent a number.
    return null;
  } catch {
    return null; // network hiccup — caller falls back to the next tier
  }
}

// ─── Tier 2: eBay Browse API (OAuth) ──────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) throw new Error("eBay auth failed");
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return cachedToken.token;
}

// ─── Tier 3: demo listings — deterministic per query ──────────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function demoListings(q: string, searchUrl: string): EbayItem[] {
  const h = hashCode(q.toLowerCase());
  const base = 60 + (h % 340); // €60–€400 base price per query
  const spread = [0.78, 0.88, 0.95, 1.0, 1.08, 1.22];
  const sellers = ["cardvault_nl", "gradedgems", "pokeslabs_eu", "tcg-deals", "slabcity", "mintcondition"];
  return spread.map((m, i) => ({
    title: `${q} — ${sellers[i]}`,
    price: Math.round(base * m * ((h >> (i + 2)) % 7 === 0 ? 1.05 : 1) * 100) / 100,
    currency: "EUR",
    imageUrl: "",
    url: searchUrl,
    condition: "Graded",
  }));
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "q vereist" }, { status: 400 });
  }
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const set = req.nextUrl.searchParams.get("set") ?? "";
  const number = req.nextUrl.searchParams.get("number") ?? "";
  const company = req.nextUrl.searchParams.get("company") ?? "";
  const grade = req.nextUrl.searchParams.get("grade") ?? "";

  const searchUrl = `https://${EBAY_DOMAIN}/sch/i.html?_nkw=${encodeURIComponent(q)}`;

  // Tier 1: real eBay sold data for this exact card (matched by number) + grade
  const tcggo = await fetchViaTcggo(name, set, number, company, grade);
  if (tcggo) {
    return NextResponse.json({ ...tcggo, searchUrl, demo: false });
  }

  // Tier 2: eBay Browse API (live listings, not grade-filtered)
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const hasEbayKeys =
    clientId &&
    clientSecret &&
    clientId !== "your_ebay_client_id" &&
    clientSecret !== "your_ebay_client_secret";

  if (hasEbayKeys) {
    try {
      const token = await getToken(clientId, clientSecret);
      const res = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=20&filter=buyingOptions:%7BFIXED_PRICE%7D`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
          },
          next: { revalidate: 300 },
        }
      );
      if (!res.ok) throw new Error(`eBay search failed (${res.status})`);
      const data = await res.json();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: EbayItem[] = ((data.itemSummaries ?? []) as any[])
        .filter((it) => it?.price?.value)
        .map((it) => ({
          title: String(it.title ?? ""),
          price: Number(it.price.value),
          currency: String(it.price.currency ?? "EUR"),
          imageUrl: String(it.thumbnailImages?.[0]?.imageUrl ?? it.image?.imageUrl ?? ""),
          url: String(it.itemWebUrl ?? searchUrl),
          condition: String(it.condition ?? ""),
        }))
        .sort((a, b) => a.price - b.price);

      return NextResponse.json({
        items: items.slice(0, 10),
        stats: computeStats(items.map((i) => i.price)),
        searchUrl,
        demo: false,
      });
    } catch {
      // fall through to demo rather than error out — the scanner is a bonus
    }
  }

  // Tier 3: demo data
  const items = demoListings(q, searchUrl).sort((a, b) => a.price - b.price);
  return NextResponse.json({
    items,
    stats: computeStats(items.map((i) => i.price)),
    searchUrl,
    demo: true,
  });
}

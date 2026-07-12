import { NextRequest, NextResponse } from "next/server";

/**
 * eBay prices for graded slabs. Uses the eBay Browse API when
 * EBAY_CLIENT_ID + EBAY_CLIENT_SECRET are set; otherwise serves
 * deterministic demo listings so the flow is fully testable offline.
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

// ─── OAuth token cache (client-credentials flow) ─────────────────────────────

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

// ─── Demo listings — deterministic per query so results feel stable ──────────

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

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "q vereist" }, { status: 400 });
  }

  const searchUrl = `https://${EBAY_DOMAIN}/sch/i.html?_nkw=${encodeURIComponent(q)}`;

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const isDemo =
    !clientId ||
    !clientSecret ||
    clientId === "your_ebay_client_id" ||
    clientSecret === "your_ebay_client_secret";

  if (isDemo) {
    const items = demoListings(q, searchUrl).sort((a, b) => a.price - b.price);
    return NextResponse.json({
      items,
      stats: computeStats(items.map((i) => i.price)),
      searchUrl,
      demo: true,
    });
  }

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
    return NextResponse.json(
      { error: "eBay prijzen ophalen mislukt", searchUrl },
      { status: 502 }
    );
  }
}

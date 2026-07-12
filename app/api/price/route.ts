import { NextRequest, NextResponse } from "next/server";
import { fetchCardPrice } from "@/lib/priceService";

const MOCK_PRICES: Record<string, object> = {
  "sv3-223": {
    cardId: "sv3-223",
    cardName: "Charizard ex",
    trendPrice: 84.5,
    averageSellPrice: 81.2,
    avg1: 86.0,
    avg7: 79.4,
    avg30: 78.4,
    lowPrice: 62.0,
    fetchedAt: Date.now(),
  },
  "sv3-6": {
    cardId: "sv3-6",
    cardName: "Charizard ex",
    trendPrice: 12.0,
    averageSellPrice: 11.5,
    avg1: 12.5,
    avg7: 11.8,
    avg30: 11.2,
    lowPrice: 9.0,
    fetchedAt: Date.now(),
  },
  "swsh45-79": {
    cardId: "swsh45-79",
    cardName: "Charizard V",
    trendPrice: 28.0,
    averageSellPrice: 27.0,
    avg1: 29.5,
    avg7: 27.2,
    avg30: 26.8,
    lowPrice: 22.0,
    fetchedAt: Date.now(),
  },
  "base1-4": {
    cardId: "base1-4",
    cardName: "Charizard",
    trendPrice: 320.0,
    averageSellPrice: 310.0,
    avg1: 330.0,
    avg7: 315.0,
    avg30: 305.0,
    lowPrice: 280.0,
    fetchedAt: Date.now(),
  },
  "swsh9-50": {
    cardId: "swsh9-50",
    cardName: "Pikachu V",
    trendPrice: 18.5,
    averageSellPrice: 17.8,
    avg1: 19.0,
    avg7: 18.1,
    avg30: 17.5,
    lowPrice: 14.0,
    fetchedAt: Date.now(),
  },
  "sv2-185": {
    cardId: "sv2-185",
    cardName: "Iono",
    trendPrice: 62.0,
    averageSellPrice: 60.5,
    avg1: 64.0,
    avg7: 61.5,
    avg30: 59.0,
    lowPrice: 52.0,
    fetchedAt: Date.now(),
  },
};

const MOCK_DEFAULT = {
  trendPrice: 25.0,
  averageSellPrice: 24.0,
  avg1: 26.0,
  avg7: 24.5,
  avg30: 23.8,
  lowPrice: 19.0,
  fetchedAt: Date.now(),
};

const isDemoMode = !process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY === "your_rapidapi_key_here";

export async function GET(req: NextRequest) {
  const cardId = req.nextUrl.searchParams.get("cardId") ?? "";
  const cardName = req.nextUrl.searchParams.get("cardName") ?? "";

  if (!cardId) {
    return NextResponse.json({ error: "cardId vereist" }, { status: 400 });
  }

  if (isDemoMode) {
    const mock = MOCK_PRICES[cardId] ?? { ...MOCK_DEFAULT, cardId, cardName, fetchedAt: Date.now() };
    return NextResponse.json({ price: mock });
  }

  try {
    const cardSet = req.nextUrl.searchParams.get("cardSet") ?? "";
    const price = await fetchCardPrice(cardId, cardName, cardSet);
    if (!price) {
      return NextResponse.json(
        { error: "Geen Cardmarket prijs gevonden voor dit kaart" },
        { status: 404 }
      );
    }
    return NextResponse.json({ price });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prijs ophalen mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

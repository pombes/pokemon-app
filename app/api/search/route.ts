import { NextRequest, NextResponse } from "next/server";
import { searchCards } from "@/lib/priceService";

const MOCK_RESULTS = [
  {
    id: "sv3-223",
    name: "Charizard ex",
    set: "Obsidian Flames",
    number: "223/197",
    imageUrl: "https://images.pokemontcg.io/sv3/223.png",
  },
  {
    id: "sv3-6",
    name: "Charizard ex",
    set: "Obsidian Flames",
    number: "6/197",
    imageUrl: "https://images.pokemontcg.io/sv3/6.png",
  },
  {
    id: "swsh45-79",
    name: "Charizard V",
    set: "Shining Fates",
    number: "79/72",
    imageUrl: "https://images.pokemontcg.io/swsh45/79.png",
  },
  {
    id: "base1-4",
    name: "Charizard",
    set: "Base Set",
    number: "4/102",
    imageUrl: "https://images.pokemontcg.io/base1/4.png",
  },
  {
    id: "swsh9-50",
    name: "Pikachu V",
    set: "Brilliant Stars",
    number: "50/172",
    imageUrl: "https://images.pokemontcg.io/swsh9/50.png",
  },
  {
    id: "sv2-185",
    name: "Iono",
    set: "Paldea Evolved",
    number: "185/193",
    imageUrl: "https://images.pokemontcg.io/sv2/185.png",
  },
];

const isDemoMode = !process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY === "your_rapidapi_key_here";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  if (isDemoMode) {
    const filtered = MOCK_RESULTS.filter((c) =>
      c.name.toLowerCase().includes(q.toLowerCase())
    );
    return NextResponse.json({ results: filtered });
  }

  try {
    const results = await searchCards(q.trim());
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Zoeken mislukt";
    return NextResponse.json({ results: [], error: message }, { status: 500 });
  }
}

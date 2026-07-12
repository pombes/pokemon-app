import { NextRequest, NextResponse } from "next/server";

/**
 * Card scan via Ximilar — identification ONLY (which card is this),
 * never grading/centering. Result auto-fills the search field; manual
 * search is always the fallback. The scanner is a bonus, not a dependency.
 *
 * When the photo shows a graded slab (PSA/BGS/CGC case) the response
 * includes `slab: { company, grade }` — the client then switches to the
 * eBay pricing flow instead of Cardmarket.
 */

const XIMILAR_URL = "https://api.ximilar.com/collectibles/v2/tcg_id";

export async function POST(req: NextRequest) {
  const key = process.env.XIMILAR_KEY;

  let image: string;
  try {
    const body = await req.json();
    image = body.image;
    if (!image) throw new Error("no image");
  } catch {
    return NextResponse.json({ error: "Geen afbeelding ontvangen" }, { status: 400 });
  }

  if (!key || key === "your_ximilar_key_here") {
    // Demo mode — pretend we recognized a graded slab so the eBay flow
    // is fully demonstrable without a Ximilar key.
    return NextResponse.json({
      name: "Charizard",
      set: "Base Set",
      slab: { company: "PSA", grade: "9" },
      demo: true,
    });
  }

  try {
    const res = await fetch(XIMILAR_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: [{ _base64: image }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Scanner tijdelijk niet beschikbaar" },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Walk the response defensively — Ximilar nests matches per detected object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = (data.records ?? [])[0] as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const objects = (record?._objects ?? []) as any[];
    const best =
      objects
        .map((o) => o["_identification"]?.["best_match"])
        .find((m) => m?.name) ?? null;

    if (!best) {
      return NextResponse.json(
        { error: "Kaart niet herkend — zoek handmatig" },
        { status: 404 }
      );
    }

    // Slab detection: Ximilar marks graded cards either via the detected
    // object label ("Slab") or via grade fields on the match. Check both.
    const slabObject = objects.some((o) =>
      String(o?.name ?? o?.category ?? "").toLowerCase().includes("slab")
    );
    const grade = best.grade ?? best.grade_value ?? record?.grade ?? null;
    const company =
      best.grade_company ?? best.company ?? record?.grade_company ?? null;
    const slab =
      slabObject || grade
        ? {
            company: String(company ?? "PSA"),
            grade: grade != null ? String(grade) : "",
          }
        : null;

    return NextResponse.json({
      name: best.name as string,
      set: (best.set ?? "") as string,
      ...(slab ? { slab } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: "Scannen mislukt — zoek handmatig" },
      { status: 502 }
    );
  }
}

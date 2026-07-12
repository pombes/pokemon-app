"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useT } from "@/context/SettingsContext";
import { fmt } from "@/lib/format";

export default function KlantPage() {
  const { items, loading } = useCart();
  const { tr } = useT();

  const inkoop = items.filter((i) => i.type === "inkoop");
  const inruil = items.filter((i) => i.type === "inruil");

  const totalCash = inkoop.reduce((s, i) => s + i.cashBid, 0);
  const totalTrade = inruil.reduce((s, i) => s + i.tradeBid, 0);

  if (loading) {
    return (
      <div className="min-h-dvh bg-base flex items-center justify-center">
        <span className="ms text-3xl text-gold animate-spin-slow">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-base flex flex-col w-full max-w-[480px] mx-auto">
      {/* Status bar spacer */}
      <div className="h-8" />

      {/* Header with logo + back */}
      <div className="flex items-center justify-between px-6 py-4 animate-fade">
        <Link
          href="/cart"
          className="press w-11 h-11 rounded-xl ticket border border-edge flex items-center justify-center"
        >
          <span className="ms text-[22px] text-content-dim">arrow_back</span>
        </Link>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-gold to-gold-deep flex items-center justify-center">
            <div className="w-2.5 h-2.5 bg-base rotate-45 rounded-[2px]" />
          </div>
          <span className="font-black text-[17px] tracking-tight text-content">
            Card<span className="text-gold">Pit</span>
          </span>
        </div>

        {/* Spacer to balance the back button */}
        <div className="w-11" />
      </div>

      {/* Subtitle */}
      <div className="px-6 pb-5 animate-rise">
        <h1 className="text-[28px] font-black tracking-tight text-content">
          {tr("your_offer")}
        </h1>
        <p className="text-[14px] text-content-dim mt-0.5">
          {tr("your_offer_sub")}
        </p>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <span className="ms text-5xl text-content-faint">shopping_basket</span>
          <p className="text-[15px] text-content-dim max-w-[200px]">
            {tr("no_cards_in_deal")}
          </p>
        </div>
      )}

      {/* Card lists */}
      <div className="flex-1 flex flex-col gap-5 px-5 stagger">
        {/* Inkoop section */}
        {inkoop.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 px-1">
              <span className="ms ms-fill text-[16px] text-gold">payments</span>
              <span className="text-[11px] font-bold text-gold uppercase tracking-[0.08em]">
                {tr("cash_bid")}
              </span>
            </div>

            <div className="ticket border border-edge rounded-[20px] overflow-hidden">
              {inkoop.map((item, i) => (
                <KlantRow key={item.id} item={item} amount={item.cashBid} tone="gold" divider={i > 0} />
              ))}
            </div>

            {/* Inkoop total */}
            <div className="relative overflow-hidden rounded-[20px] border border-gold/35 bg-gradient-to-b from-gold/14 to-gold/5 px-5 py-4 flex items-center justify-between">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gold/12 blur-3xl" />
              <span className="text-[15px] font-bold text-content">{tr("total_cash")}</span>
              <span className="font-mono font-bold text-[26px] text-gold-bright tabular-nums">
                {fmt(totalCash)}
              </span>
            </div>
          </section>
        )}

        {/* Inruil section */}
        {inruil.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 px-1">
              <span className="ms ms-fill text-[16px] text-trade">swap_horiz</span>
              <span className="text-[11px] font-bold text-trade uppercase tracking-[0.08em]">
                {tr("trade_bid")}
              </span>
            </div>

            <div className="ticket border border-edge rounded-[20px] overflow-hidden">
              {inruil.map((item, i) => (
                <KlantRow key={item.id} item={item} amount={item.tradeBid} tone="trade" divider={i > 0} />
              ))}
            </div>

            {/* Inruil total */}
            <div className="relative overflow-hidden rounded-[20px] border border-trade/35 bg-gradient-to-b from-trade/14 to-trade/5 px-5 py-4 flex items-center justify-between">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-trade/12 blur-3xl" />
              <span className="text-[15px] font-bold text-content">{tr("total_trade")}</span>
              <span className="font-mono font-bold text-[26px] text-trade tabular-nums">
                {fmt(totalTrade)}
              </span>
            </div>
          </section>
        )}
      </div>

      {/* Big terug button for the vendor */}
      <div className="px-5 pt-6 pb-8">
        <Link
          href="/cart"
          className="press flex items-center justify-center gap-2 h-14 rounded-2xl border border-edge-bright ticket text-content font-bold text-[15px]"
        >
          <span className="ms text-[20px]">arrow_back</span>
          {tr("back")}
        </Link>
      </div>
    </div>
  );
}

function KlantRow({
  item,
  amount,
  tone,
  divider,
}: {
  item: { cardImageUrl: string; cardName: string; condition: string };
  amount: number;
  tone: "gold" | "trade";
  divider: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${divider ? "border-t border-edge" : ""}`}>
      <div className="w-10 h-14 flex-none rounded-lg border border-edge bg-surface-card overflow-hidden flex items-center justify-center">
        {item.cardImageUrl ? (
          <Image
            src={item.cardImageUrl}
            alt={item.cardName}
            width={40}
            height={56}
            className="object-contain w-full h-full"
          />
        ) : (
          <span className="ms text-[14px] text-content-ghost">style</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-bold text-[16px] text-content truncate">
          {item.cardName}
        </div>
        <span className="font-mono text-[11px] font-bold text-content-dim bg-surface-card border border-edge rounded-md px-1.5 py-0.5 inline-block mt-1">
          {item.condition}
        </span>
      </div>

      {/* Price only — never margins or percentages */}
      <span
        className={`font-mono font-bold text-[19px] flex-none tabular-nums ${
          tone === "gold" ? "text-gold-bright" : "text-trade"
        }`}
      >
        {fmt(amount)}
      </span>
    </div>
  );
}

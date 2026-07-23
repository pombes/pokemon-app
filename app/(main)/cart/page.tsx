"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { useSettings, useT } from "@/hooks/useSettings";
import Sheet from "@/components/Sheet";
import {
  addToInventory,
  addTransaction,
  getInventory,
  decrementInventory,
  type CartItem,
  type PaymentMethod,
} from "@/lib/db";
import { fmt, fmtTime } from "@/lib/format";
import type { TKey } from "@/lib/i18n";

const PAYMENT_OPTIONS: { value: PaymentMethod; labelKey: TKey; icon: string }[] = [
  { value: "cash", labelKey: "pay_cash", icon: "payments" },
  { value: "tikkie", labelKey: "pay_tikkie", icon: "smartphone" },
  { value: "pin", labelKey: "pay_pin", icon: "credit_card" },
  { value: "trade", labelKey: "pay_trade", icon: "swap_horiz" },
  { value: "other", labelKey: "pay_other", icon: "more_horiz" },
];

export default function WinkelwagenPage() {
  const {
    items,
    remove,
    updateQty,
    undo,
    canUndo,
    clear,
    loading,
    parked,
    park,
    resume,
    discardParked,
  } = useCart();
  const { settings } = useSettings();
  const { tr } = useT();
  const router = useRouter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [closing, setClosing] = useState(false);
  const [dealDone, setDealDone] = useState(false);
  const [toast, setToast] = useState<{ text: string; undoable: boolean } | null>(null);

  function showToast(text: string, undoable = false) {
    setToast({ text, undoable });
    setTimeout(() => setToast(null), undoable ? 4200 : 2500);
  }

  const inkoop = items.filter((i) => i.type === "inkoop");
  const inruil = items.filter((i) => i.type === "inruil");

  const totalCards = items.reduce((s, i) => s + i.quantity, 0);
  const totalCash = inkoop.reduce((s, i) => s + i.cashBid * i.quantity, 0);
  const totalTrade = inruil.reduce((s, i) => s + i.tradeBid * i.quantity, 0);
  const hasItems = items.length > 0;

  // Effective purchase price per inkoop item depends on how the deal is paid
  const isTradeDeal = payment === "trade" || inruil.length > 0;

  function priceForInkoop(item: CartItem): number {
    return isTradeDeal ? item.tradeBid : item.cashBid;
  }

  const totalInkoop = inkoop.reduce((s, i) => s + priceForInkoop(i) * i.quantity, 0);
  const saldo = totalInkoop - totalTrade; // >0: vendor pays out, <0: customer pays

  async function handleRemove(id: string) {
    const item = items.find((i) => i.id === id);
    await remove(id);
    showToast(tr("removed_from_deal", { name: item?.cardName ?? "" }), true);
  }

  async function undoLast() {
    await undo();
    showToast(tr("undone"));
  }

  async function handlePark() {
    await park();
    showToast(tr("deal_parked"));
  }

  async function handleResume(id: string) {
    await resume(id);
    showToast(tr("deal_resumed"));
  }

  async function confirmDeal() {
    if (closing) return;
    setClosing(true);
    const eventTag = settings.eventTag ?? "";
    const now = Date.now();

    try {
      // 1. Inkoop → inventory + buy transaction
      for (const item of inkoop) {
        const paid = priceForInkoop(item);
        await addToInventory({
          cardId: item.cardId,
          cardName: item.cardName,
          cardSet: item.cardSet,
          cardImageUrl: item.cardImageUrl,
          condition: item.condition,
          quantity: item.quantity,
          purchasePrice: paid,
          marketPriceAtPurchase: item.correctedPrice,
          purchasedAt: now,
          notes: "",
        });
        await addTransaction({
          type: "buy",
          cardId: item.cardId,
          cardName: item.cardName,
          cardSet: item.cardSet,
          condition: item.condition,
          quantity: item.quantity,
          marketPriceAtTime: item.correctedPrice,
          purchasePrice: paid,
          sellPrice: 0,
          paymentMethod: isTradeDeal ? "trade" : payment,
          eventTag,
          createdAt: now,
          notes: "",
        });
      }

      // 2. Inruil (cards leaving) → trade transaction + decrement inventory
      const inventory = inruil.length > 0 ? await getInventory() : [];
      for (const item of inruil) {
        const match = inventory.find(
          (inv) =>
            inv.cardId === item.cardId &&
            inv.condition === item.condition &&
            inv.quantity > 0
        );
        await addTransaction({
          type: "trade",
          cardId: item.cardId,
          cardName: item.cardName,
          cardSet: item.cardSet,
          condition: item.condition,
          quantity: item.quantity,
          marketPriceAtTime: item.correctedPrice,
          purchasePrice: match?.purchasePrice ?? 0,
          sellPrice: item.tradeBid,
          paymentMethod: "trade",
          eventTag,
          createdAt: now,
          notes: "",
        });
        if (match) {
          await decrementInventory(match.id, item.quantity);
          match.quantity -= item.quantity;
        }
      }

      setSheetOpen(false);
      setDealDone(true);
      await clear();
      setTimeout(() => router.push("/zoeken"), 1600);
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="ms text-3xl text-gold animate-spin-slow">
          progress_activity
        </span>
      </div>
    );
  }

  // Full-screen success moment
  if (dealDone) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-140px)] gap-5 animate-pop">
        <div className="w-24 h-24 rounded-full bg-trade/12 border border-trade/40 flex items-center justify-center shadow-[0_0_60px_rgba(58,223,165,0.25)]">
          <span className="ms ms-fill text-[52px] text-trade">handshake</span>
        </div>
        <div className="text-center">
          <h1 className="text-[28px] font-black tracking-tight text-content">
            {tr("deal_closed")}
          </h1>
          <p className="text-[14px] text-content-dim mt-1">
            {tr("deal_closed_sub")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100dvh-76px)]">
      <div className="flex-1 px-5 pt-5 pb-4 flex flex-col gap-5 stagger">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[24px] font-black tracking-tight text-content">
            {tr("deal")}
          </h1>
          {hasItems && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-content-dim bg-surface-raised border border-edge rounded-full px-3 py-1">
                {totalCards === 1
                  ? tr("card_count_one")
                  : tr("cards_count", { n: totalCards })}
              </span>
              {/* Park: customer walks off to think, next customer steps up */}
              <button
                onClick={handlePark}
                className="press flex items-center gap-1.5 h-9 px-3.5 rounded-xl ticket border border-edge-bright text-content font-bold text-[13px]"
              >
                <span className="ms text-[17px] text-gold">pause</span>
                {tr("park_deal")}
              </button>
            </div>
          )}
        </div>

        {/* Parked deals — one tap to bring a waiting customer back */}
        {parked.length > 0 && (
          <section className="flex flex-col gap-2 animate-rise">
            <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em] px-1">
              {tr("parked_deals")}
            </h2>
            <div className="ticket border border-edge rounded-2xl overflow-hidden">
              {parked.map((deal, i) => {
                const n = deal.items.reduce((s, it) => s + it.quantity, 0);
                const value = deal.items.reduce(
                  (s, it) =>
                    s +
                    (it.type === "inkoop" ? it.cashBid : it.tradeBid) * it.quantity,
                  0
                );
                return (
                  <div
                    key={deal.id}
                    className={`flex items-center gap-3 px-3.5 py-3 ${
                      i > 0 ? "border-t border-edge" : ""
                    }`}
                  >
                    <div className="w-9 h-9 flex-none rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center">
                      <span className="ms text-[18px] text-gold">pause</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13px] text-content truncate">
                        {deal.items[0]?.cardName}
                        {deal.items.length > 1 ? ` +${deal.items.length - 1}` : ""}
                      </div>
                      <div className="text-[11px] text-content-dim mt-0.5">
                        {tr("parked_meta", { time: fmtTime(deal.createdAt), n })} ·{" "}
                        <span className="font-mono tabular-nums">{fmt(value)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResume(deal.id)}
                      className="press flex-none flex items-center gap-1 h-9 px-3 rounded-xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[12px]"
                    >
                      <span className="ms text-[16px]">play_arrow</span>
                      {tr("resume_deal")}
                    </button>
                    <button
                      onClick={() => discardParked(deal.id)}
                      className="press w-9 h-9 flex-none rounded-xl flex items-center justify-center text-content-ghost active:text-danger"
                    >
                      <span className="ms text-[18px]">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!hasItems && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20 animate-rise-lg">
            <div className="relative">
              <div className="w-20 h-28 rounded-xl border-2 border-dashed border-edge-bright rotate-[-8deg]" />
              <div className="absolute top-0 left-3 w-20 h-28 rounded-xl border-2 border-edge bg-surface-raised rotate-[6deg] flex items-center justify-center">
                <span className="ms text-3xl text-content-faint">
                  shopping_basket
                </span>
              </div>
            </div>
            <p className="text-[15px] text-content-dim text-center max-w-[200px]">
              {tr("cart_empty")}
            </p>
            <Link
              href="/zoeken"
              className="press mt-2 px-6 h-12 flex items-center justify-center rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[15px] shadow-[0_0_18px_rgba(240,180,64,0.3)]"
            >
              {tr("find_card")}
            </Link>
          </div>
        )}

        {/* Klant geeft — inkoop */}
        {inkoop.length > 0 && (
          <CartSection
            title={tr("customer_gives")}
            icon="payments"
            tone="gold"
            items={inkoop}
            amount={(i) => i.cashBid}
            onRemove={handleRemove}
            onQty={updateQty}
            totalLabel={tr("total_cash")}
            total={totalCash}
            showTotal={inruil.length > 0}
          />
        )}

        {/* Klant krijgt — inruil */}
        {inruil.length > 0 && (
          <CartSection
            title={tr("customer_gets")}
            icon="swap_horiz"
            tone="trade"
            items={inruil}
            amount={(i) => i.tradeBid}
            onRemove={handleRemove}
            onQty={updateQty}
            totalLabel={tr("total_trade")}
            total={totalTrade}
            showTotal={inkoop.length > 0}
            hint={tr("trade_credit_hint")}
          />
        )}
      </div>

      {/* Sticky bottom action area */}
      {hasItems && (
        <div className="px-5 pb-5 pt-3 flex flex-col gap-3 border-t border-edge bg-surface/90 backdrop-blur-xl">
          {/* Saldo */}
          <div className="ticket border border-edge rounded-2xl p-4 flex flex-col gap-2">
            {inkoop.length > 0 && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-content-dim font-medium">{tr("total_buy")}</span>
                <span className="font-mono font-bold text-gold-bright tabular-nums">
                  {fmt(totalInkoop)}
                </span>
              </div>
            )}
            {inruil.length > 0 && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-content-dim font-medium">{tr("customer_gets_in_cards")}</span>
                <span className="font-mono font-bold text-trade tabular-nums">
                  {fmt(totalTrade)}
                </span>
              </div>
            )}
            {inruil.length > 0 && inkoop.length > 0 && (
              <div className="flex items-center justify-between text-[15px] border-t border-edge pt-2 mt-1">
                <span className="font-bold text-content">
                  {saldo >= 0 ? tr("you_pay_extra") : tr("customer_pays_extra")}
                </span>
                <span className={`font-mono font-bold tabular-nums ${saldo >= 0 ? "text-gold-bright" : "text-trade"}`}>
                  {fmt(Math.abs(saldo))}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Link
              href="/klant"
              className="press flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl border border-edge-bright ticket text-content font-bold text-[15px]"
            >
              <span className="ms text-[20px] text-gold">visibility</span>
              {tr("show_customer")}
            </Link>

            <button
              onClick={() => {
                setPayment(inruil.length > 0 && inkoop.length === 0 ? "trade" : "cash");
                setSheetOpen(true);
              }}
              className="press flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[15px] shadow-[0_0_20px_rgba(240,180,64,0.3)]"
            >
              <span className="ms text-[20px]">handshake</span>
              {tr("close_deal")}
            </button>
          </div>
        </div>
      )}

      {/* Deal close sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={tr("close_deal")}>
        <div className="flex flex-col gap-5">
          <div>
            <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
              {tr("payment_method")}
            </span>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {PAYMENT_OPTIONS.map((opt) => {
                const active = payment === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setPayment(opt.value)}
                    className={`press flex flex-col items-center justify-center gap-1.5 h-[70px] rounded-2xl border transition-colors ${
                      active
                        ? "bg-gold/12 border-gold/60 text-gold-bright"
                        : "bg-surface-card border-edge text-content-dim"
                    }`}
                  >
                    <span className={`ms text-[22px] ${active ? "ms-fill" : ""}`}>{opt.icon}</span>
                    <span className="text-[12px] font-bold">{tr(opt.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-surface-card border border-edge rounded-2xl p-4 flex flex-col gap-1.5 text-[14px]">
            {inkoop.length > 0 && (
              <div className="flex justify-between">
                <span className="text-content-dim">
                  {tr("n_buy_to_stock", {
                    n: inkoop.reduce((s, i) => s + i.quantity, 0),
                  })}
                </span>
                <span className="font-mono font-bold text-gold-bright tabular-nums">
                  {fmt(totalInkoop)}
                </span>
              </div>
            )}
            {inruil.length > 0 && (
              <div className="flex justify-between">
                <span className="text-content-dim">
                  {tr("n_trade_to_customer", {
                    n: inruil.reduce((s, i) => s + i.quantity, 0),
                  })}
                </span>
                <span className="font-mono font-bold text-trade tabular-nums">
                  {fmt(totalTrade)}
                </span>
              </div>
            )}
            {settings.eventTag ? (
              <div className="flex justify-between border-t border-edge pt-1.5 mt-1">
                <span className="text-content-dim">{tr("fair")}</span>
                <span className="font-semibold text-content">{settings.eventTag}</span>
              </div>
            ) : null}
          </div>

          <button
            onClick={confirmDeal}
            disabled={closing}
            className="press flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_20px_rgba(240,180,64,0.3)] disabled:opacity-50"
          >
            <span className={`ms text-[21px] ${closing ? "animate-spin-slow" : ""}`}>
              {closing ? "progress_activity" : "check_circle"}
            </span>
            {closing ? tr("working") : tr("confirm")}
          </button>
        </div>
      </Sheet>

      {/* Toast — with inline undo after remove */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 flex items-center bg-surface-raised border border-edge-bright rounded-2xl pl-4 pr-3 py-3 text-[14px] font-semibold text-content shadow-[0_12px_32px_rgba(0,0,0,0.6)] z-50 whitespace-nowrap animate-toast max-w-[calc(100vw-40px)]">
          <span className="ms ms-fill text-[16px] text-trade mr-2 flex-none">check_circle</span>
          <span className="truncate">{toast.text}</span>
          {toast.undoable && canUndo && (
            <button
              onClick={undoLast}
              className="press ml-3 flex-none flex items-center gap-1 h-8 px-3 rounded-xl bg-gold/12 border border-gold/40 text-gold-bright text-[13px] font-bold"
            >
              <span className="ms text-[15px]">undo</span>
              {tr("undo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section of cart rows ─────────────────────────────────────────────────────

function CartSection({
  title,
  icon,
  tone,
  items,
  amount,
  onRemove,
  onQty,
  totalLabel,
  total,
  showTotal,
  hint,
}: {
  title: string;
  icon: string;
  tone: "gold" | "trade";
  items: CartItem[];
  amount: (item: CartItem) => number;
  onRemove: (id: string) => void;
  onQty: (id: string, delta: number) => void;
  totalLabel: string;
  total: number;
  // Section subtotal is only useful next to ANOTHER section; with a single
  // section it would duplicate the grand total right below it.
  showTotal: boolean;
  hint?: string;
}) {
  const toneText = tone === "gold" ? "text-gold" : "text-trade";
  const toneBright = tone === "gold" ? "text-gold-bright" : "text-trade";

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`ms ms-fill text-[17px] ${toneText}`}>{icon}</span>
        <h2 className={`text-[12px] font-bold uppercase tracking-[0.08em] ${toneText}`}>
          {title}
        </h2>
      </div>
      {hint && <p className="text-[12px] text-content-dim px-1 -mt-1">{hint}</p>}
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 ticket border border-edge rounded-2xl p-3 animate-rise"
          >
            <div className="w-10 h-14 flex-none rounded-lg border border-edge bg-surface-card overflow-hidden flex items-center justify-center relative">
              {item.cardImageUrl ? (
                <Image
                  src={item.cardImageUrl}
                  alt={item.cardName}
                  width={40}
                  height={56}
                  className="object-contain w-full h-full"
                />
              ) : (
                <span className="ms text-[16px] text-content-ghost">style</span>
              )}
              {item.quantity > 1 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold text-base text-[10px] font-extrabold flex items-center justify-center">
                  {item.quantity}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-bold text-[14px] text-content truncate">
                {item.cardName}
              </div>
              <div className="text-[12px] text-content-dim flex items-center gap-1.5 mt-0.5">
                <span className="font-mono bg-surface-card border border-edge rounded-md px-1.5 py-0.5 text-[11px] font-bold">
                  {item.condition}
                </span>
                <span className="truncate">{item.cardSet}</span>
              </div>
              {item.quantity > 1 && (
                <div className="text-[11px] text-content-faint font-mono mt-1 tabular-nums">
                  {item.quantity} × {fmt(amount(item))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-1.5 flex-none">
              <span className={`font-mono font-bold text-[16px] tabular-nums ${toneBright}`}>
                {fmt(amount(item) * item.quantity)}
              </span>
              <div className="flex items-center gap-2">
                {/* Joined stepper pill with the count visible in the middle */}
                <div className="flex items-center rounded-lg border border-edge bg-surface-card overflow-hidden">
                  <button
                    onClick={() => onQty(item.id, -1)}
                    className="press w-7 h-7 flex items-center justify-center text-content-dim"
                  >
                    <span className="ms text-[14px]">remove</span>
                  </button>
                  <span className="w-6 text-center font-mono font-bold text-[12px] text-content tabular-nums border-x border-edge leading-7">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => onQty(item.id, 1)}
                    className="press w-7 h-7 flex items-center justify-center text-content-dim"
                  >
                    <span className="ms text-[14px]">add</span>
                  </button>
                </div>
                <button
                  onClick={() => onRemove(item.id)}
                  className="press w-7 h-7 rounded-lg flex items-center justify-center text-content-ghost active:text-danger transition-colors"
                >
                  <span className="ms text-[17px]">delete</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showTotal && (
        <div className="flex items-center justify-between px-1 mt-0.5">
          <span className="text-[13px] text-content-dim font-medium">{totalLabel}</span>
          <span className={`font-mono font-bold text-[16px] tabular-nums ${toneBright}`}>
            {fmt(total)}
          </span>
        </div>
      )}
    </section>
  );
}

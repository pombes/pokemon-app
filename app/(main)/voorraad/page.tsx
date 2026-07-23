"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { useSettings, useT } from "@/hooks/useSettings";
import type { TKey } from "@/lib/i18n";
import Sheet from "@/components/Sheet";
import { CONDITIONS } from "@/components/ConditionButtons";
import {
  getInventory,
  getDB,
  addToInventory,
  removeInventoryItem,
  decrementInventory,
  addTransaction,
  getTransactions,
  type InventoryItem,
  type TransactionRecord,
  type Condition,
  type PaymentMethod,
  type CachedPrice,
} from "@/lib/db";
import { fmt, fmtSigned, fmtDay, fmtTime, parseDutch } from "@/lib/format";
import { transactionsCsv, downloadCsv } from "@/lib/export";
import { useCountUp } from "@/hooks/useCountUp";

const PAYMENT_OPTIONS: { value: PaymentMethod; labelKey: TKey }[] = [
  { value: "cash", labelKey: "pay_cash" },
  { value: "tikkie", labelKey: "pay_tikkie" },
  { value: "pin", labelKey: "pay_pin" },
  { value: "other", labelKey: "pay_other" },
];

type Perf = "gainers" | "losers" | "breakeven";

const PERF_LABEL: Record<Perf, TKey> = {
  gainers: "top_gainers",
  losers: "top_losers",
  breakeven: "near_breakeven",
};

const TX_META: Record<
  TransactionRecord["type"],
  { icon: string; labelKey: TKey; tone: string }
> = {
  buy: { icon: "add_shopping_cart", labelKey: "tx_buy", tone: "text-gold" },
  sell: { icon: "sell", labelKey: "tx_sell", tone: "text-trade" },
  trade: { icon: "swap_horiz", labelKey: "tx_trade", tone: "text-trade" },
};

/** Fetch everything the page needs from IndexedDB in one go. */
async function loadAll() {
  const [inv, txs, db] = await Promise.all([
    getInventory(),
    getTransactions(),
    getDB(),
  ]);
  const cached = await db.getAll("priceCache");
  return { inv, txs, cached };
}

export default function VoorraadPage() {
  const { settings } = useSettings();
  const { tr, lang } = useT();

  const [tab, setTab] = useState<"kaarten" | "historie" | "rapport">("kaarten");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [prices, setPrices] = useState<Map<string, CachedPrice>>(new Map());
  const [loading, setLoading] = useState(true);

  // Filters
  const [filter, setFilter] = useState("");
  const [condFilter, setCondFilter] = useState<Condition | null>(null);
  const [perfFilter, setPerfFilter] = useState<Perf | null>(null);

  // Sheets
  const [detail, setDetail] = useState<InventoryItem | null>(null);
  const [sellMode, setSellMode] = useState(false);
  const [sellPrice, setSellPrice] = useState("");
  const [sellPayment, setSellPayment] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState("");

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2500);
  }

  const apply = useCallback((data: Awaited<ReturnType<typeof loadAll>>) => {
    setInventory(data.inv);
    setTransactions(data.txs);
    setPrices(new Map(data.cached.map((p) => [p.cardId, p])));
    setLoading(false);
  }, []);

  const reload = useCallback(() => loadAll().then(apply), [apply]);

  useEffect(() => {
    loadAll().then(apply);
  }, [apply]);

  // ─── Derived stats ───
  const totalCards = inventory.reduce((s, i) => s + i.quantity, 0);
  const totalPurchase = inventory.reduce(
    (s, i) => s + i.purchasePrice * i.quantity,
    0
  );

  const trendFor = useCallback(
    (item: InventoryItem): number => {
      const cached = item.cardId ? prices.get(item.cardId) : undefined;
      const trend = cached?.trendPrice ?? item.marketPriceAtPurchase;
      const mult = (settings.conditionMultipliers[item.condition] ?? 100) / 100;
      return trend * mult;
    },
    [prices, settings]
  );

  const totalMarket = useMemo(
    () => inventory.reduce((s, i) => s + trendFor(i) * i.quantity, 0),
    [inventory, trendFor]
  );

  const unrealized = totalMarket - totalPurchase;
  const unrealizedPct = totalPurchase > 0 ? (unrealized / totalPurchase) * 100 : 0;
  const marketAnimated = useCountUp(totalMarket, 600);

  const realizedProfit = useMemo(
    () =>
      transactions
        .filter((t) => t.type !== "buy")
        .reduce((s, t) => s + (t.sellPrice - t.purchasePrice) * t.quantity, 0),
    [transactions]
  );

  // Performance per item: near break-even is within ±max(€0.50, 5% of purchase)
  const perfOf = useCallback(
    (item: InventoryItem): Perf => {
      const profit = trendFor(item) - item.purchasePrice;
      const band = Math.max(0.5, item.purchasePrice * 0.05);
      return profit > band ? "gainers" : profit < -band ? "losers" : "breakeven";
    },
    [trendFor]
  );

  const perfSummary = useMemo(() => {
    const sum: Record<Perf, { count: number; total: number }> = {
      gainers: { count: 0, total: 0 },
      losers: { count: 0, total: 0 },
      breakeven: { count: 0, total: 0 },
    };
    for (const item of inventory) {
      const p = perfOf(item);
      sum[p].count += item.quantity;
      sum[p].total += (trendFor(item) - item.purchasePrice) * item.quantity;
    }
    return sum;
  }, [inventory, perfOf, trendFor]);

  const filtered = useMemo(() => {
    const list = inventory.filter((i) => {
      if (perfFilter && perfOf(i) !== perfFilter) return false;
      if (condFilter && i.condition !== condFilter) return false;
      if (filter && !`${i.cardName} ${i.cardSet}`.toLowerCase().includes(filter.toLowerCase()))
        return false;
      return true;
    });
    // With a performance filter active, sort by relevance: biggest gain,
    // biggest loss, or closest to break-even first.
    if (perfFilter) {
      const gain = (i: InventoryItem) => trendFor(i) - i.purchasePrice;
      list.sort((a, b) =>
        perfFilter === "gainers"
          ? gain(b) - gain(a)
          : perfFilter === "losers"
          ? gain(a) - gain(b)
          : Math.abs(gain(a)) - Math.abs(gain(b))
      );
    }
    return list;
  }, [inventory, perfFilter, perfOf, condFilter, filter, trendFor]);

  // Quarterly report for bookkeeping / margeregeling
  const quarters = useMemo(() => {
    const map = new Map<
      string,
      {
        year: number;
        q: number;
        buys: number;
        buyCards: number;
        sales: number;
        saleCards: number;
        margin: number;
        txs: TransactionRecord[];
      }
    >();
    for (const tx of transactions) {
      const d = new Date(tx.createdAt);
      const q = Math.floor(d.getMonth() / 3) + 1;
      const key = `${d.getFullYear()}-${q}`;
      const entry =
        map.get(key) ??
        {
          year: d.getFullYear(),
          q,
          buys: 0,
          buyCards: 0,
          sales: 0,
          saleCards: 0,
          margin: 0,
          txs: [],
        };
      if (tx.type === "buy") {
        entry.buys += tx.purchasePrice * tx.quantity;
        entry.buyCards += tx.quantity;
      } else {
        entry.sales += tx.sellPrice * tx.quantity;
        entry.saleCards += tx.quantity;
        entry.margin += (tx.sellPrice - tx.purchasePrice) * tx.quantity;
      }
      entry.txs.push(tx);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.year - a.year || b.q - a.q);
  }, [transactions]);

  // Transactions grouped per day
  const txByDay = useMemo(() => {
    const groups = new Map<string, TransactionRecord[]>();
    for (const tx of transactions) {
      const key = new Date(tx.createdAt).toDateString();
      const list = groups.get(key) ?? [];
      list.push(tx);
      groups.set(key, list);
    }
    return [...groups.values()];
  }, [transactions]);

  // ─── Actions ───

  function openDetail(item: InventoryItem) {
    setDetail(item);
    setSellMode(false);
    const suggested = trendFor(item);
    setSellPrice((suggested > 0 ? suggested : item.purchasePrice).toFixed(2).replace(".", ","));
    setSellPayment("cash");
  }

  async function confirmSell() {
    if (!detail || busy) return;
    const price = parseDutch(sellPrice);
    if (price <= 0) return;
    setBusy(true);
    try {
      await addTransaction({
        type: "sell",
        cardId: detail.cardId,
        cardName: detail.cardName,
        cardSet: detail.cardSet,
        condition: detail.condition,
        quantity: 1,
        marketPriceAtTime: trendFor(detail),
        purchasePrice: detail.purchasePrice,
        sellPrice: price,
        paymentMethod: sellPayment,
        eventTag: settings.eventTag ?? "",
        createdAt: Date.now(),
        notes: "",
      });
      await decrementInventory(detail.id, 1);
      setDetail(null);
      await reload();
      showToast(
        tr("sold_for", {
          price: fmt(price),
          profit: fmtSigned(price - detail.purchasePrice),
        })
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await removeInventoryItem(detail.id);
      setDetail(null);
      await reload();
      showToast(tr("removed_from_stock"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="ms text-3xl text-gold animate-spin-slow">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 pt-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade">
        <h1 className="text-[24px] font-black tracking-tight text-content">
          {tr("stock")}
        </h1>
        <button
          onClick={() => setAddOpen(true)}
          className="press flex items-center gap-1.5 h-10 px-4 rounded-xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[13px] shadow-[0_0_16px_rgba(240,180,64,0.3)]"
        >
          <span className="ms text-[18px]">add</span>
          {tr("add")}
        </button>
      </div>

      {/* Portfolio hero — one number that matters, the rest supports it */}
      <div className="relative overflow-hidden ticket border border-edge rounded-[20px] p-5 animate-rise">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gold/7 blur-3xl" />
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-bold text-content-dim uppercase tracking-[0.08em]">
            {tr("stat_market_value")}
          </span>
          <span className="text-[11px] font-semibold text-content-dim bg-surface-card border border-edge rounded-full px-2.5 py-1">
            {totalCards === 1
              ? tr("card_count_one")
              : tr("cards_count", { n: totalCards })}
          </span>
        </div>
        <div className="font-mono font-black text-[34px] text-content tracking-tight tabular-nums leading-tight mt-1">
          {fmt(marketAnimated)}
        </div>
        {inventory.length > 0 && (
          <div
            className={`flex items-center gap-1.5 mt-1 text-[13px] font-mono font-bold tabular-nums ${
              unrealized >= 0 ? "text-trade" : "text-danger"
            }`}
          >
            <span className="ms text-[16px]">
              {unrealized >= 0 ? "trending_up" : "trending_down"}
            </span>
            {fmtSigned(unrealized)} ({unrealized >= 0 ? "+" : "−"}
            {Math.abs(unrealizedPct).toFixed(1).replace(".", ",")}%)
            <span className="text-content-faint font-sans font-medium">
              · {tr("stat_unrealized").toLowerCase()}
            </span>
          </div>
        )}
        <div className="flex items-center gap-4 border-t border-edge mt-4 pt-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-content-faint">{tr("stat_total_cost")}</div>
            <div className="font-mono font-bold text-[14px] text-content tabular-nums truncate">
              {fmt(totalPurchase)}
            </div>
          </div>
          <div className="w-px h-8 bg-edge flex-none" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-content-faint">{tr("stat_realized")}</div>
            <div
              className={`font-mono font-bold text-[14px] tabular-nums truncate ${
                realizedProfit >= 0 ? "text-trade" : "text-danger"
              }`}
            >
              {fmtSigned(realizedProfit)}
            </div>
          </div>
        </div>
      </div>

      {/* Performance tiles — tap to filter the card list */}
      {inventory.length > 0 && (
        <div className="grid grid-cols-3 gap-2 animate-rise">
          <PerfTile
            icon="trending_up"
            label={tr("top_gainers")}
            count={perfSummary.gainers.count}
            total={perfSummary.gainers.total}
            tone="text-trade"
            active={perfFilter === "gainers"}
            onClick={() => {
              setPerfFilter(perfFilter === "gainers" ? null : "gainers");
              setTab("kaarten");
            }}
          />
          <PerfTile
            icon="trending_down"
            label={tr("top_losers")}
            count={perfSummary.losers.count}
            total={perfSummary.losers.total}
            tone="text-danger"
            active={perfFilter === "losers"}
            onClick={() => {
              setPerfFilter(perfFilter === "losers" ? null : "losers");
              setTab("kaarten");
            }}
          />
          <PerfTile
            icon="balance"
            label={tr("near_breakeven")}
            count={perfSummary.breakeven.count}
            total={perfSummary.breakeven.total}
            tone="text-content-dim"
            active={perfFilter === "breakeven"}
            onClick={() => {
              setPerfFilter(perfFilter === "breakeven" ? null : "breakeven");
              setTab("kaarten");
            }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-surface-raised border border-edge rounded-2xl p-1 animate-rise">
        {(["kaarten", "historie", "rapport"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-10 rounded-xl text-[14px] font-bold transition-all duration-200 ${
              tab === t
                ? "bg-surface-card text-gold-bright border border-edge-bright shadow-sm"
                : "text-content-dim"
            }`}
          >
            {t === "kaarten"
              ? tr("tab_cards")
              : t === "historie"
              ? tr("tab_history")
              : tr("tab_report")}
          </button>
        ))}
      </div>

      {/* ═══ KAARTEN TAB ═══ */}
      {tab === "kaarten" && (
        <>
          {/* Active performance filter */}
          {perfFilter && (
            <div className="flex items-center justify-between bg-gold/8 border border-gold/40 rounded-xl px-3.5 py-2.5 animate-rise">
              <span className="text-[13px] font-bold text-gold-bright">
                {tr("showing_filter", { label: tr(PERF_LABEL[perfFilter]) })} ·{" "}
                {filtered.length}
              </span>
              <button
                onClick={() => setPerfFilter(null)}
                className="press flex items-center gap-1 text-[12px] font-bold text-content-dim"
              >
                <span className="ms text-[16px]">close</span>
                {tr("clear_filter")}
              </button>
            </div>
          )}

          {/* Filter row */}
          {inventory.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 ticket border border-edge rounded-2xl px-4 h-12">
                <span className="ms text-[19px] text-content-dim">filter_list</span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={tr("filter_placeholder")}
                  className="flex-1 bg-transparent border-none outline-none text-content text-[15px] font-medium placeholder:text-content-faint min-w-0"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {CONDITIONS.map((c) => {
                  const active = condFilter === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setCondFilter(active ? null : c)}
                      className={`press h-9 px-3.5 flex-none rounded-full font-mono text-[13px] font-semibold border transition-colors ${
                        active
                          ? "bg-gold text-base border-gold-bright"
                          : "bg-surface-raised border-edge text-content-dim"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {inventory.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center animate-rise-lg">
              <div className="w-16 h-16 rounded-2xl bg-surface-raised border border-edge flex items-center justify-center">
                <span className="ms text-3xl text-content-faint">inventory_2</span>
              </div>
              <p className="text-[15px] text-content-dim max-w-[240px] leading-relaxed">
                {tr("stock_empty")}
              </p>
            </div>
          )}

          {/* Inventory rows */}
          <div className="flex flex-col gap-2">
            {filtered.map((item, idx) => {
              const trend = trendFor(item);
              const profit = trend - item.purchasePrice;
              return (
                <button
                  key={item.id}
                  onClick={() => openDetail(item)}
                  style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
                  className="press flex items-center gap-3 ticket border border-edge rounded-2xl p-3 text-left animate-rise"
                >
                  <div className="w-11 h-[60px] flex-none rounded-lg border border-edge bg-surface-card overflow-hidden flex items-center justify-center relative">
                    {item.cardImageUrl ? (
                      <Image
                        src={item.cardImageUrl}
                        alt={item.cardName}
                        width={44}
                        height={60}
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
                      <span className="truncate">{item.cardSet || "—"}</span>
                    </div>
                    <div className="text-[11px] text-content-faint mt-1">
                      {tr("bought_for")}{" "}
                      <span className="font-mono text-content-dim">{fmt(item.purchasePrice)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-0.5 flex-none">
                    <span className="font-mono font-bold text-[15px] text-content tabular-nums">
                      {fmt(trend)}
                    </span>
                    <span
                      className={`font-mono text-[12px] font-semibold tabular-nums ${
                        profit >= 0 ? "text-trade" : "text-danger"
                      }`}
                    >
                      {fmtSigned(profit)}
                    </span>
                  </div>
                </button>
              );
            })}
            {inventory.length > 0 && filtered.length === 0 && (
              <p className="text-center text-[14px] text-content-dim py-8">
                {tr("no_filter_results")}
              </p>
            )}
          </div>
        </>
      )}

      {/* ═══ HISTORIE TAB ═══ */}
      {tab === "historie" && (
        <>
          {transactions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center animate-rise-lg">
              <div className="w-16 h-16 rounded-2xl bg-surface-raised border border-edge flex items-center justify-center">
                <span className="ms text-3xl text-content-faint">receipt_long</span>
              </div>
              <p className="text-[15px] text-content-dim max-w-[240px] leading-relaxed">
                {tr("history_empty")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-5">
            {txByDay.map((dayTxs) => {
              const spent = dayTxs
                .filter((t) => t.type === "buy")
                .reduce((s, t) => s + t.purchasePrice * t.quantity, 0);
              const earned = dayTxs
                .filter((t) => t.type !== "buy")
                .reduce((s, t) => s + t.sellPrice * t.quantity, 0);
              const profit = dayTxs
                .filter((t) => t.type !== "buy")
                .reduce((s, t) => s + (t.sellPrice - t.purchasePrice) * t.quantity, 0);

              return (
                <section key={dayTxs[0].createdAt} className="flex flex-col gap-2 animate-rise">
                  {/* Day header + totals */}
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[13px] font-extrabold text-content uppercase tracking-[0.06em]">
                      {fmtDay(dayTxs[0].createdAt, lang)}
                    </h2>
                    <div className="flex items-center gap-2.5 text-[11px] font-mono font-semibold tabular-nums">
                      {spent > 0 && <span className="text-gold">−{fmt(spent).slice(2)}</span>}
                      {earned > 0 && <span className="text-trade">+{fmt(earned).slice(2)}</span>}
                      {profit !== 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md border ${
                            profit >= 0
                              ? "text-trade border-trade/40 bg-trade/8"
                              : "text-danger border-danger/40 bg-danger/8"
                          }`}
                        >
                          {tr("profit")} {fmtSigned(profit)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ticket border border-edge rounded-2xl overflow-hidden">
                    {dayTxs.map((tx, i) => {
                      const meta = TX_META[tx.type];
                      const amount = tx.type === "buy" ? -tx.purchasePrice : tx.sellPrice;
                      return (
                        <div
                          key={tx.id}
                          className={`flex items-center gap-3 px-3.5 py-3 ${
                            i > 0 ? "border-t border-edge" : ""
                          }`}
                        >
                          <div className="w-9 h-9 flex-none rounded-xl bg-surface-card border border-edge flex items-center justify-center">
                            <span className={`ms text-[18px] ${meta.tone}`}>{meta.icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-[13px] text-content truncate">
                              {tx.cardName}
                            </div>
                            <div className="text-[11px] text-content-dim mt-0.5">
                              {tr(meta.labelKey)} · {tx.condition} · {fmtTime(tx.createdAt)}
                              {tx.eventTag ? ` · ${tx.eventTag}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-col items-end flex-none">
                            <span
                              className={`font-mono font-bold text-[14px] tabular-nums ${
                                amount >= 0 ? "text-trade" : "text-gold"
                              }`}
                            >
                              {fmtSigned(amount)}
                            </span>
                            {tx.type !== "buy" && tx.purchasePrice > 0 && (
                              <span
                                className={`font-mono text-[10px] tabular-nums ${
                                  tx.sellPrice - tx.purchasePrice >= 0
                                    ? "text-trade/70"
                                    : "text-danger/70"
                                }`}
                              >
                                {tr("profit")} {fmtSigned(tx.sellPrice - tx.purchasePrice)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* ═══ RAPPORT TAB — kwartaaloverzicht voor de boekhouding ═══ */}
      {tab === "rapport" && (
        <>
          {quarters.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center animate-rise-lg">
              <div className="w-16 h-16 rounded-2xl bg-surface-raised border border-edge flex items-center justify-center">
                <span className="ms text-3xl text-content-faint">receipt_long</span>
              </div>
              <p className="text-[15px] text-content-dim max-w-[240px] leading-relaxed">
                {tr("history_empty")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {quarters.map((qt) => {
              const vat = qt.margin > 0 ? (qt.margin * 21) / 121 : 0;
              return (
                <section
                  key={`${qt.year}-${qt.q}`}
                  className="ticket border border-edge rounded-[20px] p-4 flex flex-col gap-3 animate-rise"
                >
                  {/* Quarter header */}
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-black tracking-tight text-content">
                      Q{qt.q}{" "}
                      <span className="text-content-dim font-bold">{qt.year}</span>
                    </h2>
                    <span className="text-[11px] font-semibold text-content-dim bg-surface-card border border-edge rounded-full px-2.5 py-1">
                      {tr("rep_tx", { n: qt.txs.length })}
                    </span>
                  </div>

                  {/* Totals */}
                  <div className="flex flex-col gap-1.5 text-[14px]">
                    <div className="flex items-center justify-between">
                      <span className="text-content-dim">
                        {tr("rep_buys")} · {qt.buyCards}×
                      </span>
                      <span className="font-mono font-bold text-gold-bright tabular-nums">
                        {fmt(qt.buys)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-content-dim">
                        {tr("rep_sales")} · {qt.saleCards}×
                      </span>
                      <span className="font-mono font-bold text-trade tabular-nums">
                        {fmt(qt.sales)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-edge pt-2 mt-0.5">
                      <span className="font-bold text-content">{tr("rep_margin")}</span>
                      <span
                        className={`font-mono font-bold text-[16px] tabular-nums ${
                          qt.margin >= 0 ? "text-trade" : "text-danger"
                        }`}
                      >
                        {fmtSigned(qt.margin)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-content-dim">{tr("rep_vat")}</span>
                      <span className="font-mono font-semibold text-[13px] text-content-dim tabular-nums">
                        {fmt(vat)}
                      </span>
                    </div>
                  </div>

                  {/* Export this quarter */}
                  <button
                    onClick={() => {
                      downloadCsv(
                        `cardpit-transacties-${qt.year}-Q${qt.q}.csv`,
                        transactionsCsv(qt.txs, lang)
                      );
                      showToast(tr("export_done"));
                    }}
                    className="press flex items-center justify-center gap-2 h-11 rounded-xl border border-edge-bright bg-surface-card text-content font-bold text-[13px]"
                  >
                    <span className="ms text-[17px] text-gold">download</span>
                    {tr("export_quarter")}
                  </button>
                </section>
              );
            })}
          </div>

          {quarters.length > 0 && (
            <p className="text-[12px] text-content-faint px-1 leading-relaxed">
              {tr("rep_note")}
            </p>
          )}
        </>
      )}

      {/* ═══ DETAIL / SELL SHEET ═══ */}
      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={sellMode ? tr("sell_action") : undefined}
      >
        {detail && !sellMode && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="w-[76px] h-[104px] flex-none rounded-xl border border-edge-bright bg-surface-card overflow-hidden flex items-center justify-center">
                {detail.cardImageUrl ? (
                  <Image
                    src={detail.cardImageUrl}
                    alt={detail.cardName}
                    width={76}
                    height={104}
                    className="object-contain w-full h-full"
                  />
                ) : (
                  <span className="ms text-[22px] text-content-ghost">style</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-extrabold text-[19px] text-content tracking-tight leading-tight">
                  {detail.cardName}
                </h2>
                <div className="text-[13px] text-content-dim mt-0.5">
                  {detail.cardSet || "—"}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono bg-surface-card border border-edge rounded-md px-2 py-1 text-[12px] font-bold">
                    {detail.condition}
                  </span>
                  <span className="text-[12px] text-content-dim">
                    {tr("in_stock", { n: detail.quantity })}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-surface-card border border-edge rounded-2xl p-4 grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <div className="text-content-dim">{tr("bought_for")}</div>
                <div className="font-mono font-bold text-[17px] text-content tabular-nums mt-0.5">
                  {fmt(detail.purchasePrice)}
                </div>
              </div>
              <div>
                <div className="text-content-dim">{tr("current_value")}</div>
                <div className="font-mono font-bold text-[17px] text-gold-bright tabular-nums mt-0.5">
                  {fmt(trendFor(detail))}
                </div>
              </div>
              <div className="col-span-2 border-t border-edge pt-2.5">
                <div className="text-content-dim">{tr("potential_profit")}</div>
                <div
                  className={`font-mono font-bold text-[17px] tabular-nums mt-0.5 ${
                    trendFor(detail) - detail.purchasePrice >= 0 ? "text-trade" : "text-danger"
                  }`}
                >
                  {fmtSigned(trendFor(detail) - detail.purchasePrice)}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="press w-14 h-14 flex-none rounded-2xl border border-danger/40 bg-danger/8 text-danger flex items-center justify-center"
              >
                <span className="ms text-[22px]">delete</span>
              </button>
              <button
                onClick={() => setSellMode(true)}
                className="press flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_20px_rgba(240,180,64,0.3)]"
              >
                <span className="ms text-[21px]">sell</span>
                {tr("sell_action")}
              </button>
            </div>
          </div>
        )}

        {detail && sellMode && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-14 flex-none rounded-lg border border-edge bg-surface-card overflow-hidden flex items-center justify-center">
                {detail.cardImageUrl ? (
                  <Image
                    src={detail.cardImageUrl}
                    alt={detail.cardName}
                    width={40}
                    height={56}
                    className="object-contain w-full h-full"
                  />
                ) : (
                  <span className="ms text-[15px] text-content-ghost">style</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-[15px] text-content truncate">
                  {detail.cardName}
                </div>
                <div className="text-[12px] text-content-dim">
                  {detail.condition} · {tr("bought_for").toLowerCase()}{" "}
                  {fmt(detail.purchasePrice)}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
                {tr("sell_price")}
              </span>
              <div className="flex items-center gap-2 bg-surface-card border border-edge rounded-2xl h-[58px] px-5 focus-within:border-gold/50 transition-colors">
                <span className="font-mono font-bold text-[22px] text-content-dim">€</span>
                <input
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-content font-mono font-bold text-[24px] tracking-tight min-w-0 tabular-nums"
                />
              </div>
              <div
                className={`text-[13px] font-mono font-semibold tabular-nums ${
                  parseDutch(sellPrice) - detail.purchasePrice >= 0 ? "text-trade" : "text-danger"
                }`}
              >
                {tr("profit_label")}: {fmtSigned(parseDutch(sellPrice) - detail.purchasePrice)}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
                {tr("payment_method")}
              </span>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_OPTIONS.map((opt) => {
                  const active = sellPayment === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSellPayment(opt.value)}
                      className={`press h-11 rounded-xl border text-[13px] font-bold transition-colors ${
                        active
                          ? "bg-gold/12 border-gold/60 text-gold-bright"
                          : "bg-surface-card border-edge text-content-dim"
                      }`}
                    >
                      {tr(opt.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSellMode(false)}
                className="press w-14 h-14 flex-none rounded-2xl border border-edge-bright bg-surface-card text-content-dim flex items-center justify-center"
              >
                <span className="ms text-[22px]">arrow_back</span>
              </button>
              <button
                onClick={confirmSell}
                disabled={busy || parseDutch(sellPrice) <= 0}
                className="press flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_20px_rgba(240,180,64,0.3)] disabled:opacity-50"
              >
                <span className={`ms text-[21px] ${busy ? "animate-spin-slow" : ""}`}>
                  {busy ? "progress_activity" : "check_circle"}
                </span>
                {tr("confirm_sale")}
              </button>
            </div>
          </div>
        )}
      </Sheet>

      {/* ═══ MANUAL ADD SHEET ═══ */}
      <AddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={async () => {
          setAddOpen(false);
          await reload();
          showToast(tr("added_to_stock"));
        }}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 bg-surface-raised border border-edge-bright rounded-2xl px-5 py-3 text-[14px] font-semibold text-content shadow-[0_12px_32px_rgba(0,0,0,0.6)] z-50 whitespace-nowrap animate-toast">
          <span className="ms ms-fill text-[16px] text-trade mr-2 align-[-2px]">check_circle</span>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Performance tile ─────────────────────────────────────────────────────────

function PerfTile({
  icon,
  label,
  count,
  total,
  tone,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  count: number;
  total: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  // Empty categories stay quiet: no colored €0,00 alarm, not clickable.
  const empty = count === 0;
  return (
    <button
      onClick={onClick}
      disabled={empty}
      className={`press rounded-2xl px-3 py-3 border flex flex-col gap-1 min-w-0 text-left transition-colors ${
        active
          ? "border-gold/60 bg-gold/10"
          : empty
          ? "ticket border-edge opacity-45"
          : "ticket border-edge"
      }`}
    >
      <span className={`ms text-[18px] ${empty ? "text-content-faint" : tone}`}>
        {icon}
      </span>
      <span className="text-[10px] font-bold text-content-dim uppercase tracking-[0.08em] truncate">
        {label}
      </span>
      <span className="font-mono font-bold text-[12px] tabular-nums truncate text-content">
        {empty ? (
          <span className="text-content-faint">—</span>
        ) : (
          <>
            {count}× <span className={tone}>{fmtSigned(total)}</span>
          </>
        )}
      </span>
    </button>
  );
}

// ─── Manual add sheet ─────────────────────────────────────────────────────────

function AddSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const { tr } = useT();
  const [name, setName] = useState("");
  const [set, setSet] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [qty, setQty] = useState(1);
  const [priceInput, setPriceInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const price = parseDutch(priceInput);
    if (!name.trim() || price < 0 || busy) return;
    setBusy(true);
    try {
      await addToInventory({
        cardId: "",
        cardName: name.trim(),
        cardSet: set.trim(),
        cardImageUrl: "",
        condition,
        quantity: qty,
        purchasePrice: price,
        marketPriceAtPurchase: 0,
        purchasedAt: Date.now(),
        notes: "",
      });
      setName("");
      setSet("");
      setCondition("NM");
      setQty(1);
      setPriceInput("");
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={tr("add_card")}>
      <div className="flex flex-col gap-3.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr("card_name_req")}
          className="h-13 bg-surface-card border border-edge rounded-2xl px-4 py-3.5 text-content text-[15px] font-medium placeholder:text-content-faint outline-none focus:border-gold/50 transition-colors"
        />
        <input
          value={set}
          onChange={(e) => setSet(e.target.value)}
          placeholder={tr("set_optional")}
          className="h-13 bg-surface-card border border-edge rounded-2xl px-4 py-3.5 text-content text-[15px] font-medium placeholder:text-content-faint outline-none focus:border-gold/50 transition-colors"
        />

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
            {tr("condition")}
          </span>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {CONDITIONS.map((c) => {
              const active = condition === c;
              return (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  className={`press min-w-[46px] h-10 flex-none rounded-xl font-mono text-[13px] font-semibold border transition-colors ${
                    active
                      ? "bg-gold text-base border-gold-bright"
                      : "bg-surface-card border-edge text-content-dim"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3">
          {/* Quantity stepper */}
          <div className="flex items-center gap-1 bg-surface-card border border-edge rounded-2xl px-2 h-[54px]">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="press w-9 h-9 rounded-xl bg-surface-raised border border-edge flex items-center justify-center text-content-dim"
            >
              <span className="ms text-[18px]">remove</span>
            </button>
            <span className="font-mono font-bold text-[17px] text-content w-8 text-center tabular-nums">
              {qty}
            </span>
            <button
              onClick={() => setQty((q) => q + 1)}
              className="press w-9 h-9 rounded-xl bg-surface-raised border border-edge flex items-center justify-center text-content-dim"
            >
              <span className="ms text-[18px]">add</span>
            </button>
          </div>
          {/* Price */}
          <div className="flex-1 flex items-center gap-2 bg-surface-card border border-edge rounded-2xl px-4 h-[54px] focus-within:border-gold/50 transition-colors">
            <span className="font-mono font-bold text-[18px] text-content-dim">€</span>
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              inputMode="decimal"
              placeholder={tr("purchase_price_each")}
              className="flex-1 bg-transparent border-none outline-none text-content font-mono font-bold text-[18px] placeholder:text-content-faint placeholder:font-sans placeholder:text-[14px] placeholder:font-medium min-w-0 tabular-nums"
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="press flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_20px_rgba(240,180,64,0.3)] disabled:opacity-40"
        >
          <span className={`ms text-[21px] ${busy ? "animate-spin-slow" : ""}`}>
            {busy ? "progress_activity" : "add_circle"}
          </span>
          {tr("add_to_stock")}
        </button>
      </div>
    </Sheet>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useSettings, useT } from "@/hooks/useSettings";
import { useCart } from "@/context/CartContext";
import ConditionButtons from "@/components/ConditionButtons";
import BidDisplay from "@/components/BidDisplay";
import {
  getCachedPriceWithAge,
  setCachedPrice,
  getTodaySpend,
  type CachedPrice,
  type Condition,
} from "@/lib/db";
import { bidPercentages, roundBid } from "@/lib/bids";
import { fmt, fmtAge, parseDutch } from "@/lib/format";

const RECENT_KEY = "cardpit_recent";
const RECENT_MAX = 8;

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

type SearchResult = {
  id: string;
  name: string;
  set: string;
  number: string;
  imageUrl: string;
};

type EbayItem = {
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  url: string;
  condition: string;
};

type EbayData = {
  items: EbayItem[];
  stats: { low: number; median: number; avg: number; count: number };
  searchUrl: string;
  demo?: boolean;
};

type SlabInfo = { name: string; set: string; company: string; grade: string };

function slabQuery(s: SlabInfo): string {
  return [s.name, s.set, `${s.company} ${s.grade}`.trim()]
    .filter(Boolean)
    .join(" ");
}

export default function ZoekenPage() {
  const { settings } = useSettings();
  const { tr, lang } = useT();
  const cart = useCart();

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [noResults, setNoResults] = useState(false);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Slab (graded card) mode — priced via eBay instead of Cardmarket
  const [slab, setSlab] = useState<SlabInfo | null>(null);
  const [ebay, setEbay] = useState<EbayData | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState("");

  // Selected card + price
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [price, setPrice] = useState<CachedPrice | null>(null);
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceFromCache, setPriceFromCache] = useState(false);
  const [cacheAgeMs, setCacheAgeMs] = useState(0);
  const [priceError, setPriceError] = useState("");

  // Calculation — only the vendor's manual override is state; the rest is
  // derived during render from price × condition × settings (incl. tiers
  // per price range and rounding to €0,50/€1).
  const [condition, setCondition] = useState<Condition>("NM");
  const [priceOverride, setPriceOverride] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  const mult = (settings.conditionMultipliers[condition] ?? 100) / 100;
  const baseCorrected = price ? price.trendPrice * mult : 0;
  const correctedInput =
    priceOverride ?? (price ? baseCorrected.toFixed(2).replace(".", ",") : "");
  const correctedNum = parseDutch(correctedInput);
  const pct = bidPercentages(settings, correctedNum);
  const cashBid = roundBid((correctedNum * pct.cash) / 100, settings.rounding);
  const tradeBid = roundBid((correctedNum * pct.trade) / 100, settings.rounding);

  // Recent searches + today's buy total (float watch)
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const [todaySpend, setTodaySpend] = useState(0);

  // Feedback
  const [toast, setToast] = useState<{
    text: string;
    tone: "ok" | "err";
    undoable?: boolean;
  } | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  function showToast(text: string, tone: "ok" | "err" = "ok", undoable = false) {
    setToast({ text, tone, undoable });
    setTimeout(() => setToast(null), undoable ? 4200 : 2500);
  }

  // Restore last session on mount (state applied in a microtask callback)
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => {
      if (!live) return;
      try {
        const saved = sessionStorage.getItem("cardpit_last");
        if (!saved) return;
        const s = JSON.parse(saved);
        if (s.selected) setSelected(s.selected);
        if (s.query) setQuery(s.query);
        if (s.price) setPrice(s.price);
        if (s.condition) setCondition(s.condition);
        if (typeof s.priceOverride === "string") setPriceOverride(s.priceOverride);
      } catch {
        // ignore corrupt storage
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Auto-focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Load recent searches + today's buy total on mount
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => {
      if (!live) return;
      try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (raw) setRecent(JSON.parse(raw));
      } catch {
        // corrupt storage — ignore
      }
    });
    getTodaySpend()
      .then((v) => {
        if (live) setTodaySpend(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      async () => {
        // Skip when the query is short, or when it was set by selecting a
        // card or recognizing a slab — otherwise the dropdown would reopen
        // over the result panel.
        if (
          q.length < 2 ||
          (selected && q === selected.name) ||
          (slab && q === slab.name)
        ) {
          setResults([]);
          setShowResults(false);
          setNoResults(false);
          return;
        }
        setIsSearching(true);
        setNoResults(false);
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          const found = data.results ?? [];
          setResults(found);
          setShowResults(true);
          // New sets, promos, obscure cards: API doesn't know everything.
          // Offer the manual path instead of dead-ending.
          setNoResults(found.length === 0);
        } catch {
          // offline — same manual path applies
          setResults([]);
          setNoResults(true);
        } finally {
          setIsSearching(false);
        }
      },
      q.length < 2 ? 0 : 400
    );
    return () => clearTimeout(timer);
  }, [query, selected, slab]);

  // Persist current selection to sessionStorage
  useEffect(() => {
    if (!selected) return;
    try {
      sessionStorage.setItem(
        "cardpit_last",
        JSON.stringify({ selected, query, price, condition, priceOverride })
      );
    } catch {
      // quota exceeded or private mode — ignore
    }
  }, [selected, query, price, condition, priceOverride]);

  function exitSlab() {
    setSlab(null);
    setEbay(null);
    setEbayError("");
  }

  /** Card the API doesn't know: proceed with just a name + manual price. */
  function selectManual() {
    const name = query.trim();
    if (!name) return;
    exitSlab();
    setSelected({ id: "", name, set: "", number: "", imageUrl: "" });
    setShowResults(false);
    setNoResults(false);
    setResults([]);
    setPrice(null);
    setPriceError("");
    setPriceOverride(null);
    setQty(1);
    setIsFetchingPrice(false);
  }

  async function selectCard(card: SearchResult) {
    exitSlab();
    setSelected(card);
    setShowResults(false);
    setQuery(card.name);
    setPrice(null);
    setPriceError("");
    setPriceOverride(null);
    setLightbox(false);
    setQty(1);
    setIsFetchingPrice(true);

    // Remember for the "recent gezocht" strip (MRU, max 8)
    setRecent((prev) => {
      const next = [card, ...prev.filter((c) => c.id !== card.id)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // quota / private mode — ignore
      }
      return next;
    });

    // 1. Check IndexedDB cache first
    try {
      const cached = await getCachedPriceWithAge(card.id);
      if (cached && cached.ageMs < CACHE_TTL) {
        setPrice(cached.price);
        setPriceFromCache(true);
        setCacheAgeMs(cached.ageMs);
        setIsFetchingPrice(false);
        return;
      }
    } catch {
      /* IDB unavailable */
    }

    // 2. Fetch from API
    try {
      const res = await fetch(
        `/api/price?cardId=${card.id}&cardName=${encodeURIComponent(card.name)}&cardSet=${encodeURIComponent(card.set)}`
      );
      const data = await res.json();
      if (data.price) {
        const p = data.price as CachedPrice;
        await setCachedPrice(p).catch(() => {});
        setPrice(p);
        setPriceFromCache(false);
      } else {
        setPriceError(data.error ?? tr("no_price"));
      }
    } catch {
      // Offline — try stale cache as fallback
      try {
        const stale = await getCachedPriceWithAge(card.id);
        if (stale) {
          setPrice(stale.price);
          setPriceFromCache(true);
          setCacheAgeMs(stale.ageMs);
        } else {
          setPriceError(tr("offline_manual"));
        }
      } catch {
        setPriceError(tr("offline_manual"));
      }
    } finally {
      setIsFetchingPrice(false);
    }
  }

  // ─── Slab flow: eBay is the price source for graded cards ───
  async function enterSlab(info: SlabInfo) {
    setSelected(null);
    setPrice(null);
    setPriceError("");
    setShowResults(false);
    setResults([]);
    setSlab(info);
    setQuery(info.name);
    setPriceOverride(null);
    setEbay(null);
    setEbayError("");
    setEbayLoading(true);
    try {
      const res = await fetch(`/api/ebay?q=${encodeURIComponent(slabQuery(info))}`);
      const data = await res.json();
      if (res.ok && data.items) {
        setEbay(data);
        if (data.stats?.median > 0) {
          setPriceOverride(data.stats.median.toFixed(2).replace(".", ","));
        }
      } else {
        setEbayError(data.error ?? tr("ebay_error"));
      }
    } catch {
      setEbayError(tr("ebay_error"));
    } finally {
      setEbayLoading(false);
    }
  }

  // ─── Scan flow: camera photo → /api/scan (Ximilar) → auto-search ───
  async function handleScanFile(file: File) {
    setIsScanning(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json();
      if (res.ok && data.name) {
        if (data.slab) {
          showToast(tr("slab_recognized", { name: data.name }));
          void enterSlab({
            name: data.name,
            set: data.set ?? "",
            company: data.slab.company ?? "",
            grade: data.slab.grade ?? "",
          });
        } else {
          exitSlab();
          setSelected(null);
          setQuery(data.name);
          searchRef.current?.focus();
          showToast(tr("recognized", { name: data.name }));
        }
      } else {
        showToast(data.error ?? tr("scan_not_recognized"), "err");
        searchRef.current?.focus();
      }
    } catch {
      showToast(tr("scan_failed"), "err");
      searchRef.current?.focus();
    } finally {
      setIsScanning(false);
    }
  }

  async function addToCart(type: "inkoop" | "inruil") {
    const isSlab = !selected && slab !== null;
    if (!selected && !slab) return;
    const name = isSlab
      ? `${slab!.name} · ${slab!.company} ${slab!.grade}`.trim()
      : selected!.name;
    await cart.add({
      cardId: isSlab ? "" : selected!.id,
      cardName: name,
      cardSet: isSlab ? slab!.set : selected!.set,
      cardImageUrl: isSlab ? "" : selected!.imageUrl,
      condition: isSlab ? "MT" : condition,
      type,
      quantity: qty,
      correctedPrice: correctedNum,
      cashBid,
      tradeBid,
    });
    showToast(
      tr("added_as", {
        name: qty > 1 ? `${qty}× ${name}` : name,
        type: tr(type === "inkoop" ? "type_buy" : "type_trade"),
      }),
      "ok",
      true
    );

    // Reset for next card
    setSelected(null);
    exitSlab();
    setPrice(null);
    setQuery("");
    setPriceOverride(null);
    setCondition("NM");
    setQty(1);
    try { sessionStorage.removeItem("cardpit_last"); } catch { /* ignore */ }
    searchRef.current?.focus();
  }

  async function undoLast() {
    await cart.undo();
    showToast(tr("undone"));
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-5 pb-4">
      {/* Logo row */}
      <div className="flex items-center justify-between animate-fade">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-gold to-gold-deep flex items-center justify-center flex-none shadow-[0_0_18px_rgba(240,180,64,0.3)]">
            <div className="w-3 h-3 bg-base rotate-45 rounded-[3px]" />
          </div>
          <span className="font-black text-[20px] tracking-tight text-content">
            Card<span className="text-gold">Pit</span>
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {/* Float watch — what went out on buys today */}
          {todaySpend > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-gold-bright bg-gold/10 border border-gold/30 rounded-full px-3 py-1.5 whitespace-nowrap">
              <span className="ms ms-fill text-[14px]">payments</span>
              {tr("float_today", { amount: fmt(todaySpend) })}
            </span>
          )}
          {settings.eventTag ? (
            <span className="text-[12px] font-semibold text-content-dim bg-surface-raised border border-edge rounded-full px-3 py-1.5 max-w-[130px] truncate">
              {settings.eventTag}
            </span>
          ) : null}
        </div>
      </div>

      {/* Search bar — z-30 so the results dropdown always paints above the
          (transform-animated) sections below it */}
      <div className="relative z-30 animate-rise">
        <div className="flex items-center gap-2.5 ticket border border-edge rounded-2xl pl-4 pr-1.5 h-[56px] focus-within:border-gold/50 transition-colors">
          <span className={`ms text-[21px] flex-none ${isSearching ? "text-gold animate-spin-slow" : "text-content-dim"}`}>
            {isSearching ? "progress_activity" : "search"}
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected) setSelected(null);
              if (slab) exitSlab();
            }}
            placeholder={tr("search_placeholder")}
            className="flex-1 bg-transparent border-none outline-none text-content text-[16px] font-medium placeholder:text-content-faint min-w-0"
          />
          {/* Camera scan button */}
          <button
            onClick={() => scanInputRef.current?.click()}
            disabled={isScanning}
            className="press w-11 h-11 rounded-xl bg-gradient-to-b from-gold to-gold-deep flex items-center justify-center flex-none shadow-[0_0_16px_rgba(240,180,64,0.35)]"
          >
            <span className={`ms text-[22px] text-base ${isScanning ? "animate-spin-slow" : ""}`}>
              {isScanning ? "progress_activity" : "photo_camera"}
            </span>
          </button>
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScanFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Search results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-surface-raised border border-edge-bright rounded-2xl overflow-hidden z-40 shadow-[0_16px_48px_rgba(0,0,0,0.6)] animate-pop">
            {results.slice(0, 8).map((card) => (
              <button
                key={card.id}
                onClick={() => selectCard(card)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-card active:bg-surface-card border-b border-edge last:border-b-0 text-left transition-colors"
              >
                {card.imageUrl ? (
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    width={32}
                    height={44}
                    className="rounded flex-none object-contain"
                  />
                ) : (
                  <div className="w-8 h-11 rounded bg-surface-card border border-edge flex-none" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] text-content truncate">
                    {card.name}
                  </div>
                  <div className="text-[12px] text-content-dim truncate">
                    {card.set}
                    {card.number ? ` · ${card.number}` : ""}
                  </div>
                </div>
                <span className="ms text-[18px] text-content-faint flex-none">
                  chevron_right
                </span>
              </button>
            ))}
          </div>
        )}

        {/* No results — never a dead end: continue with manual entry */}
        {noResults &&
          !isSearching &&
          !selected &&
          !slab &&
          query.trim().length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-surface-raised border border-edge-bright rounded-2xl z-40 shadow-[0_16px_48px_rgba(0,0,0,0.6)] animate-pop p-4 flex flex-col gap-3">
              <p className="text-[14px] text-content-dim">
                {tr("no_results_for", { q: query.trim() })}
              </p>
              <button
                onClick={selectManual}
                className="press flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[14px]"
              >
                <span className="ms text-[19px]">edit</span>
                {tr("enter_manually")}
              </button>
            </div>
          )}
      </div>

      {/* Selected card or slab — everything below staggers in */}
      {(selected || slab) && (
        <div
          className="stagger flex flex-col gap-5"
          key={selected ? selected.id : `slab-${slab!.name}-${slab!.grade}`}
        >
          {selected && (
          <div className="ticket border border-edge rounded-[20px] p-4 flex gap-4 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full bg-gold/6 blur-3xl" />
            {/* Card image — tap to zoom */}
            <div
              onClick={() => selected.imageUrl && setLightbox(true)}
              className="press w-[86px] h-[118px] flex-none rounded-xl border border-edge-bright bg-surface-card flex items-center justify-center overflow-hidden cursor-pointer"
            >
              {selected.imageUrl ? (
                <Image
                  src={selected.imageUrl}
                  alt={selected.name}
                  width={86}
                  height={118}
                  className="object-contain w-full h-full"
                />
              ) : (
                <span className="font-mono text-[10px] text-content-ghost tracking-widest">
                  CARD
                </span>
              )}
            </div>

            {/* Card info */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="font-extrabold text-[21px] text-content tracking-tight leading-tight">
                {selected.name}
              </div>
              <div className="text-[13px] text-content-dim mt-0.5">
                {selected.set}
                {selected.number ? ` · ${selected.number}` : ""}
              </div>

              {isFetchingPrice && (
                <div className="mt-auto flex flex-col gap-1.5">
                  <div className="skeleton h-3 w-24" />
                  <div className="skeleton h-8 w-32" />
                  <div className="skeleton h-3 w-40" />
                </div>
              )}

              {priceError && !isFetchingPrice && (
                <div className="mt-auto text-[13px] font-medium text-danger">
                  {priceError}
                </div>
              )}

              {price && !isFetchingPrice && (
                <>
                  <div className="mt-auto text-[11px] font-bold text-content-dim uppercase tracking-[0.08em]">
                    {tr("cardmarket_trend")}
                  </div>
                  <div className="font-mono font-bold text-[28px] text-gold-bright tracking-tight leading-tight tabular-nums">
                    {fmt(price.trendPrice)}
                  </div>
                  <div className="text-[11px] text-content-dim mt-1">
                    {priceFromCache
                      ? tr("price_from", { age: fmtAge(cacheAgeMs, lang) })
                      : tr("just_updated")}{" "}
                    · 7d: {fmt(price.avg7)} · 30d: {fmt(price.avg30)}
                  </div>
                </>
              )}
            </div>
          </div>
          )}

          {/* Manual card: friendly hint instead of an error */}
          {selected && !selected.id && !price && (
            <div className="flex items-start gap-2.5 bg-gold/8 border border-gold/30 rounded-xl px-3.5 py-3 text-[13px] text-gold-bright font-medium leading-snug">
              <span className="ms text-[17px] flex-none mt-0.5">edit</span>
              {tr("manual_price_hint")}
            </div>
          )}

          {/* Slab panel — graded card recognized from a scan */}
          {!selected && slab && (
            <>
              <div className="ticket border border-gold/40 rounded-[20px] p-4 flex gap-4 relative overflow-hidden">
                <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full bg-gold/8 blur-3xl" />
                <div className="w-[76px] h-[104px] flex-none rounded-xl border-2 border-gold/50 bg-surface-card flex flex-col items-center justify-center gap-1.5">
                  <span className="ms ms-fill text-[28px] text-gold">workspace_premium</span>
                  <span className="font-mono text-[11px] font-bold text-gold-bright tracking-wider">
                    {slab.company} {slab.grade}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[11px] font-bold text-gold uppercase tracking-[0.08em]">
                    {tr("graded_card")}
                  </span>
                  <div className="font-extrabold text-[21px] text-content tracking-tight leading-tight mt-0.5">
                    {slab.name}
                  </div>
                  <div className="text-[13px] text-content-dim mt-0.5">
                    {slab.set ? `${slab.set} · ` : ""}
                    {slab.company} {slab.grade}
                  </div>
                  <p className="text-[11px] text-content-faint mt-auto leading-snug">
                    {tr("slab_wrong")}
                  </p>
                </div>
              </div>

              {/* eBay prices */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
                    {tr("ebay_prices")}
                    {ebay && ebay.stats.count > 0 ? (
                      <span className="ml-2 normal-case font-medium text-content-faint tracking-normal">
                        {tr("ebay_listings", { n: ebay.stats.count })}
                      </span>
                    ) : null}
                  </span>
                  {ebay?.demo && (
                    <span className="text-[10px] font-bold text-gold bg-gold/10 border border-gold/30 rounded-full px-2 py-0.5">
                      {tr("ebay_demo")}
                    </span>
                  )}
                </div>

                {ebayLoading && (
                  <div className="ticket border border-edge rounded-2xl p-4 flex items-center gap-3">
                    <span className="ms text-[20px] text-gold animate-spin-slow">
                      progress_activity
                    </span>
                    <span className="text-[14px] text-content-dim">{tr("searching_ebay")}</span>
                  </div>
                )}

                {ebayError && !ebayLoading && (
                  <div className="ticket border border-edge rounded-2xl p-4 text-[13px] text-danger font-medium">
                    {ebayError}
                  </div>
                )}

                {ebay && !ebayLoading && (
                  <>
                    {/* Low / median / avg */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: tr("ebay_lowest"), value: ebay.stats.low, hi: false },
                        { label: tr("ebay_median"), value: ebay.stats.median, hi: true },
                        { label: tr("ebay_average"), value: ebay.stats.avg, hi: false },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className={`rounded-2xl px-3 py-3 border flex flex-col gap-1 min-w-0 ${
                            s.hi ? "border-gold/50 bg-gold/8" : "ticket border-edge"
                          }`}
                        >
                          <span className="text-[10px] font-bold text-content-dim uppercase tracking-[0.08em] truncate">
                            {s.label}
                          </span>
                          <span
                            className={`font-mono font-bold text-[15px] tabular-nums truncate ${
                              s.hi ? "text-gold-bright" : "text-content"
                            }`}
                          >
                            {fmt(s.value)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Listings — tap to open on eBay */}
                    {ebay.items.length > 0 ? (
                      <div className="ticket border border-edge rounded-2xl overflow-hidden">
                        {ebay.items.slice(0, 5).map((item, i) => (
                          <a
                            key={i}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-3 px-3.5 py-3 hover:bg-surface-card active:bg-surface-card transition-colors ${
                              i > 0 ? "border-t border-edge" : ""
                            }`}
                          >
                            <div className="w-9 h-12 flex-none rounded-lg border border-edge bg-surface-card overflow-hidden flex items-center justify-center">
                              {item.imageUrl ? (
                                <Image
                                  src={item.imageUrl}
                                  alt={item.title}
                                  width={36}
                                  height={48}
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <span className="ms text-[15px] text-content-ghost">sell</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-content truncate">
                                {item.title}
                              </div>
                              {item.condition && (
                                <div className="text-[11px] text-content-dim truncate mt-0.5">
                                  {item.condition}
                                </div>
                              )}
                            </div>
                            <span className="font-mono font-bold text-[14px] text-content tabular-nums flex-none">
                              {fmt(item.price)}
                            </span>
                            <span className="ms text-[16px] text-content-faint flex-none">
                              open_in_new
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="ticket border border-edge rounded-2xl p-4 text-[13px] text-content-dim">
                        {tr("ebay_empty")}
                      </div>
                    )}
                  </>
                )}

                {/* Open the full search on eBay */}
                {!ebayLoading && (
                  <a
                    href={
                      ebay?.searchUrl ??
                      `https://www.ebay.nl/sch/i.html?_nkw=${encodeURIComponent(slabQuery(slab))}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="press flex items-center justify-center gap-2 h-12 rounded-2xl border-2 border-gold/60 bg-gold/8 text-gold-bright font-extrabold text-[15px]"
                  >
                    <span className="ms text-[19px]">open_in_new</span>
                    {tr("open_on_ebay")}
                  </a>
                )}
              </div>
            </>
          )}

          {/* Condition pills — raw cards only; a slab's grade replaces condition */}
          {selected && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
              {tr("condition")}
            </span>
            <ConditionButtons
              selected={condition}
              onChange={(c) => {
                setCondition(c);
                setPriceOverride(null);
              }}
            />
          </div>
          )}

          {/* Corrected price */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
                {tr("corrected_price")}
              </span>
              <span className="flex items-center gap-1 text-[12px] font-medium text-content-dim">
                <span className="ms text-[15px]">edit</span>
                {tr("editable")}
              </span>
            </div>
            <div className="flex items-center gap-2 ticket border border-edge rounded-2xl h-[58px] px-5 focus-within:border-gold/50 transition-colors">
              <span className="font-mono font-bold text-[22px] text-content-dim">€</span>
              <input
                value={correctedInput}
                onChange={(e) => setPriceOverride(e.target.value)}
                inputMode="decimal"
                className="flex-1 bg-transparent border-none outline-none text-content font-mono font-bold text-[24px] tracking-tight min-w-0 tabular-nums"
              />
            </div>
            {!selected && slab && ebay && (
              <p className="text-[11px] text-content-faint px-1">{tr("ebay_prefilled")}</p>
            )}
          </div>

          {/* Bids */}
          <BidDisplay cashBid={cashBid} tradeBid={tradeBid} />

          {/* Quantity — bulk buys of the same card */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
              {tr("quantity")}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 ticket border border-edge rounded-2xl px-1.5 h-12">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="press w-9 h-9 rounded-xl bg-surface-card border border-edge flex items-center justify-center text-content-dim"
                >
                  <span className="ms text-[18px]">remove</span>
                </button>
                <span className="font-mono font-bold text-[17px] text-content w-9 text-center tabular-nums">
                  {qty}
                </span>
                <button
                  onClick={() => setQty((q) => q + 1)}
                  className="press w-9 h-9 rounded-xl bg-surface-card border border-edge flex items-center justify-center text-content-dim"
                >
                  <span className="ms text-[18px]">add</span>
                </button>
              </div>
              <button
                onClick={() => setQty((q) => q + 5)}
                className="press h-12 px-3.5 rounded-2xl ticket border border-edge font-mono font-bold text-[13px] text-content-dim"
              >
                +5
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-3 mt-0.5">
            <button
              onClick={() => addToCart("inkoop")}
              disabled={correctedNum <= 0}
              className="press flex items-center justify-center gap-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_22px_rgba(240,180,64,0.3)] disabled:opacity-40"
            >
              <span className="ms text-[21px]">add</span>
              {tr("add_as_buy")}
              {qty > 1 ? ` ×${qty}` : ""}
            </button>
            <button
              onClick={() => addToCart("inruil")}
              disabled={correctedNum <= 0}
              className="press flex items-center justify-center gap-2 h-14 rounded-2xl border-2 border-trade/70 bg-trade/8 text-trade font-extrabold text-[16px] disabled:opacity-40"
            >
              <span className="ms text-[21px]">swap_horiz</span>
              {tr("add_as_trade")}
              {qty > 1 ? ` ×${qty}` : ""}
            </button>
          </div>
        </div>
      )}

      {/* Recent searches — one tap back to a card you keep buying */}
      {!selected && !slab && recent.length > 0 && (
        <div className="flex flex-col gap-2 animate-rise">
          <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em] px-1">
            {tr("recent_searched")}
          </span>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
            {recent.map((card) => (
              <button
                key={card.id}
                onClick={() => selectCard(card)}
                className="press flex items-center gap-2 flex-none ticket border border-edge rounded-full pl-1.5 pr-3.5 h-11"
              >
                {card.imageUrl ? (
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    width={28}
                    height={38}
                    className="rounded-md object-contain h-8 w-auto"
                  />
                ) : (
                  <span className="ms text-[16px] text-content-faint w-7 text-center">
                    style
                  </span>
                )}
                <span className="text-[13px] font-semibold text-content whitespace-nowrap max-w-[140px] truncate">
                  {card.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selected && !slab && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center animate-rise-lg">
          <div className="relative">
            <div className="w-20 h-28 rounded-xl border-2 border-dashed border-edge-bright rotate-[-8deg]" />
            <div className="absolute top-0 left-3 w-20 h-28 rounded-xl border-2 border-edge bg-surface-raised rotate-[6deg] flex items-center justify-center">
              <span className="ms text-3xl text-content-faint">style</span>
            </div>
          </div>
          <p className="text-[15px] text-content-dim max-w-[230px] leading-relaxed">
            {tr("search_empty")}
          </p>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && selected?.imageUrl && (
        <div
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-8 animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-[320px] w-full animate-pop"
          >
            <Image
              src={selected.imageUrl}
              alt={selected.name}
              width={320}
              height={445}
              className="w-full h-auto rounded-2xl shadow-[0_0_80px_rgba(240,180,64,0.15)]"
              priority
            />
            <button
              onClick={() => setLightbox(false)}
              className="press absolute -top-3 -right-3 w-9 h-9 rounded-full bg-surface-raised border border-edge-bright flex items-center justify-center shadow-lg"
            >
              <span className="ms text-[20px] text-content-dim">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast — with inline undo after cart mutations */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 flex items-center bg-surface-raised border border-edge-bright rounded-2xl pl-4 pr-3 py-3 text-[14px] font-semibold text-content shadow-[0_12px_32px_rgba(0,0,0,0.6)] z-50 whitespace-nowrap animate-toast max-w-[calc(100vw-40px)]">
          <span className={`ms ms-fill text-[16px] mr-2 flex-none ${toast.tone === "ok" ? "text-trade" : "text-danger"}`}>
            {toast.tone === "ok" ? "check_circle" : "error"}
          </span>
          <span className="truncate">{toast.text}</span>
          {toast.undoable && cart.canUndo && (
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

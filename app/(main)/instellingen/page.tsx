"use client";

import { useState } from "react";
import Link from "next/link";
import { useSettings } from "@/hooks/useSettings";
import { fmt } from "@/lib/format";
import { t, LANGUAGES, type Lang, type TKey } from "@/lib/i18n";
import {
  getTransactions,
  getInventory,
  type BidTier,
  type Condition,
  type VendorSettings,
} from "@/lib/db";
import {
  transactionsCsv,
  inventoryCsv,
  downloadCsv,
  exportFilename,
} from "@/lib/export";

const CONDITIONS: Condition[] = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

const ROUNDING_OPTIONS = [0, 0.5, 1];

export default function InstellingenPage() {
  const { settings, loading, save } = useSettings();

  // Mount the form only after IndexedDB has loaded, so the form state can be
  // initialized directly from the stored settings — no syncing effects needed.
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="ms text-3xl text-gold animate-spin-slow">progress_activity</span>
      </div>
    );
  }

  return <SettingsForm initial={settings} onSave={save} />;
}

function SettingsForm({
  initial,
  onSave,
}: {
  initial: VendorSettings;
  onSave: (s: VendorSettings) => Promise<void>;
}) {
  const [cashPct, setCashPct] = useState(initial.cashPercentage);
  const [tradePct, setTradePct] = useState(initial.tradePercentage);
  const [multipliers, setMultipliers] = useState({ ...initial.conditionMultipliers });
  const [eventTag, setEventTag] = useState(initial.eventTag ?? "");
  const [language, setLanguage] = useState<Lang>(initial.language ?? "nl");
  const [rounding, setRounding] = useState(initial.rounding ?? 0);
  const [tiers, setTiers] = useState<BidTier[]>(initial.bidTiers ?? []);
  const [saved, setSaved] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // Preview the chosen language immediately on this screen; the rest of the
  // app switches once the vendor saves.
  const tr = (key: TKey, vars?: Record<string, string | number>) =>
    t(language, key, vars);

  async function handleSave() {
    await onSave({
      cashPercentage: cashPct,
      tradePercentage: tradePct,
      conditionMultipliers: multipliers,
      eventTag: eventTag.trim(),
      language,
      rounding,
      bidTiers: tiers.filter((t) => t.from > 0).sort((a, b) => a.from - b.from),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function setMult(c: Condition, val: number) {
    setMultipliers((prev) => ({ ...prev, [c]: val }));
  }

  function setTier(index: number, patch: Partial<BidTier>) {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  async function exportTransactions() {
    const txs = await getTransactions();
    if (txs.length === 0) {
      setExportMsg(tr("export_empty"));
    } else {
      downloadCsv(exportFilename("transacties"), transactionsCsv(txs, language));
      setExportMsg(tr("export_done"));
    }
    setTimeout(() => setExportMsg(""), 2500);
  }

  async function exportInventory() {
    const inv = await getInventory();
    if (inv.length === 0) {
      setExportMsg(tr("export_empty"));
    } else {
      downloadCsv(exportFilename("voorraad"), inventoryCsv(inv));
      setExportMsg(tr("export_done"));
    }
    setTimeout(() => setExportMsg(""), 2500);
  }

  return (
    <div className="px-5 pt-6 pb-6 flex flex-col gap-6 stagger">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/zoeken"
          className="press w-10 h-10 rounded-xl ticket border border-edge flex items-center justify-center flex-none"
        >
          <span className="ms text-[22px] text-content-dim">arrow_back</span>
        </Link>
        <h1 className="text-[24px] font-black tracking-tight text-content">
          {tr("settings_title")}
        </h1>
      </div>

      {/* Taal / Language */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("language")}
        </h2>
        <div className="flex gap-2">
          {LANGUAGES.map((l) => {
            const active = language === l.value;
            return (
              <button
                key={l.value}
                onClick={() => setLanguage(l.value)}
                className={`press flex-1 flex items-center justify-center gap-2 h-13 py-3.5 rounded-2xl border font-bold text-[14px] transition-colors ${
                  active
                    ? "bg-gold/12 border-gold/60 text-gold-bright"
                    : "ticket border-edge text-content-dim"
                }`}
              >
                <span className={`ms text-[19px] ${active ? "ms-fill" : ""}`}>language</span>
                {l.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Beurs / event tag */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("current_fair")}
        </h2>
        <div className="flex items-center gap-3 ticket border border-edge rounded-2xl px-4 h-14 focus-within:border-gold/50 transition-colors">
          <span className="ms text-[20px] text-gold">storefront</span>
          <input
            value={eventTag}
            onChange={(e) => setEventTag(e.target.value)}
            placeholder={tr("fair_placeholder")}
            className="flex-1 bg-transparent border-none outline-none text-content text-[15px] font-medium placeholder:text-content-faint min-w-0"
          />
        </div>
        <p className="text-[12px] text-content-faint px-1 -mt-1">
          {tr("fair_help")}
        </p>
      </section>

      {/* Inkooppercentages */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("buy_percentages")}
        </h2>

        {/* Cash */}
        <div className="ticket border border-edge rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-[15px] font-bold text-content">
              <span className="ms ms-fill text-[18px] text-gold">payments</span>
              {tr("cash_buy_pct")}
            </span>
            <span className="min-w-[62px] text-center py-1.5 rounded-xl bg-surface-card border border-edge font-mono font-bold text-[16px] text-gold-bright tabular-nums">
              {cashPct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cashPct}
            onChange={(e) => setCashPct(Number(e.target.value))}
            className="w-full accent-gold h-1.5 rounded-full"
          />
        </div>

        {/* Inruil */}
        <div className="ticket border border-edge rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-[15px] font-bold text-content">
              <span className="ms ms-fill text-[18px] text-trade">swap_horiz</span>
              {tr("trade_buy_pct")}
            </span>
            <span className="min-w-[62px] text-center py-1.5 rounded-xl bg-surface-card border border-edge font-mono font-bold text-[16px] text-trade tabular-nums">
              {tradePct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={tradePct}
            onChange={(e) => setTradePct(Number(e.target.value))}
            className="w-full accent-trade h-1.5 rounded-full"
          />
        </div>

        {/* Preview */}
        <div className="bg-surface-card border border-edge rounded-xl px-4 py-3 text-[13px] font-medium text-content-dim">
          {tr("preview_100")}{" "}
          <span className="text-gold-bright font-bold font-mono">Cash = {fmt(cashPct)}</span>
          {" · "}
          <span className="text-trade font-bold font-mono">
            {tr("pay_trade")} = {fmt(tradePct)}
          </span>
        </div>
      </section>

      {/* Afronden */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("rounding")}
        </h2>
        <div className="flex gap-2">
          {ROUNDING_OPTIONS.map((step) => {
            const active = rounding === step;
            return (
              <button
                key={step}
                onClick={() => setRounding(step)}
                className={`press flex-1 h-12 rounded-2xl border font-bold text-[14px] font-mono tabular-nums transition-colors ${
                  active
                    ? "bg-gold/12 border-gold/60 text-gold-bright"
                    : "ticket border-edge text-content-dim"
                }`}
              >
                {step === 0 ? tr("rounding_none") : fmt(step)}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-content-faint px-1 -mt-1">{tr("rounding_help")}</p>
      </section>

      {/* Bied-tiers */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("bid_tiers")}
        </h2>
        {tiers.length > 0 && (
          <div className="ticket border border-edge rounded-2xl overflow-hidden">
            {tiers.map((tier, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-3.5 py-3 ${
                  i > 0 ? "border-t border-edge" : ""
                }`}
              >
                <span className="text-[12px] text-content-dim flex-none">
                  {tr("tier_from")} €
                </span>
                <input
                  type="number"
                  min={0}
                  value={tier.from}
                  onChange={(e) => setTier(i, { from: Number(e.target.value) })}
                  className="w-14 bg-surface-card border border-edge rounded-lg text-right px-2 py-1 font-mono font-bold text-[15px] text-content outline-none focus:border-gold/60 tabular-nums"
                />
                <span className="ms text-[16px] text-gold flex-none ml-1">payments</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tier.cashPct}
                  onChange={(e) => setTier(i, { cashPct: Number(e.target.value) })}
                  className="w-12 bg-surface-card border border-edge rounded-lg text-right px-1.5 py-1 font-mono font-bold text-[15px] text-gold-bright outline-none focus:border-gold/60 tabular-nums"
                />
                <span className="ms text-[16px] text-trade flex-none">swap_horiz</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tier.tradePct}
                  onChange={(e) => setTier(i, { tradePct: Number(e.target.value) })}
                  className="w-12 bg-surface-card border border-edge rounded-lg text-right px-1.5 py-1 font-mono font-bold text-[15px] text-trade outline-none focus:border-gold/60 tabular-nums"
                />
                <span className="text-[12px] text-content-dim flex-none">%</span>
                <button
                  onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
                  className="press w-8 h-8 flex-none rounded-lg flex items-center justify-center text-content-ghost active:text-danger ml-auto"
                >
                  <span className="ms text-[18px]">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() =>
            setTiers((prev) => [
              ...prev,
              { from: 50, cashPct: cashPct, tradePct: tradePct },
            ])
          }
          className="press flex items-center justify-center gap-2 h-12 rounded-2xl border border-dashed border-edge-bright text-content-dim font-bold text-[14px]"
        >
          <span className="ms text-[19px]">add</span>
          {tr("add_tier")}
        </button>
        <p className="text-[12px] text-content-faint px-1 -mt-1">{tr("tiers_help")}</p>
      </section>

      {/* Conditie-aanpassingen */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("condition_adjustments")}
        </h2>
        <div className="ticket border border-edge rounded-2xl overflow-hidden">
          {CONDITIONS.map((c, i) => (
            <div
              key={c}
              className={`flex items-center gap-3 px-4 py-3.5 ${
                i > 0 ? "border-t border-edge" : ""
              }`}
            >
              <div className="w-[46px] h-[30px] rounded-xl bg-surface-card border border-edge flex items-center justify-center font-mono font-bold text-[13px] text-content flex-none">
                {c}
              </div>
              <span className="flex-1 text-[13px] text-content-dim">
                {tr("pct_of_trend")}
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={150}
                  value={multipliers[c]}
                  onChange={(e) => setMult(c, Number(e.target.value))}
                  className="w-14 bg-surface-card border border-edge rounded-lg text-right px-2 py-1 font-mono font-bold text-[16px] text-content outline-none focus:border-gold/60 tabular-nums"
                />
                <span className="text-[13px] text-content-dim">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Data & export */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("export_title")}
        </h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={exportTransactions}
            className="press flex items-center gap-3 ticket border border-edge rounded-2xl px-4 h-14 text-left"
          >
            <span className="ms text-[20px] text-gold">download</span>
            <span className="flex-1 text-[15px] font-bold text-content">
              {tr("export_transactions")}
            </span>
            <span className="font-mono text-[11px] font-bold text-content-dim bg-surface-card border border-edge rounded-md px-1.5 py-0.5">
              CSV
            </span>
          </button>
          <button
            onClick={exportInventory}
            className="press flex items-center gap-3 ticket border border-edge rounded-2xl px-4 h-14 text-left"
          >
            <span className="ms text-[20px] text-gold">download</span>
            <span className="flex-1 text-[15px] font-bold text-content">
              {tr("export_inventory")}
            </span>
            <span className="font-mono text-[11px] font-bold text-content-dim bg-surface-card border border-edge rounded-md px-1.5 py-0.5">
              CSV
            </span>
          </button>
        </div>
        {exportMsg && (
          <p className="text-[13px] font-semibold text-trade px-1 animate-rise">
            {exportMsg}
          </p>
        )}
        <p className="text-[12px] text-content-faint px-1 -mt-1">{tr("export_help")}</p>
      </section>

      {/* Save button */}
      <button
        onClick={handleSave}
        className={`press flex items-center justify-center gap-2 h-14 rounded-2xl font-extrabold text-[16px] transition-colors duration-300 ${
          saved
            ? "bg-trade text-base shadow-[0_0_20px_rgba(58,223,165,0.35)]"
            : "bg-gradient-to-b from-gold to-gold-deep text-base shadow-[0_0_20px_rgba(240,180,64,0.3)]"
        }`}
      >
        <span className="ms text-[21px]">{saved ? "check_circle" : "save"}</span>
        {saved ? tr("saved") : tr("save")}
      </button>
    </div>
  );
}

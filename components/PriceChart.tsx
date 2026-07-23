"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import { SHOW_PRICE_CHART } from "@/lib/config";
import { getPriceHistory, type PricePoint } from "@/lib/historyService";
import { useT } from "@/hooks/useSettings";

const LINE = "#4F8EF7";
const UP = "#00C896";
const DOWN = "#F75A5A";
const FLAT = "#8a8578";
const TICK = { fontSize: 10, fill: "#7a7568" } as const;

type RangeOption = { key: number; label: string; pts: PricePoint[] };

/**
 * Compact price-history chart, fed by historyService (our own logged
 * lookups — Cardmarket for raw cards, eBay median for slabs). While our
 * own history is still thin (<2 days) it falls back to the `fallback`
 * points the caller derives from the API (avg30/avg7/avg1/trend).
 *
 * Period picker: 7d / 30d / all — an option only appears when it actually
 * contains more data than the previous one (no dead buttons). There is no
 * 1d option on purpose: history is logged once per day, so a 1-day chart
 * can never draw a line. The trend chip follows the selected period.
 *
 * While SHOW_PRICE_CHART is false, or with no usable data, it renders
 * nothing. It is lazy-loaded by the caller and never blocks bidding.
 */
export default function PriceChart({
  lookupKey,
  fallback,
}: {
  lookupKey: string;
  fallback?: PricePoint[];
}) {
  const { tr, lang } = useT();
  const [own, setOwn] = useState<PricePoint[]>([]);
  const [range, setRange] = useState<number | null>(null);

  useEffect(() => {
    if (!SHOW_PRICE_CHART || !lookupKey) return;
    let live = true;
    getPriceHistory(lookupKey)
      .then((p) => {
        if (live) setOwn(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lookupKey]);

  if (!SHOW_PRICE_CHART) return null;

  const source =
    own.length >= 2 ? own : (fallback ?? []).filter((p) => p.price > 0);

  // Build the period options; skip ranges that add nothing.
  const now = Date.now();
  const ranges: RangeOption[] = [];
  for (const r of [7, 30, 0]) {
    const pts =
      r === 0
        ? source
        : source.filter(
            (p) => new Date(p.day).getTime() >= now - r * 86_400_000
          );
    if (pts.length >= 2 && !ranges.some((o) => o.pts.length === pts.length)) {
      ranges.push({
        key: r,
        label: r === 0 ? tr("range_all") : `${r}d`,
        pts,
      });
    }
  }
  if (ranges.length === 0) return null;

  const active =
    ranges.find((o) => o.key === range) ??
    ranges.find((o) => o.key === 30) ??
    ranges[ranges.length - 1];
  const points = active.pts;

  const first = points[0];
  const last = points[points.length - 1];
  const pct =
    first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
  const dir: "up" | "down" | "flat" =
    Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
  const color = dir === "up" ? UP : dir === "down" ? DOWN : FLAT;
  const icon =
    dir === "up"
      ? "trending_up"
      : dir === "down"
      ? "trending_down"
      : "trending_flat";
  const days = Math.max(
    1,
    Math.round(
      (new Date(last.day).getTime() - new Date(first.day).getTime()) /
        86_400_000
    )
  );
  const pctLabel = `${pct >= 0 ? "+" : "−"}${Math.abs(pct)
    .toFixed(1)
    .replace(".", ",")}%`;

  // Three x-axis labels: start, middle, end — small and unobtrusive.
  const xTicks = [
    ...new Set([
      first.day,
      points[Math.floor(points.length / 2)].day,
      last.day,
    ]),
  ];
  const fmtDayShort = (day: string) =>
    new Date(day).toLocaleDateString(lang === "nl" ? "nl-NL" : "en-GB", {
      day: "numeric",
      month: "short",
    });

  return (
    <div className="flex flex-col gap-2 animate-rise">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-content-dim uppercase tracking-[0.08em]">
          {tr("price_history")}
        </span>
        <span
          className="flex items-center gap-1 text-[12px] font-bold font-mono tabular-nums"
          style={{ color }}
        >
          <span className="ms text-[15px]">{icon}</span>
          {pctLabel}
          {/* Period is already communicated by the picker; only show the
              span here when there is no picker to avoid "7d vs 30d" clashes */}
          {ranges.length <= 1 ? ` · ${days}d` : ""}
        </span>
      </div>

      <div className="ticket border border-edge rounded-2xl pl-1 pr-3 pt-3 pb-2 h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="day"
              ticks={xTicks}
              tickFormatter={fmtDayShort}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              width={42}
              tickCount={3}
              tickFormatter={(v: number) => `€${Math.round(v)}`}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Period picker — only when there is more than one useful range */}
      {ranges.length > 1 && (
        <div className="flex justify-end gap-1.5">
          {ranges.map((o) => {
            const isActive = o.key === active.key;
            return (
              <button
                key={o.key}
                onClick={() => setRange(o.key)}
                className={`press h-8 px-3 rounded-lg border font-mono font-bold text-[11px] transition-colors ${
                  isActive
                    ? "bg-gold/12 border-gold/60 text-gold-bright"
                    : "bg-surface-raised border-edge text-content-dim"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

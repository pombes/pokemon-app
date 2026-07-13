import type { VendorSettings } from "./db";

/**
 * Bid calculation rules that sit between the corrected price and the
 * displayed bids: price-range tiers and rounding.
 */

/**
 * Which percentages apply at this price? Starts with the base percentages;
 * every tier whose threshold is reached overrides them (highest wins).
 */
export function bidPercentages(
  settings: VendorSettings,
  price: number
): { cash: number; trade: number } {
  let cash = settings.cashPercentage;
  let trade = settings.tradePercentage;
  const tiers = [...(settings.bidTiers ?? [])].sort((a, b) => a.from - b.from);
  for (const tier of tiers) {
    if (price >= tier.from) {
      cash = tier.cashPct;
      trade = tier.tradePct;
    }
  }
  return { cash, trade };
}

/** Round a bid to the vendor's step (€0.50 / €1). Step 0 or unset = off. */
export function roundBid(value: number, step: number | undefined): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

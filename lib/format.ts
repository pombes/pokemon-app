import { t, type Lang } from "./i18n";

/** Format a number as a Dutch EUR price: € 84,50 */
export function fmt(amount: number): string {
  return `€ ${amount.toFixed(2).replace(".", ",")}`;
}

/** Signed variant for winst/verlies: +€ 12,00 / −€ 3,50 */
export function fmtSigned(amount: number): string {
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}€ ${Math.abs(amount).toFixed(2).replace(".", ",")}`;
}

/** Format milliseconds as an age string: "3 min geleden" / "3 min ago" */
export function fmtAge(ms: number, lang: Lang = "nl"): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t(lang, "just_now");
  if (minutes < 60) return t(lang, "min_ago", { m: minutes });
  const hours = Math.floor(ms / 3_600_000);
  return t(lang, "hours_ago", { h: hours });
}

const DAY_LOCALE: Record<Lang, string> = { nl: "nl-NL", en: "en-GB" };

const TIME_FMT = new Intl.DateTimeFormat("nl-NL", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Vandaag" / "Gisteren" / "zaterdag 5 juli" (localized) */
export function fmtDay(ts: number, lang: Lang = "nl"): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t(lang, "today");
  if (d.toDateString() === yesterday.toDateString()) return t(lang, "yesterday");
  return new Intl.DateTimeFormat(DAY_LOCALE[lang], {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** "14:32" */
export function fmtTime(ts: number): string {
  return TIME_FMT.format(new Date(ts));
}

/** Parse a Dutch decimal input ("12,50") to a number. Returns 0 on garbage. */
export function parseDutch(val: string): number {
  return parseFloat(val.replace(",", ".")) || 0;
}

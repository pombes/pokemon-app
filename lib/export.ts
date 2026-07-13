import type { InventoryItem, TransactionRecord } from "./db";
import { t, type Lang, type TKey } from "./i18n";

/**
 * CSV export tuned for Dutch Excel: semicolon separator, decimal comma,
 * UTF-8 BOM. Double-clicking the file opens it straight into clean columns
 * — no import wizard needed. Margin per sale is included so the export
 * doubles as margeregeling (BTW over de marge) administration.
 */

function esc(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Number as Excel-NL value: decimal comma, no currency symbol. */
function num(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

function stamp(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const TX_LABEL: Record<TransactionRecord["type"], TKey> = {
  buy: "tx_buy",
  sell: "tx_sell",
  trade: "tx_trade",
};

export function transactionsCsv(txs: TransactionRecord[], lang: Lang): string {
  const header = [
    "Datum",
    "Tijd",
    "Type",
    "Kaart",
    "Set",
    "Conditie",
    "Aantal",
    "Inkoop p/s (EUR)",
    "Verkoop p/s (EUR)",
    "Marge p/s (EUR)",
    "Marge totaal (EUR)",
    "Betaalmethode",
    "Beurs",
    "Marktprijs (EUR)",
  ];
  const rows = [...txs]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((tx) => {
      const { date, time } = stamp(tx.createdAt);
      const isSale = tx.type !== "buy";
      const marginEach = isSale ? tx.sellPrice - tx.purchasePrice : 0;
      return [
        date,
        time,
        t(lang, TX_LABEL[tx.type]),
        esc(tx.cardName),
        esc(tx.cardSet),
        tx.condition,
        tx.quantity,
        num(tx.purchasePrice),
        isSale ? num(tx.sellPrice) : "",
        isSale ? num(marginEach) : "",
        isSale ? num(marginEach * tx.quantity) : "",
        tx.paymentMethod,
        esc(tx.eventTag),
        num(tx.marketPriceAtTime),
      ].join(";");
    });
  return "\uFEFF" + [header.join(";"), ...rows].join("\r\n");
}

export function inventoryCsv(items: InventoryItem[]): string {
  const header = [
    "Kaart",
    "Set",
    "Conditie",
    "Aantal",
    "Inkoop p/s (EUR)",
    "Inkoopwaarde (EUR)",
    "Gekocht op",
    "Notities",
  ];
  const rows = [...items]
    .sort((a, b) => a.cardName.localeCompare(b.cardName))
    .map((i) =>
      [
        esc(i.cardName),
        esc(i.cardSet),
        i.condition,
        i.quantity,
        num(i.purchasePrice),
        num(i.purchasePrice * i.quantity),
        stamp(i.purchasedAt).date,
        esc(i.notes),
      ].join(";")
    );
  return "\uFEFF" + [header.join(";"), ...rows].join("\r\n");
}

/** Trigger a browser download of the CSV. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(kind: "transacties" | "voorraad"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `cardpit-${kind}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}

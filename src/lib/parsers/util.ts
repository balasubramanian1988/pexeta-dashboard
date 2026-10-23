// Small helpers shared by the report parsers. No database or Next.js imports, so they run in tests too.
import { createHash } from "node:crypto";

export type Cell = string | number | boolean | Date | null | undefined;
export type Row = Record<string, Cell>;

/** "₹1,234.50", "12.5%", "-INR 81.35", 3.2, "" → number (0 when empty). Percent signs are dropped, not divided. */
export function num(v: Cell): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean" || v instanceof Date) return 0;
  const s = v.replace(/INR|₹|,|%|\s/g, "").trim();
  if (s === "" || s === "-" || s === "--") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "45.20%" → 0.452 */
export function pct(v: Cell): number {
  return num(v) / 100;
}

export function str(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar date in India for an instant, as YYYY-MM-DD. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** First day of the IST month, as YYYY-MM-01. */
export function istMonth(d: Date): string {
  return istDate(d).slice(0, 7) + "-01";
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** "30 Sept 2026 6:33:49 pm UTC" (Custom Unified Transaction report) → Date */
export function parseUnifiedDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?\s*(UTC|GMT)?/i);
  if (!m) return null;
  const key = m[2].toLowerCase();
  const mon = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
  if (mon === undefined) return null;
  let h = Number(m[4]);
  const ap = (m[7] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[1]), h, Number(m[5]), Number(m[6])));
}

/** "Oct 1, 2026" → "2026-10-01" (ads console dates are already account-local calendar days). */
export function parseUsDate(s: string): string | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const mon = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
  if (mon === undefined) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** An ads-report date cell (Excel date or text) → YYYY-MM-DD. Excel dates are read as UTC midnight. */
export function calendarDate(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split("/");
    return `${y}-${m}-${d}`;
  }
  return parseUsDate(s);
}

/** ISO timestamp with offset, or "2026-09-01 01:24:12" (MTR files, India time) → Date. */
export function parseTimestamp(s: string, assumeIst = false): Date | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t)) {
    return new Date(t.replace(" ", "T") + (assumeIst ? "+05:30" : "Z"));
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sha1(parts: string[]): string {
  return createHash("sha1").update(parts.join("␟")).digest("hex");
}

/**
 * Stable row hashes for reports without a unique id. A row that appears twice in the same file
 * (genuinely identical lines) gets a different hash for each copy, so re-uploading the same or an
 * overlapping file replaces rows instead of double counting them.
 */
export function rowHasher() {
  const seen = new Map<string, number>();
  return (parts: string[]) => {
    const base = sha1(parts);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : sha1([base, String(n)]);
  };
}

/** "ROOT and SOIL - Diaper Rash Coconut Balm for Babies | New Born…" → "Diaper Rash Coconut Balm for Babies" */
export function shortName(title: string): string {
  const first = title.split(/[|–—(]/)[0] ?? title;
  return first
    .replace(/root\s+and\s+soil/gi, "")
    .replace(/^[\s\-:]+|[\s\-:,.]+$/g, "")
    .trim()
    .slice(0, 80);
}

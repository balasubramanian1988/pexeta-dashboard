// Indian number formatting and small display helpers.
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rupees = (n: number, decimals = 0) => `₹${(decimals ? inr2 : inr0).format(Math.round(n * 100) / 100)}`.replace("₹-", "−₹");
export const count = (n: number) => inr0.format(n);
export const percent = (n: number, d = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "–");

/** ₹17.1 L / ₹1.2 Cr for KPI tiles. */
export function compactRupees(n: number) {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${inr0.format(a)}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateLabel(iso: string | null | undefined) {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
export function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${y}`;
}
export function dateTimeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

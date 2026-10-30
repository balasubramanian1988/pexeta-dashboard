// Myntra parsers and engine vs figures calculated independently (Python/openpyxl) from Root and Soil's September files.
// Put the files in test-data/myntra/. Run: npx tsx scripts/test-myntra.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";
import { computeMyntra, type MyInvoiceRow, type MyOrderRow, type MyReturnRow, type MySettlementRow } from "../src/lib/engine/myntra";

const DIR = join(process.cwd(), "test-data", "myntra");
type Ok = Extract<ParseResult, { ok: true }>;
let failures = 0;
function expect(label: string, got: number, want: number, tol = 0.05) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got.toFixed(2)} (expected ${want.toFixed(2)})`);
}
const sum = (rows: Ok["rows"], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

async function main() {
  const res: Ok[] = [];
  for (const f of readdirSync(DIR).sort()) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join(DIR, f))))) {
    if (!r.ok) { console.log(`skip  ${r.fileName.slice(0, 70)}: ${r.reason}`); continue; }
    res.push(r);
    console.log(`read  ${r.type.padEnd(14)} ${String(r.rows.length).padStart(4)}  ${r.periodStart ?? ""}→${r.periodEnd ?? ""}  ${r.fileName.slice(0, 70)}`);
  }
  const of = (t: string) => res.filter((r) => r.type === t);
  const settle = of("my_settlement").flatMap((r) => r.rows);
  const fwd = settle.filter((r) => r.kind === "forward");
  expect("Settlement: forward lines (settled 46 + pending 15)", fwd.length, 61, 0);
  expect("Settlement: settled amount", sum(settle, "settled"), 26061.59 - 465.04, 0.05);
  expect("Settlement: pending (expected) on unsettled", sum(fwd.filter((r) => !r.settled), "expected_settled"), 10390.1, 0.05);
  expect("Settlement: seller product amount, settled lines", sum(fwd.filter((r) => r.settled), "seller_product_amount"), 27755, 0.01);
  // Payout formula holds on every line: seller product − commission − logistics − TCS − TDS (signs reversed on returns).
  const off = settle.filter((r) => {
    const sign = r.kind === "reverse" ? -1 : 1;
    const calc = sign * Number(r.seller_product_amount) - Number(r.commission) - Number(r.logistics) - sign * (Number(r.tcs) + Number(r.tds));
    return Math.abs(calc - Number(r.settled || r.expected_settled)) > 0.05;
  });
  expect("Settlement: lines where the payout formula does not hold", off.length, 0, 0);
  expect("Orders (Sep + Oct)", of("my_orders").reduce((s, r) => s + r.rows.length, 0), 101, 0);
  expect("Returns rows (Sep 6 + Oct 12)", of("my_returns").reduce((s, r) => s + r.rows.length, 0), 18, 0);
  const inv = of("my_invoice").flatMap((r) => r.rows);
  expect("Invoices", inv.length, 4, 0);
  expect("Ads invoice (Aug) base", sum(inv.filter((r) => r.category === "Ads"), "base_amount"), 6763, 0.01);

  // Engine, September orders.
  const orders = of("my_orders").flatMap((r) => r.rows) as unknown as MyOrderRow[];
  const skuOfId = new Map(orders.map((o) => [o.sku_id, o.sku]));
  const sepS = settle.filter((r) => String(r.order_date) >= "2026-09-01" && String(r.order_date) <= "2026-09-30") as unknown as MySettlementRow[];
  const m = computeMyntra({
    orders: orders.filter((o) => o.order_date >= "2026-09-01" && o.order_date <= "2026-09-30"), settlement: sepS,
    rates: settle as unknown as never, returns: of("my_returns").flatMap((r) => r.rows) as unknown as MyReturnRow[],
    invoices: inv as unknown as MyInvoiceRow[], skuOfId, products: [], settings: [],
    defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 }, from: "2026-09-01", to: "2026-09-30",
  });
  const t = m.totals;
  expect("Engine Sep: units sold", t.units, 46, 0);
  expect("Engine Sep: RTO", t.rtoUnits, 3, 0);
  expect("Engine Sep: cancelled before shipping", t.cancelled, 2, 0);
  expect("Engine Sep: customer returns", t.returnUnits, 1, 0);
  expect("Engine Sep: estimated lines", t.estimatedLines, 6, 0);
  expect("Engine Sep: sales excl GST", t.sales, 32149.58, 0.05);
  expect("Engine Sep: revenue excl GST", t.revenue, 27286.38, 0.05);
  expect("Engine Sep: fees excl GST", t.fees, 1301.68, 0.05);
  expect("Engine Sep: paid", m.status.settled.amount, 13204.52, 0.05);
  expect("Engine Sep: ads (Aug invoice not in Sep)", t.ads, 0, 0);
  console.log(`      Myntra margin ₹${t.myntraMargin.toFixed(0)} (${((t.myntraMargin / t.sales) * 100).toFixed(1)}% of sales); profit ₹${t.profit.toFixed(0)} (${(t.margin * 100).toFixed(1)}%)`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll Myntra checks passed");
  process.exit(failures ? 1 : 0);
}
main();

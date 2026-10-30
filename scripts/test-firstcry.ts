// FirstCry parsers vs totals calculated independently (Python/openpyxl) from Root and Soil's files of 30 Oct 2026.
// Put the files in test-data/firstcry/. Run: npx tsx scripts/test-firstcry.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";
import { computeFirstCry, type FcReconRow, type FcSaleRow } from "../src/lib/engine/firstcry";

const DIR = join(process.cwd(), "test-data", "firstcry");
type Ok = Extract<ParseResult, { ok: true }>;
let failures = 0;
function expect(label: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got.toFixed(2)} (expected ${want.toFixed(2)})`);
}
const sum = (rows: Ok["rows"], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

async function main() {
  const res: Ok[] = [];
  for (const f of readdirSync(DIR).sort()) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join(DIR, f))))) {
    if (!r.ok) { failures++; console.log(`FAIL  not recognised: ${r.fileName}: ${r.reason}`); continue; }
    res.push(r);
    console.log(`read  ${r.type.padEnd(12)} ${String(r.rows.length || r.products.length).padStart(5)}  ${r.periodStart ?? ""}→${r.periodEnd ?? ""}  ${r.fileName}`);
  }
  const of = (t: string) => res.filter((r) => r.type === t);

  const sales = of("fc_sales")[0];
  expect("Sales: lines", sales.rows.length, 2574, 0);
  expect("Sales: unique keys", new Set(sales.rows.map((r) => r.row_key)).size, 2574, 0);
  expect("Sales: units", sum(sales.rows, "quantity"), 2741, 0);
  expect("Sales: MRP sales", sum(sales.rows, "mrp_sales"), 2577178, 0);
  console.log(`      period ${sales.periodStart} → ${sales.periodEnd} (expected 2026-08-31 → 2026-10-30)`);
  if (sales.periodStart !== "2026-08-31" || sales.periodEnd !== "2026-10-30") failures++;

  // Twelve overlapping reconciliation downloads: keyed rows must collapse to the same units as the Python dedupe.
  const recon = new Map<string, Ok["rows"][number]>();
  // Same merge as the save layer: a later file never blanks what an earlier one recorded.
  const KEEP = ["vendor_invoice", "payment_advice", "debit_note", "ship_date", "delivery_date", "return_date"];
  const KEEPN = ["sr_qty", "sr_total", "sr_gross", "rto_qty", "rto_total", "rto_gross"];
  for (const r of of("fc_recon")) for (const row of r.rows) {
    const old = recon.get(String(row.row_key));
    if (old) { for (const k of KEEP) if (row[k] == null && old[k] != null) row[k] = old[k]; for (const k of KEEPN) if (!Number(row[k]) && Number(old[k])) row[k] = old[k]; }
    recon.set(String(row.row_key), row);
  }
  const rows = [...recon.values()];
  expect("Recon files", of("fc_recon").length, 12, 0);
  expect("Recon: units after dedupe", rows.length, 2751, 0);
  expect("Recon: base cost", sum(rows, "gross_amount"), 1452443.25, 0.05);
  expect("Recon: total incl GST", sum(rows, "total"), 1568941.96, 0.05);
  expect("Recon: RTO units", sum(rows, "rto_qty"), 144, 0);
  expect("Recon: RTO amount", sum(rows, "rto_total"), 87796.73, 0.05);
  expect("Recon: customer returns", sum(rows, "sr_qty"), 5, 0);
  expect("Recon: GST", sum(rows, "gst_amount"), 116498.71, 0.05);

  const ret = of("fc_returns")[0];
  expect("Returns: rows", ret.rows.length, 3, 0);
  const prod = of("fc_products")[0];
  expect("Products", prod.products.length, 47, 0);
  expect("Products with GST 5%", prod.products.filter((p) => p.gst_rate === 5).length, 11, 0);
  expect("Products without style code", prod.products.filter((p) => !p.style_code).length, 5, 0);

  // Engine: whole period, default cost 25% of MRP. Expected values from Python on the same files.
  const reconRows = rows as unknown as FcReconRow[];
  const res2 = computeFirstCry({
    sales: sales.rows as unknown as FcSaleRow[], recon: reconRows,
    rates: reconRows.map((r) => ({ product_id: r.product_id, order_date: r.order_date, base_cost: r.base_cost, mrp: r.mrp, gst_rate: r.gst_rate })),
    products: prod.products.map((p) => ({ asin: p.asin, title: p.title, short_name: "", mrp: p.mrp, gst_rate: p.gst_rate ?? null })),
    settings: [], defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 },
  });
  const t = res2.totals;
  expect("Engine: actual revenue", t.revenueActual, 1367414.43, 0.05);
  expect("Engine: estimated units", t.estimatedUnits, 7, 0);
  expect("Engine: estimated revenue", t.revenueEstimated, 2729.27, 0.05);
  expect("Engine: units", t.units, 2758, 0);
  expect("Engine: RTO units", t.rtoUnits, 144, 0);
  expect("Engine: product cost", t.productCost, 612276, 0.05);
  expect("Engine: paid (incl GST)", res2.status.paid.amount, 1186677.65, 0.05);
  expect("Engine: typical payout rate", res2.typicalRate ?? 0, 0.6175, 0.00005);
  expect("Engine: payout shortfall (units kept)", t.shortfall, 26635.86, 1);
  console.log(`      shortfall ₹${t.shortfall.toFixed(0)} on ${res2.rows.filter((r) => r.shortfall > 0).length} products; profit ₹${t.profit.toFixed(0)} (${(t.margin * 100).toFixed(1)}%)`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll FirstCry parser checks passed");
  process.exit(failures ? 1 : 0);
}
main();

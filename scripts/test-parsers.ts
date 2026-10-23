// Parses every file in ./test-data and checks totals against figures calculated independently
// (Python/pandas) from the same Root and Soil files on 23 Oct 2026. Run: npm run test:parsers
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";

const DIR = join(process.cwd(), "test-data");
const REPORT_DATE = "2026-10-22";

type Ok = Extract<ParseResult, { ok: true }>;
const sum = (rows: Ok["rows"], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
let failures = 0;
function expect(label: string, got: number, want: number, tol = 0.6) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got.toFixed(2)} (expected ${want.toFixed(2)})`);
}

async function main() {
  const results: Ok[] = [];
  for (const f of readdirSync(DIR).sort()) {
    const res = await parseUpload(f, new Uint8Array(readFileSync(join(DIR, f))), REPORT_DATE);
    for (const r of res) {
      if (!r.ok) { console.log(`skip  ${r.fileName}: ${r.reason}`); continue; }
      results.push(r);
      const w = r.warnings.length ? `  ⚠ ${r.warnings.join(" ")}` : "";
      console.log(`read  ${r.type.padEnd(21)} ${String(r.rows.length).padStart(5)} rows  ${r.periodStart ?? ""}→${r.periodEnd ?? ""}  ${r.fileName}${w}`);
    }
  }
  const by = (t: string) => results.filter((r) => r.type === t);
  const one = (t: string) => { const x = by(t); if (x.length !== 1) { failures++; console.log(`FAIL  expected 1 ${t}, got ${x.length}`); } return x[0]; };

  console.log("\n--- Checks ---");
  const u = one("unified_transactions");
  expect("Unified: rows", u.rows.length, 5845, 0);
  expect("Unified: unique row hashes", new Set(u.rows.map((r) => r.row_hash)).size, 5845, 0);
  const ord = u.rows.filter((r) => r.type === "Order");
  expect("Unified: order product sales", sum(ord, "product_sales"), 3572815.0, 1);
  expect("Unified: grand total", sum(u.rows, "total"), 23147.0, 1);
  const ads = u.rows.filter((r) => r.type === "Service Fee" && r.description === "Cost of Advertising");
  expect("Unified: cost of advertising (incl GST)", -sum(ads, "total"), 237756.2, 0.5);

  const o = one("orders");
  expect("Orders: lines", o.rows.length, 220, 0);
  expect("Orders: units", sum(o.rows, "quantity"), 217, 0);

  const sp = by("sp_advertised").find((r) => r.periodStart === "2026-10-01")!;
  expect("SP 1–22 Oct: spend", sum(sp.rows, "spend"), 178137.04, 0.05);
  const sd = by("sd_advertised").find((r) => r.periodStart === "2026-10-01")!;
  expect("SD 1–22 Oct: spend", sum(sd.rows, "spend"), 4304.66, 0.05);
  const sb = one("sb_keyword");
  expect("SB keyword 22 Oct: spend", sum(sb.rows, "spend"), 718.57, 0.05);
  const sbp = one("sb_purchases");
  expect("SB purchases: sales", sum(sbp.rows, "sales"), 384124.5, 0.05);

  const inv = one("fba_inventory");
  expect("FBA inventory: SKUs", inv.rows.length, 42, 0);
  const lst = one("listings");
  expect("Listings: SKUs", lst.rows.length, 125, 0);
  const tr = one("business_child");
  expect("Business report: units", sum(tr.rows, "units_ordered"), 218, 0);
  const ret = one("returns");
  expect("Returns: units", sum(ret.rows, "quantity"), 155, 0);

  const b2c = one("mtr_b2c");
  expect("MTR B2C: rows", b2c.rows.length, 7022, 0);
  expect("MTR B2C: taxable value", sum(b2c.rows, "taxable_value"), 3863034.21, 0.5);
  expect("MTR B2C: total tax", sum(b2c.rows, "total_tax"), 275297.38, 0.5);
  const b2b = one("mtr_b2b");
  expect("MTR B2B: taxable value", sum(b2b.rows, "taxable_value"), 54617.14, 0.5);
  const st = one("stock_transfer");
  expect("Stock transfer: taxable value", sum(st.rows, "taxable_value"), 2746556.82, 0.5);
  const tcs = sum(b2c.rows, "tcs") + sum(b2b.rows, "tcs");
  expect("MTR: TCS", tcs, 19418, 1);

  const docs = by("tax_document");
  expect("Tax documents read", docs.length, 18, 0);
  expect("Tax documents with no warnings", docs.filter((d) => d.warnings.length === 0).length, 18, 0);
  expect("Tax documents: total GST", docs.reduce((s, d) => s + sum(d.rows, "gst"), 0), 150021.2, 0.05);
  const ads2 = docs.find((d) => d.rows[0]?.number === "ADS-2627-456821");
  expect("Ads invoice: fees", Number(ads2?.rows[0]?.fees ?? 0), 275984.6, 0.01);
  for (const d of docs) {
    const r = d.rows[0];
    console.log(`      ${String(r.number).padEnd(18)} ${String(r.doc_type).padEnd(11)} ${String(r.category).padEnd(14)} ${r.seller_gstin} ${Number(r.total).toFixed(2).padStart(11)}  [${(r.items as string[]).join(", ")}]`);
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}
main();

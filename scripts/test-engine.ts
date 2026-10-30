// Runs the profit engine on ./test-data and compares with the Root and Soil workbook (1–22 Oct 2026).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";
import { computeProfit } from "../src/lib/engine/profit";
import { computeStock } from "../src/lib/engine/stock";
import type { AdRow, InventoryRow, ListingRow, SbPurchaseRow, TxnRow } from "../src/lib/engine/types";

type Ok = Extract<ParseResult, { ok: true }>;
async function main() {
  const dir = join(process.cwd(), "test-data");
  const all: Ok[] = [];
  for (const f of readdirSync(dir).filter((x) => statSync(join(dir, x)).isFile())) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join(dir, f))), "2026-10-22")) if (r.ok) all.push(r);
  const u = all.find((r) => r.type === "unified_transactions")!;
  const txns = (u.rows as unknown as (TxnRow & { posted_at: string })[]).filter((t) => t.posted_date >= "2026-10-01" && t.posted_date <= "2026-10-22");
  const ads = all.filter((r) => (r.type === "sp_advertised" || r.type === "sd_advertised") && r.periodStart === "2026-10-01").flatMap((r) => r.rows) as unknown as AdRow[];
  const sb = all.find((r) => r.type === "sb_purchases")!.rows as unknown as SbPurchaseRow[];
  const skus = all.flatMap((r) => r.skus);
  const products = all.flatMap((r) => r.products).map((p) => ({ ...p, short_name: "" }));
  const res = computeProfit({ txns, ads, sbPurchases: sb, skus, products, settings: [], defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 } });
  const t = res.totals;
  console.log({ products: res.rows.length, units: t.units, netSales: t.netSales.toFixed(2), fees: t.fees.toFixed(2), ads: t.ads.toFixed(2), reimb: t.reimbursements.toFixed(2), cost: t.productCost.toFixed(2), profit: t.profit.toFixed(2), margin: t.margin.toFixed(4) });
  console.log("account level", res.accountLevel, res.accountLevelTotal.toFixed(2));
  let fail = 0;
  const expect = (l: string, got: number, want: number, tol: number) => { const ok = Math.abs(got - want) <= tol; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${l}: ${got.toFixed(2)} (workbook ${want.toFixed(2)})`); };
  expect("Net units", t.units, 4823, 0);
  expect("Net sales", t.netSales, 3368273.51, 0.5);
  expect("Ad spend", t.ads, 201488.29, 0.5);
  expect("Amazon fees (±0.05%)", t.fees, 561422.72, 300);
  expect("Profit before account-level (±0.05%)", t.profit, 1714157.40, 900);
  // Stock plan
  const units = new Map<string, number>();
  const asinBySku = new Map(skus.map((s) => [s.sku, s.asin]));
  for (const x of txns) if (x.type === "Order") { const a = asinBySku.get(x.sku); if (a) units.set(a, (units.get(a) ?? 0) + x.quantity); }
  const inv = all.find((r) => r.type === "fba_inventory")!.rows as unknown as InventoryRow[];
  const lst = all.find((r) => r.type === "listings")!.rows as unknown as ListingRow[];
  const stock = computeStock({ unitsByAsin: units, periodDays: 22, inventory: inv, listings: lst, products, settings: [], defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 } });
  const alm = stock.find((r) => r.asin === "B09GWBGMR7")!;
  expect("Stock: almond oil units sold", alm.unitsSold, 1641, 0);
  expect("Stock: almond oil FBA stock", alm.fbaStock, 1128, 0);
  expect("Stock: almond oil inbound", alm.fbaInbound, 1200, 0);
  expect("Stock: almond oil to make", alm.toMake, Math.ceil(1641 / 22 * 82 - 2328), 0);
  console.log(stock.slice(0, 5).map((r) => `${r.asin} ${r.status} make ${r.toMake} days ${r.daysLeft?.toFixed(1)}`).join("\n"));
  console.log(fail ? `${fail} FAILED` : "All engine checks passed");
  process.exit(fail ? 1 : 0);
  console.log("after", res.profitAfterAccountLevel.toFixed(2), res.marginAfterAccountLevel.toFixed(4), res.ads);
}
main();

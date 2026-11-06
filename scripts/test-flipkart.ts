// Flipkart parsers and engine vs figures calculated independently (Python/pandas) from Root and Soil's Sep–Oct 2026 files.
// Put the files in test-data/flipkart/. Run: npx tsx scripts/test-flipkart.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";
import { computeFlipkart, fkAdsInPeriod, fkPayouts, type FkAdRow, type FkOrderRow, type FkOtherRow, type FkReturnRow, type FkSaleRow, type FkSettlementRow } from "../src/lib/engine/flipkart";

const DIR = join(process.cwd(), "test-data", "flipkart");
type Ok = Extract<ParseResult, { ok: true }>;
let failures = 0;
function expect(label: string, got: number, want: number, tol = 0.05) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got.toFixed(2)} (expected ${want.toFixed(2)})`);
}
const sum = (rows: Record<string, unknown>[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
const uniq = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

async function main() {
  const res: Ok[] = [];
  for (const f of readdirSync(DIR).sort()) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join(DIR, f))))) {
    if (!r.ok) { console.log(`skip  ${r.fileName.slice(0, 70)}: ${r.reason.slice(0, 80)}`); continue; }
    res.push(r);
    console.log(`read  ${r.type.padEnd(20)} ${String(r.rows.length).padStart(5)}  ${r.periodStart ?? ""}→${r.periodEnd ?? ""}  ${r.fileName.slice(0, 50)}`);
  }
  const of = (t: string) => res.filter((r) => r.type === t).flatMap((r) => r.rows);

  // Parsers vs the reports' own totals.
  const settle = uniq(of("fk_settlement"), (r) => String(r.row_key)) as unknown as FkSettlementRow[];
  expect("Settlement Sep: bank settlement value = Summary 'Orders'", sum(settle.filter((r) => String(r.payment_date) < "2026-10-01") as never, "settlement_value"), 417697.09, 0.05);
  expect("Settlement Oct: bank settlement value = Summary 'Orders'", sum(settle.filter((r) => String(r.payment_date) >= "2026-10-01") as never, "settlement_value"), 160588.556, 0.05);
  expect("Settlement Sep: marketplace fees = Summary", sum(settle.filter((r) => String(r.payment_date) < "2026-10-01") as never, "marketplace_fee"), -21295.67, 0.05);
  expect("Settlement Sep: refunds (returns reversal) = Summary", sum(settle.filter((r) => String(r.payment_date) < "2026-10-01") as never, "refund"), -59094, 0.05);
  const off = settle.filter((r) => Math.abs(r.sale_amount + r.offer_amount + r.my_share + r.addons + r.marketplace_fee + r.tcs + r.tds + r.gst_on_fees + r.offer_adjustment + r.protection_fund + r.refund - r.settlement_value) > 0.05);
  expect("Settlement: rows where the payout formula does not hold", off.length, 0, 0);
  const other = of("fk_settlement_other") as unknown as FkOtherRow[];
  // The Ads sheet's settlement value already includes GST on ads.
  expect("Settlement Sep: Ads sheet = Summary 'Ads Fees' + 'GST on Ads Fees'", sum(other.filter((r) => String(r.payment_date) < "2026-10-01") as never, "amount"), -67679.82 - 9361.25, 0.05);
  expect("Settlement Oct: Ads sheet = Summary 'Ads Fees' + 'GST on Ads Fees'", sum(other.filter((r) => String(r.payment_date) >= "2026-10-01") as never, "amount"), -62757.28 - 4116.99, 0.05);
  expect("Orders report rows (Sep 974 + Oct 550)", of("fk_orders").length, 1524, 0);
  expect("Returns report rows (Sep 105 + Oct 44)", of("fk_returns").length, 149, 0);
  expect("Sales report rows (1101 + 613)", of("fk_sales").length, 1714, 0);
  // GST fields of the Sales report (October events): totals as Flipkart reports them.
  const oct = of("fk_sales").filter((r) => String(r.invoice_date).startsWith("2026-10"));
  expect("Sales Oct: taxable value, net of returns and cancellations", sum(oct, "taxable_value"), 132380.25, 0.05);
  expect("Sales Oct: IGST + CGST + SGST", sum(oct, "igst") + sum(oct, "cgst") + sum(oct, "sgst"), 11379.85, 0.05);
  expect("Sales: rows with a buyer GSTIN (Flipkart writes NA for none)", of("fk_sales").filter((r) => r.buyer_gstin).length, 0, 0);
  expect("Sales: rows without the seller GSTIN", of("fk_sales").filter((r) => r.seller_gstin !== "33AALCR8246B1ZF").length, 0, 0);
  const inv = of("fk_invoice");
  expect("Invoices: Sep ads fee (invoice FKRKA27001370475)", sum(inv.filter((r) => r.number === "FKRKA27001370475"), "ads"), 45422.99, 0.01);
  expect("Invoices: Sep commission", sum(inv.filter((r) => r.number === "FKRKA27001370475"), "commission"), 14710.26, 0.01);
  expect("Invoices: Oct total", sum(inv.filter((r) => r.number === "FKRKA27001519712"), "total"), 25313.7, 0.01);
  expect("Credit note total (negative)", sum(inv.filter((r) => r.doc_type === "credit_note"), "total"), -239.9, 0.01);
  const ads = of("fk_ads_daily").concat(of("fk_ads_products")) as unknown as FkAdRow[];
  expect("Ads Oct by day = by product", sum(ads.filter((r) => r.grain === "day" && r.period_start.startsWith("2026-10")) as never, "spend"), sum(ads.filter((r) => r.grain === "range" && r.period_start.startsWith("2026-10")) as never, "spend"), 0.05);
  expect("Ads Sep product report spend", sum(ads.filter((r) => r.grain === "range" && r.period_start.startsWith("2026-09")) as never, "spend"), 44026.19, 0.05);

  const names = new Map<string, string>();
  const a = fkAdsInPeriod(ads, "2026-10-01", "2026-10-31", names)!;
  expect("Ads in Oct: spend", a.spend, 21562.2, 0.05);
  expect("Ads in Oct: split by product + unallocated = spend", a.byProduct.reduce((s, g) => s + g.spend, 0) + a.unallocated, a.spend, 0.05);
  const a2 = fkAdsInPeriod(ads, "2026-09-16", "2026-09-30", names)!;
  expect("Ads Sep 16–30: half of September's product report", a2.spend, 44026.19 * 15 / 30, 0.05);

  // Engine.
  const orders = of("fk_orders") as unknown as FkOrderRow[];
  const sales = of("fk_sales") as unknown as FkSaleRow[];
  const returns = of("fk_returns") as unknown as FkReturnRow[];
  for (const [from, to] of [["2026-09-01", "2026-09-30"], ["2026-10-01", "2026-10-31"]]) {
    const m = computeFlipkart({
      orders: orders.filter((o) => o.order_date >= from && o.order_date <= to), settlement: settle.filter((s) => s.order_date >= from && s.order_date <= to),
      rates: settle, sales, returns, ads, products: [], settings: [],
      defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 }, from, to,
    });
    const t = m.totals;
    console.log(`\n${from.slice(0, 7)}: orders ${t.orders} units ${t.units} returns ${t.returnUnits} rto ${t.rtoUnits} cancelled ${t.cancelled}`);
    console.log(`  sales ${t.sales.toFixed(0)} revenue ${t.revenue.toFixed(0)} offers ${t.offers.toFixed(0)} fees ${t.fees.toFixed(0)} cost ${t.productCost.toFixed(0)} ads ${t.ads.toFixed(0)} profit ${t.profit.toFixed(0)} (${(t.margin * 100).toFixed(1)}%)`);
    console.log(`  estimated lines ${t.estimatedLines} (${t.estimated.toFixed(0)}), fee rate ${(t.feeRate * 100).toFixed(2)}%, payout ${t.payout.toFixed(0)}`);
    console.log("  status", JSON.stringify(Object.fromEntries(Object.entries(m.status).map(([k, v]) => [k, `${v.lines} / ${v.amount.toFixed(0)}`]))));
    console.log("  fees", JSON.stringify(Object.fromEntries(Object.entries(m.fees).map(([k, v]) => [k, Math.round(v)]))));
    console.log("  top", m.rows.slice(0, 4).map((r) => `${r.sku} u${r.units} s${r.sales.toFixed(0)} p${r.profit.toFixed(0)} ads${r.ads.toFixed(0)}`).join(" | "));
    console.log("  reasons", m.reasons.slice(0, 6).map((r) => `${r.kind}:${r.reason}=${r.count}`).join(", "));
    (globalThis as Record<string, unknown>)[from.slice(0, 7)] = m;
  }
  const payouts = fkPayouts(settle.filter((s) => String(s.payment_date) >= "2026-10-01"), other.filter((o) => String(o.payment_date) >= "2026-10-01"));
  expect("Oct payouts: orders + deductions = Summary orders + ads sheet", payouts.reduce((s, p) => s + p.total, 0), 160588.556 + sum(other.filter((o) => String(o.payment_date) >= "2026-10-01") as never, "amount"), 0.05);
  console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}
main();

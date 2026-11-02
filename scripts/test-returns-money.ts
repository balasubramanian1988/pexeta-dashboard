// Returns in rupees and Amazon reimbursement checks, on Root and Soil's October transaction and returns files.
// Run: npx tsx scripts/test-returns-money.ts
import { readdirSync, readFileSync } from "node:fs";
import { parseUpload } from "../src/lib/parsers";
import { buildBrandWorkbook } from "../src/lib/report";
import { computeReturnsMoney, type AmzReturnRow, type FeeRow, type ReimbRow, type RefundRow } from "../src/lib/engine/returnsMoney";

let failures = 0;
function check(label: string, ok: boolean) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); }
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

async function main() {
  const txns: Record<string, string | number>[] = [];
  for (const f of readdirSync("test-data").filter((x) => /Transactions|Unified|transaction/i.test(x)))
    for (const r of await parseUpload(f, new Uint8Array(readFileSync(`test-data/${f}`)))) if (r.ok) txns.push(...(r.rows as Record<string, string | number>[]));
  const rets = (await parseUpload("FBA_Customer_Returns.csv", new Uint8Array(readFileSync("test-data/74b77982-FBA_Customer_Returns.csv"))))[0];
  if (!rets.ok) throw new Error("returns file");
  const N = (x: unknown) => Number(x) || 0;
  const refunds = txns.filter((t) => t.type === "Refund").map((t) => ({ ...t, posted_date: String(t.posted_date) })) as unknown as RefundRow[];
  const orderIds = new Set(refunds.map((r) => r.order_id));
  const orderFees = txns.filter((t) => t.type === "Order" && orderIds.has(String(t.order_id))) as unknown as FeeRow[];
  const reimb = txns.filter((t) => /reimburs/i.test(String(t.description))) as unknown as ReimbRow[];
  const amazonReturns = rets.rows as unknown as AmzReturnRow[];

  const res = computeReturnsMoney({
    refunds, orderFees, reimbursements: reimb, reimbursementsInPeriod: reimb, amazonReturns,
    costPerUnit: (_s, _a, price) => price * 0.25, nameOf: (a, s) => a || s, asOf: "2026-12-15", fc: null, myReverse: null,
  });
  const a = res.amazon!;
  // Independent sums straight from the rows.
  const wantRefunded = refunds.reduce((s, r) => s + Math.max(0, -(N(r.product_sales) + N(r.tax_liable) + N(r.shipping_credits) + N(r.gift_wrap_credits))), 0);
  const wantRecovered = reimb.reduce((s, r) => s + N(r.total), 0);
  console.log(`refunds ${a.refunds}, refunded ₹${a.refundedToCustomers.toFixed(0)}, fees kept ₹${a.feesKept.toFixed(0)}, stock lost ₹${a.stockLost.toFixed(0)} (${a.stockLostUnits} units), recovered ₹${a.recovered.toFixed(0)}, claim now ₹${a.claimable.toFixed(0)}, pending ₹${a.pending.toFixed(0)}, claims ${a.claims.length}`);
  check("All 244 refunds counted", a.refunds === 244);
  check("Refunded to customers matches the rows", near(a.refundedToCustomers, wantRefunded));
  check("Recovered = every reimbursement row", near(a.recovered, wantRecovered) && wantRecovered > 0);
  check("No claim for an order Amazon already reimbursed", a.claims.every((c) => !reimb.some((r) => r.order_id === c.order_id && N(r.total) > 0)));
  check("Not-returned claims only for FBA orders", a.claims.filter((c) => c.kind === "not_returned").every((c) => refunds.find((r) => r.order_id === c.order_id)?.fulfillment === "AFN"));
  check("Not-returned claims only for refunds with no return record", a.claims.filter((c) => c.kind === "not_returned").every((c) => !amazonReturns.some((r) => r.order_id === c.order_id)));
  check("With asOf 15 Dec, October refunds are past the 45-day wait", a.claims.filter((c) => c.kind === "not_returned" && c.refundDate <= "2026-10-31").every((c) => c.status === "claim_now"));
  const early = computeReturnsMoney({ refunds, orderFees, reimbursements: reimb, reimbursementsInPeriod: reimb, amazonReturns, costPerUnit: () => 0, nameOf: (x) => x, asOf: "2026-10-31", fc: null, myReverse: null }).amazon!;
  check("With asOf 31 Oct, the same claims are still waiting", early.claims.filter((c) => c.kind === "not_returned").every((c) => c.status === "wait"));
  const wb = buildBrandWorkbook({ clientName: "Root and Soil", period: { from: "2026-10-01", to: "2026-10-31" }, prevFrom: "2026-08-31", prevTo: "2026-09-30", markets: [], extra: [], money: res, today: "2026-11-02" });
  check("Excel: Returns sheet with claims", !!wb.getWorksheet("Returns"));
  if (process.argv[2]) await wb.xlsx.writeFile(process.argv[2]);
  console.log("Top claims:"); for (const c of a.claims.slice(0, 5)) console.log(`  ${c.kind} ${c.order_id} ${c.sku} ₹${c.value.toFixed(0)} ${c.status}: ${c.detail}`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll returns-money checks passed");
  process.exit(failures ? 1 : 0);
}
main();

// Inventory Ledger (detailed) + Reimbursements readers and warehouse claims, on Root and Soil's 90-day files.
// Run: npx tsx scripts/test-fba-claims.ts
import { readFileSync } from "node:fs";
import { parseUpload } from "../src/lib/parsers";
import { buildBrandWorkbook } from "../src/lib/report";
import { computeWarehouseClaims, type LedgerRow, type ReimbursementRow } from "../src/lib/engine/warehouseClaims";

let failures = 0;
function check(label: string, ok: boolean) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); }
const load = async (f: string) => parseUpload(f.split("/").pop()!, new Uint8Array(readFileSync(f)));

async function main() {
  const [led] = await load("test-data/amazon-fba/inventory-ledger-detailed.csv");
  const [sum] = await load("test-data/amazon-fba/inventory-ledger-summary.csv");
  const [rei] = await load("test-data/amazon-fba/reimbursements.csv");
  check("Detailed ledger recognised", led.ok && led.type === "inv_ledger");
  check("Summary ledger politely refused", !sum.ok && /Detailed view/.test(sum.reason));
  check("Reimbursements recognised", rei.ok && rei.type === "reimbursements");
  if (!led.ok || !rei.ok) process.exit(1);
  // Counted in Python: 211 adjustments + 238 receipts + 561 customer returns + 30 vendor returns.
  check(`Ledger keeps 1,040 claim-relevant events (${led.rows.length})`, led.rows.length === 1040);
  check("Ledger keys are unique", new Set(led.rows.map((r) => r.row_key)).size === led.rows.length);
  check(`Reimbursements: 185 rows (${rei.rows.length})`, rei.rows.length === 185);
  check("Reimbursement total ₹86,044", Math.round(rei.rows.reduce((s, r) => s + Number(r.amount_total), 0)) === 86044);
  const ledger = led.rows as unknown as LedgerRow[], reimb = rei.rows as unknown as ReimbursementRow[];
  const res = computeWarehouseClaims({ ledger, reimbursements: reimb, from: "2026-08-01", to: "2026-11-02", asOf: "2026-11-02", sellingPrice: () => 1000, nameOf: (a, s) => s || a });
  const lost = res.claims.filter((c) => c.kind === "lost");
  check(`Lost units unreconciled = 20 (${res.lostUnits})`, res.lostUnits === 20);
  check("Lost before 3 Oct are 'claim now', later ones 'wait'", lost.every((c) => (c.date <= "2026-10-03") === (c.status === "claim_now")));
  check("Reimbursed by reason sums to the total", Math.round(res.reimbursedByReason.reduce((s, x) => s + x.amount, 0)) === Math.round(res.reimbursedTotal));
  check("Almond oil 100 ml valued at Amazon's own rate", lost.filter((c) => c.sku === "RAS_CPAOfb_100_FBA").every((c) => c.valueBasis === "amazon_rate"));
  // Excel: the Returns sheet lists the warehouse claims with a total that matches.
  const money = { amazon: null, firstcry: null, myntra: null, warehouse: res, total: { reversed: 0, lost: 0, recoverable: res.claimable + res.pending } };
  const wb = buildBrandWorkbook({ clientName: "Test", period: { from: "2026-08-01", to: "2026-11-02" }, prevFrom: "2026-05-01", prevTo: "2026-07-31", markets: [], extra: [], today: "2026-11-02", money });
  const ws = wb.getWorksheet("Returns");
  let total: unknown = null;
  ws?.eachRow((row) => { if (row.getCell(1).value === "Total") total = row.getCell(4).value; });
  const cached = (total as { result?: number } | null)?.result ?? 0;
  check(`Excel Returns sheet totals the warehouse claims (${Math.round(cached)})`, !!ws && Math.round(cached) === Math.round(res.claims.reduce((s, c) => s + c.value, 0)));
  console.log(`claim now ₹${res.claimable.toFixed(0)}, waiting ₹${res.pending.toFixed(0)}, to check ₹${res.toCheck.toFixed(0)}; lost ${res.lostUnits} units, damaged ${res.damagedUnits} units; paid ₹${res.reimbursedTotal.toFixed(0)}`);
  for (const c of res.claims.slice(0, 8)) console.log(`  [${c.status}] ${c.kind} ${c.sku} ×${c.units} @₹${c.unitValue.toFixed(0)} (${c.valueBasis}) ${c.detail}`);
  console.log(res.reimbursedByReason);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll FBA claims checks passed");
  process.exit(failures ? 1 : 0);
}
main();

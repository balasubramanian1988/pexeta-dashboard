// Returns themes and actions on Root and Soil's real October return files (Amazon, FirstCry, Myntra).
// Run: npx tsx scripts/test-returns.ts
import { readFileSync } from "node:fs";
import { parseUpload } from "../src/lib/parsers";
import { computeReturns, themeOf, type ReturnLine } from "../src/lib/engine/returns";
import { buildBrandWorkbook } from "../src/lib/report";

let failures = 0;
function check(label: string, ok: boolean) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); }

async function rows(path: string) {
  const r = (await parseUpload(path.split("/").pop()!, new Uint8Array(readFileSync(path))))[0];
  if (!r.ok) throw new Error(r.reason);
  return r.rows as Record<string, string | number>[];
}

async function main() {
  // Customer words win over the reason code where they are specific.
  check("seal opened → damaged", themeOf({ reason: "QUALITY_UNACCEPTABLE", detail: "", comment: "Seal was opened and all product cover is damaged" }) === "damaged");
  check("not genuine → quality", themeOf({ reason: "QUALITY_UNACCEPTABLE", detail: "", comment: "I didn't find the product genuine" }) === "quality");
  check("cheaper on prime day → price", themeOf({ reason: "FOUND_BETTER_PRICE", detail: "", comment: "The price is less during the Amazon prime day" }) === "price_or_mind");
  check("refused at door → refused", themeOf({ reason: "UNDELIVERABLE_REFUSED", detail: "SELLABLE", comment: "" }) === "refused");
  check("Myntra RTO → refused", themeOf({ reason: "RTO", detail: "RTO", comment: "" }) === "refused");
  check("FirstCry leakage → damaged", themeOf({ reason: "Damaged Item(s) Received", detail: "Leakage / Spillage", comment: "" }) === "damaged");

  const lines: ReturnLine[] = [];
  for (const r of await rows("test-data/74b77982-FBA_Customer_Returns.csv"))
    lines.push({ marketplace: "Amazon", date: String(r.return_date), product: String(r.asin), name: String(r.asin), quantity: Number(r.quantity) || 1, reason: String(r.reason), detail: String(r.disposition), comment: String(r.comments ?? "") });
  for (const r of await rows("test-data/firstcry/3ef5735a-SaleReturnData_1793356323.xlsx"))
    lines.push({ marketplace: "FirstCry", date: String(r.return_date), product: String(r.product_id), name: String(r.product_id), quantity: Number(r.quantity) || 1, reason: String(r.reason), detail: String(r.sub_reason), comment: "" });
  for (const r of await rows("test-data/myntra/67cdc025-dZZXXHhA_2026-10-30_MDirect_Returns_Report_34614_2026-10-01_2026-10-29.csv"))
    lines.push({ marketplace: "Myntra", date: String(r.rto_date || r.return_created_date), product: String(r.sku), name: String(r.sku), quantity: Number(r.quantity) || 1, reason: r.status === "RTO" ? "RTO" : String(r.return_reason), detail: String(r.status), comment: "" });

  const res = computeReturns(lines);
  const units = (t: string) => res.byTheme.find((x) => x.theme === t)?.units ?? 0;
  console.log(res.byTheme.map((t) => `${t.theme} ${t.units}`).join(", "), `total ${res.total}`);
  check("Amazon refused + undelivered = 138 units (104 + 32 + 1 + 1)", (res.byMarketplace.find((m) => m.marketplace === "Amazon")?.byTheme.refused ?? 0) === 138);
  check("Myntra: 12 RTO units counted as refused", (res.byMarketplace.find((m) => m.marketplace === "Myntra")?.byTheme.refused ?? 0) === 12);
  check("Damaged theme found", units("damaged") >= 5);
  check("Action: cut refused deliveries", res.actions.some((a) => a.title === "Cut refused deliveries"));
  check("Action: packaging check for almond milk lotion (B0DZ6JFH9F)", res.actions.some((a) => a.title.includes("packaging") && a.title.includes("B0DZ6JFH9F")));
  const wb = buildBrandWorkbook({ clientName: "Root and Soil", period: { from: "2026-10-01", to: "2026-10-31" }, prevFrom: "2026-08-31", prevTo: "2026-09-30", markets: [], extra: [], returns: res, today: "2026-11-02" });
  check("Excel: Returns sheet", !!wb.getWorksheet("Returns"));
  if (process.argv[2]) await wb.xlsx.writeFile(process.argv[2]);
  console.log("\nActions:"); for (const a of res.actions) console.log(`  [${a.owner}] ${a.title}\n      ${a.why}`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll returns checks passed");
  process.exit(failures ? 1 : 0);
}
main();

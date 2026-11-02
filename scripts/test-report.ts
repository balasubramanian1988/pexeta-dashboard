// Builds the All marketplaces Excel report from made-up numbers and checks the totals.
// Run: npx tsx scripts/test-report.ts [out.xlsx]
import { buildBrandWorkbook } from "../src/lib/report";
import type { MarketSummary } from "../src/lib/engine/brand";

const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
const mk = (marketplace: string, sales: number, fees: number, ads: number | null, cost: number, prev: number | null, products: MarketSummary["products"], notes: string[] = []): MarketSummary => {
  const profit = sales - fees - (ads ?? 0) - cost;
  return {
    accountId: marketplace, marketplace, supported: true, hasData: true, sales, units: Math.round(sales / 400), returnRate: 0.05,
    fees, ads, productCost: cost, profit, margin: profit / sales, prevSales: prev,
    daily: new Map(days.map((d, i) => [d, sales * [0.3, 0.3, 0.4][i]])), lossProducts: products.filter((p) => p.profit < 0).length, products, notes,
  };
};
const prod = (code: string, name: string, sales: number, fees: number, ads: number | null, cost: number) => {
  const profit = sales - fees - (ads ?? 0) - cost;
  return { code, name, units: Math.round(sales / 400), sales, fees, ads, productCost: cost, profit, margin: profit / sales };
};
const markets = [
  mk("Amazon", 100000, 30000, 12000, 25000, 90000, [prod("B0TEST1", "Almond oil 100 ml", 60000, 18000, 9000, 15000), prod("B0TEST2", "Hair oil 200 ml", 40000, 12000, 3000, 10000)]),
  mk("FirstCry", 50000, 19000, null, 12500, null, [prod("FC1", "Baby massage oil", 50000, 19000, null, 12500)], ["Sales at MRP excl. GST."]),
  mk("Myntra", 32150, 9000, 7628, 8000, null, [prod("MY1", "Almond oil 100 ml", 20000, 6000, 7009, 5000), prod("MY2", "Face wash", 12150, 3000, 619, 3000)]),
];
const wb = buildBrandWorkbook({ clientName: "Test Brand", period: { from: "2026-09-01", to: "2026-09-03" }, prevFrom: "2026-08-29", prevTo: "2026-08-31", markets, extra: [{ tone: "bad", title: "FirstCry paid about ₹1,000 less than its usual rate", detail: "On 2 product(s)." }], today: "2026-11-02" });
const names = wb.worksheets.map((w) => w.name);
let fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) fail++; };
check("four sheets", names.join(",") === "Summary,By marketplace,Products,Daily sales");
const bm = wb.getWorksheet("By marketplace")!;
const totRow = 5 + markets.length;
const totSales = (bm.getCell(totRow, 2).value as { result: number }).result;
check(`total sales ${totSales}`, totSales === 182150);
const totProfit = (bm.getCell(totRow, 11).value as { result: number }).result;
check(`total profit ${totProfit}`, Math.abs(totProfit - markets.reduce((s, m) => s + m.profit, 0)) < 0.01);
check("products rows", wb.getWorksheet("Products")!.getCell(9, 3).value === "Face wash");
const out = process.argv[2];
if (out) wb.xlsx.writeFile(out).then(() => console.log(`wrote ${out}`));
if (fail) process.exitCode = 1;

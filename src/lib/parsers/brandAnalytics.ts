// Amazon Brand Analytics downloads (Seller Central › Brands › Brand Analytics) → sd_ba_ tables. Pure functions.
//   Search Query Performance, brand view ("IN_Search_Query_Performance_Brand_View_Simple_Week_<date>.csv")
//   Search Catalogue Performance ("IN_Search_Catalogue_Performance_Simple_Week_<date>.csv")
//   Market Basket Analysis ("IN_Market_Basket_Analysis_Simple_Month_<date>.csv")
// Each file has one line of report settings above the header; "Reporting Date" is the last day of the week or month.
import type { Parsed } from "./map";
import type { Table } from "./read";
import { calendarDate, num, str, type Cell } from "./util";

function base(type: Parsed["type"], table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}

/** Week or month, from the file name Amazon gives the download ("…_Simple_Week_…", "…_Simple_Month_…"). */
const grainOf = (fileName: string) => (/_month_/i.test(fileName) ? "month" : /_quarter_/i.test(fileName) ? "quarter" : "week");
const end = (v: Cell) => calendarDate(v);
const nullable = (v: Cell) => (str(v) === "" ? null : num(v));

function span(p: Parsed, grain: string) {
  const ends = [...new Set(p.rows.map((r) => r.period_end as string))].sort();
  if (!ends.length) return;
  p.periodEnd = ends[ends.length - 1];
  const first = ends[0];
  if (grain === "week") { const d = new Date(`${first}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 6); p.periodStart = d.toISOString().slice(0, 10); }
  else p.periodStart = `${first.slice(0, 7)}-01`;
  if (grain !== "week") p.warnings.push(`This is a ${grain}ly download. The Search & listings tab uses weekly reports; upload the weekly version for trends.`);
}

export function baQueries(t: Table, fileName: string): Parsed {
  const p = base("ba_sqp", "sd_ba_queries");
  const grain = grainOf(fileName);
  for (const r of t.rows) {
    const query = str(r["Search Query"]).toLowerCase();
    const periodEnd = end(r["Reporting Date"]);
    if (!query || !periodEnd) continue;
    p.rows.push({
      grain, period_end: periodEnd, query,
      score: num(r["Search Query Score"]), volume: num(r["Search Query Volume"]),
      impr_total: num(r["Impressions: Total Count"]), impr_brand: num(r["Impressions: Brand Count"]),
      click_total: num(r["Clicks: Total Count"]), click_brand: num(r["Clicks: Brand Count"]),
      cart_total: num(r["Cart Adds: Total Count"]), cart_brand: num(r["Cart Adds: Brand Count"]),
      purch_total: num(r["Purchases: Total Count"]), purch_brand: num(r["Purchases: Brand Count"]),
      price_median: nullable(r["Purchases: Price (Median)"]), brand_price_median: nullable(r["Purchases: Brand Price (Median)"]),
    });
  }
  span(p, grain);
  return p;
}

export function baAsins(t: Table, fileName: string): Parsed {
  const p = base("ba_scp", "sd_ba_asins");
  const grain = grainOf(fileName);
  for (const r of t.rows) {
    const asin = str(r["ASIN"]);
    const periodEnd = end(r["Reporting Date"]);
    if (!asin || !periodEnd) continue;
    p.rows.push({
      grain, period_end: periodEnd, asin,
      impressions: num(r["Impressions: Impressions"]),
      impr_fast: num(r["Impressions: Same-Day Shipping Speed"]) + num(r["Impressions: 1D Shipping Speed"]),
      clicks: num(r["Clicks: Clicks"]), cart_adds: num(r["Cart Adds: Cart Adds"]),
      purchases: num(r["Purchases: Purchases"]),
      purch_fast: num(r["Purchases: Same-Day Shipping Speed"]) + num(r["Purchases: 1D Shipping Speed"]),
      sales: num(r["Purchases: Search Traffic Sales"]),
      price_median: nullable(r["Impressions: Price (Median)"]),
    });
    const title = str(r["ASIN Title"]);
    if (title) p.products.push({ asin, title });
  }
  span(p, grain);
  return p;
}

export function baBasket(t: Table, fileName: string): Parsed {
  const p = base("ba_basket", "sd_ba_basket");
  const grain = grainOf(fileName);
  for (const r of t.rows) {
    const asin = str(r["ASIN"]);
    const periodEnd = end(r["Reporting Date"]);
    if (!asin || !periodEnd) continue;
    const row: Record<string, string | number | null> = { grain, period_end: periodEnd, asin, orders: num(r["Number of Orders"]) };
    for (const i of [1, 2, 3]) {
      row[`with_asin_${i}`] = str(r[`#${i} Purchase Combination: ASIN`]);
      row[`with_title_${i}`] = str(r[`#${i} Purchase Combination: Product Title`]);
      row[`with_pct_${i}`] = num(r[`#${i} Purchase Combination: Combination %`]) / 100;
    }
    p.rows.push(row);
    const title = str(r["Product Title"]);
    if (title) p.products.push({ asin, title });
  }
  const ends = [...new Set(p.rows.map((r) => r.period_end as string))].sort();
  if (ends.length) { p.periodEnd = ends[ends.length - 1]; p.periodStart = `${ends[0].slice(0, 7)}-01`; }
  return p;
}

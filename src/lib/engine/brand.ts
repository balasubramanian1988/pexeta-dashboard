// One brand across its marketplaces: a common summary per marketplace and plain-language findings.
// Each marketplace's own engine does the maths; this only lines the results up so they compare fairly:
//   sales        = net sales excl. GST (Amazon: after refunds and promotions; FirstCry: MRP excl. GST of units kept,
//                  because FirstCry's files show no customer price)
//   fees         = what the marketplace keeps (Amazon fees excl. GST; FirstCry: sales − base cost paid; Flipkart: fees
//                  less the offers Flipkart funds, so it can be negative)
//   margin       = profit ÷ sales
/** One product on one marketplace, in the same terms as MarketSummary (sales excl. GST; fees = what the marketplace keeps). */
export type BrandProduct = {
  code: string; name: string; units: number;
  sales: number; fees: number; ads: number | null; productCost: number; profit: number; margin: number;
};

export type MarketSummary = {
  accountId: string; marketplace: string; supported: boolean; hasData: boolean;
  sales: number; units: number; returnRate: number | null;
  fees: number; ads: number | null;          // null = no ads data uploaded for this marketplace
  productCost: number; profit: number; margin: number;
  prevSales: number | null;                  // same-length period just before
  daily: Map<string, number>;                // sales by day
  lossProducts: number;
  products: BrandProduct[];
  notes: string[];
};

export type Finding = { tone: "good" | "bad"; title: string; detail: string };

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const lakh = (n: number) => (Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

export function brandTotals(rows: MarketSummary[]) {
  const live = rows.filter((r) => r.hasData);
  const sum = (f: (r: MarketSummary) => number) => live.reduce((s, r) => s + f(r), 0);
  const sales = sum((r) => r.sales), profit = sum((r) => r.profit);
  const prev = live.every((r) => r.prevSales != null) ? sum((r) => r.prevSales ?? 0) : null;
  return {
    sales, profit, margin: sales ? profit / sales : 0,
    fees: sum((r) => r.fees), ads: sum((r) => r.ads ?? 0), productCost: sum((r) => r.productCost), units: sum((r) => r.units),
    prevSales: prev, change: prev ? sales / prev - 1 : null,
    adsMissing: live.filter((r) => r.ads == null).map((r) => r.marketplace),
  };
}

/** Rule-based findings: what is working and what needs attention. Every statement comes from the numbers shown. */
export function findings(rows: MarketSummary[], extra: Finding[] = []): Finding[] {
  const live = rows.filter((r) => r.hasData && r.sales > 0);
  const out: Finding[] = [];
  const t = brandTotals(rows);
  if (live.length >= 2) {
    const byMargin = [...live].sort((a, b) => b.margin - a.margin);
    const best = byMargin[0], worst = byMargin[byMargin.length - 1];
    out.push({ tone: "good", title: `${best.marketplace} has the best margin: ${pct(best.margin)}`, detail: `${lakh(best.profit)} profit on ${lakh(best.sales)} sales${best.ads == null ? " (before ads: no ads data uploaded)" : ""}.` });
    const top = [...live].sort((a, b) => b.sales - a.sales)[0];
    if (top !== best) out.push({ tone: "good", title: `${top.marketplace} brings the most sales`, detail: `${pct(t.sales ? top.sales / t.sales : 0, 0)} of the brand's sales, at a ${pct(top.margin)} margin.` });
    if (worst !== best && worst.margin < best.margin - 0.1) out.push({ tone: "bad", title: `${worst.marketplace} has the lowest margin: ${pct(worst.margin)}`, detail: `Marketplace fees take ${pct(worst.sales ? worst.fees / worst.sales : 0)} of sales there${worst.ads ? ` and ads ${pct(worst.ads / worst.sales)}` : ""}.` });
  }
  for (const r of live) {
    if (r.prevSales && r.prevSales > 0) {
      const ch = r.sales / r.prevSales - 1;
      if (ch >= 0.15) out.push({ tone: "good", title: `${r.marketplace} sales up ${pct(ch, 0)}`, detail: `${lakh(r.sales)} against ${lakh(r.prevSales)} in the previous period of the same length.` });
      if (ch <= -0.15) out.push({ tone: "bad", title: `${r.marketplace} sales down ${pct(-ch, 0)}`, detail: `${lakh(r.sales)} against ${lakh(r.prevSales)} in the previous period of the same length.` });
    }
    if (r.profit < 0) out.push({ tone: "bad", title: `${r.marketplace} is losing money`, detail: `${lakh(r.profit)} after fees${r.ads != null ? ", ads" : ""} and product cost.` });
    if (r.lossProducts > 0) out.push({ tone: "bad", title: `${r.lossProducts} product${r.lossProducts > 1 ? "s lose" : " loses"} money on ${r.marketplace}`, detail: `See ${r.marketplace} › Profitability.` });
    if (r.returnRate != null && r.returnRate >= 0.08) out.push({ tone: "bad", title: `${pct(r.returnRate)} of ${r.marketplace} units come back`, detail: `Returned units earn nothing and cost shipping both ways.` });
  }
  if (t.adsMissing.length) out.push({ tone: "bad", title: `No ads data for ${t.adsMissing.join(", ")}`, detail: `Profit there is before ad spend, so it is overstated until the ads report is uploaded.` });
  return [...out, ...extra];
}

import { KpiRupees, Section } from "@/components/ui";
import { getMyntra } from "@/lib/data";
import { count, monthLabel, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";
import { MyHowItWorks } from "./Overview";

export default async function MyProfit({ account, period, team }: FcPageProps) {
  const { result, hasData } = await getMyntra(account, period.from, period.to);
  const t = result.totals;
  return (
    <>
      <FcHeader account={account} period={period} title="Profitability" slug="profit"
        sub={<>Profit = seller product amount − commission and shipping − product cost − ads. Product cost uses the seller&apos;s cost per unit, or a % of the customer price (default {percent(account.default_cost_pct, 0)}).</>} />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Myntra" /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
            <KpiRupees label="Net sales (excl. GST)" value={t.sales} />
            <KpiRupees label="Myntra margin" value={t.myntraMargin} sub="customer price − seller product amount" />
            <KpiRupees label="Commission and shipping" value={t.fees} />
            <KpiRupees label="Product cost" value={t.productCost} />
            <KpiRupees label="Ads" value={t.ads} />
            <KpiRupees label="Net profit" value={t.profit} signed sub={`${percent(t.margin)} of sales`} />
          </div>
          <MyHowItWorks />
          <Section title="By product" sub="Ads are split by product using the ads-by-style report linked to each ads invoice. Margin = profit ÷ net sales excluding GST, so it compares with other marketplaces.">
            <div className="max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Returns</th><th className="num">RTO</th><th className="num">Net sales</th><th className="num">Myntra margin</th><th className="num">Seller amount</th><th className="num">Commission + shipping</th><th className="num">Cost / unit</th><th className="num">Product cost</th><th className="num">Ads</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.sku}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.sku}</div></td>
                      <td className="num">{count(r.units)}</td><td className="num">{r.returnUnits || "–"}</td><td className="num">{r.rtoUnits || "–"}</td>
                      <td className="num">{rupees(r.sales)}</td><td className="num">{rupees(r.myntraMargin)}</td><td className="num">{rupees(r.revenue)}</td><td className="num">{rupees(r.fees)}</td>
                      <td className="num">{rupees(r.costPerUnit)}</td><td className="num">{rupees(r.productCost)}</td><td className="num">{r.ads ? rupees(r.ads) : "–"}</td>
                      <td className={`num font-semibold ${r.profit < 0 ? "text-red-700" : ""}`}>{rupees(r.profit)}</td><td className="num">{percent(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Ads" sub="Myntra bills ads monthly on a &quot;Marketing Claim&quot; invoice. Each month's bill is spread over its days, so a part-month period gets its share. Upload the ads-by-style report (&quot;Styles - Page 1.csv&quot;) for each invoice to split it by product.">
            {!result.ads.length ? <p className="px-4 py-6 text-sm text-muted">No ads invoices uploaded.</p> : (
              <table className="tbl">
                <thead><tr><th>Invoice</th><th>For</th><th>Campaign</th><th className="num">Amount excl. GST</th><th className="num">In this period</th><th>Split by product</th></tr></thead>
                <tbody>{result.ads.map((a) => <tr key={a.number}><td className="font-mono text-xs">{a.number}</td><td>{monthLabel(a.month.slice(0, 7))}</td><td className="text-xs text-muted">{a.description}</td><td className="num">{rupees(a.base, 2)}</td><td className="num">{rupees(a.inPeriod)}</td><td className="text-xs">{a.report ? "Yes" : <span className="text-amber-800">No matching ads-by-style report</span>}</td></tr>)}</tbody>
              </table>
            )}
            {result.unmatchedAdReports.map((u) => <p key={u.reportKey} className="border-t border-line px-4 py-2.5 text-xs text-amber-800">An ads-by-style report with ₹{u.total.toLocaleString("en-IN")} total spend ({u.styles} styles) matches no ads invoice yet. It may be for a month Myntra has not invoiced.</p>)}
          </Section>
          {result.adStyles.length > 0 && (
            <Section title="Ads by product" sub="This period's ads, split by each style's spend. ROAS = ad-attributed revenue (incl. GST) ÷ ad spend, from Myntra's ads report.">
              <table className="tbl">
                <thead><tr><th>Style</th><th className="num">Ad spend</th><th className="num">Units from ads</th><th className="num">Ad revenue</th><th className="num">ROAS</th></tr></thead>
                <tbody>{result.adStyles.map((x) => <tr key={x.styleId}><td>{x.name}<div className="text-[11px] text-faint">{x.sku || "SKU not linked"} · style {x.styleId}</div></td><td className="num">{rupees(x.inPeriod)}</td><td className="num">{x.units.toFixed(1)}</td><td className="num">{rupees(x.revenue)}</td><td className={`num font-semibold ${x.roas < 1 ? "text-red-700" : ""}`}>{x.roas.toFixed(2)}</td></tr>)}</tbody>
              </table>
            </Section>
          )}
        </>
      )}
    </>
  );
}

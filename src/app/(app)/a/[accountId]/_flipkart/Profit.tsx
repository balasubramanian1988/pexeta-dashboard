import { KpiRupees, Section } from "@/components/ui";
import { getFlipkart } from "@/lib/data";
import { FEE_KEYS, FEE_LABEL } from "@/lib/engine/flipkart";
import { count, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";
import { FkHowItWorks } from "./Overview";

export default async function FkProfit({ account, period, team }: FcPageProps) {
  const { result, hasData } = await getFlipkart(account, period.from, period.to);
  const t = result.totals;
  const feeTotal = FEE_KEYS.reduce((s, k) => s + result.fees[k], 0);
  return (
    <>
      <FcHeader account={account} period={period} title="Profitability" slug="profit"
        sub={<>Profit = what you earn (incl. Flipkart-funded offers, excl. GST) − Flipkart fees − product cost − ads. Product cost uses the seller&apos;s cost per unit, or a % of the customer price (default {percent(account.default_cost_pct, 0)}).</>} />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Flipkart" /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-6">
            <KpiRupees label="Net sales (excl. GST)" value={t.sales} />
            <KpiRupees label="Flipkart-funded offers" value={t.offers} sub="earned on top of sales" />
            <KpiRupees label="Flipkart fees" value={t.fees} />
            <KpiRupees label="Product cost" value={t.productCost} />
            <KpiRupees label="Ads" value={t.ads} />
            <KpiRupees label="Net profit" value={t.profit} signed sub={`${percent(t.margin)} of sales`} />
          </div>
          <FkHowItWorks />
          <Section title="By product" sub="Ads are split by product using the Flipkart Ads product report for the same days. Margin = profit ÷ net sales excluding GST, so it compares with other marketplaces.">
            <div className="max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Returns</th><th className="num">RTO</th><th className="num">Net sales</th><th className="num">Offers</th><th className="num">You earn</th><th className="num">Fees</th><th className="num">Cost / unit</th><th className="num">Product cost</th><th className="num">Ads</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.sku}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.sku}{r.estimated ? " · partly estimated" : ""}</div></td>
                      <td className="num">{count(r.units)}</td><td className="num">{r.returnUnits || "–"}</td><td className="num">{r.rtoUnits || "–"}</td>
                      <td className="num">{rupees(r.sales)}</td><td className="num">{rupees(r.offers)}</td><td className="num">{rupees(r.revenue)}</td><td className="num">{rupees(r.fees)}</td>
                      <td className="num">{rupees(r.costPerUnit)}</td><td className="num">{rupees(r.productCost)}</td><td className="num">{r.ads ? rupees(r.ads) : "–"}</td>
                      <td className={`num font-semibold ${r.profit < 0 ? "text-red-700" : ""}`}>{rupees(r.profit)}</td><td className="num">{percent(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Flipkart fees" sub="Settled orders placed in the period, excluding GST. Fees on orders not yet settled are estimated and not in this table.">
            {!feeTotal ? <p className="px-4 py-6 text-sm text-muted">No settled fees for these dates.</p> : (
              <table className="tbl">
                <thead><tr><th>Fee</th><th className="num">Amount</th><th className="num">Share of fees</th><th className="num">Of net sales</th></tr></thead>
                <tbody>{FEE_KEYS.filter((k) => result.fees[k]).map((k) => <tr key={k}><td>{FEE_LABEL[k]}</td><td className="num">{rupees(result.fees[k])}</td><td className="num">{percent(result.fees[k] / feeTotal)}</td><td className="num">{percent(t.sales ? result.fees[k] / t.sales : 0, 2)}</td></tr>)}</tbody>
              </table>
            )}
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Also deducted from payouts, and claimable as tax credits: TCS {rupees(t.tcs)}, TDS {rupees(t.tds)}, GST on fees {rupees(t.gstOnFees)}.</p>
          </Section>
        </>
      )}
    </>
  );
}

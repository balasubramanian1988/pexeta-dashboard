import { Kpi, KpiRupees, Section } from "@/components/ui";
import { getFirstCry } from "@/lib/data";
import { count, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, HowItWorks, type FcPageProps } from "./common";

export default async function FcProfit({ account, period, team }: FcPageProps) {
  const { result, hasSales, hasRecon } = await getFirstCry(account, period.from, period.to);
  const t = result.totals;
  return (
    <>
      <FcHeader account={account} period={period} title="Profitability" slug="profit"
        sub={<>Profit = revenue from FirstCry − product cost. Product cost uses the seller&apos;s cost per unit, or a % of MRP (default {percent(account.default_cost_pct, 0)}), on units not returned to origin.</>} />
      {!hasSales && !hasRecon ? <FcNoData accountId={account.id} team={team} /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiRupees label="Revenue (excl. GST)" value={t.revenue} sub={t.revenueEstimated ? `${rupees(t.revenueEstimated)} estimated` : undefined} />
            <KpiRupees label="Product cost" value={t.productCost} />
            <KpiRupees label="Net profit" value={t.profit} signed sub={`${percent(t.margin)} of sales at MRP excl. GST`} />
            <Kpi label="Units kept" value={count(t.units - t.rtoUnits)} sub={`${count(t.rtoUnits)} RTO · ${count(t.returnUnits)} customer returns`} />
            <KpiRupees label="Below usual payout" value={t.shortfall} sub={t.shortfall ? "see Payments" : "none"} />
          </div>
          <HowItWorks />
          <Section title="By product" sub="Sorted by revenue. Estimated = ordered but not yet in a Vendor Reconciliation file. Margin = profit ÷ sales at MRP excl. GST, so it compares with other marketplaces.">
            <div className="max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units</th><th className="num">RTO</th><th className="num">Returns</th><th className="num">Sales at MRP excl. GST</th><th className="num">Revenue</th><th className="num">of which estimated</th><th className="num">Payout rate</th><th className="num">Cost / unit</th><th className="num">Product cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.styleCode || "No style code"} · {r.id}</div></td>
                      <td className="num">{count(r.units)}</td>
                      <td className="num">{r.rtoUnits ? count(r.rtoUnits) : "–"}</td>
                      <td className="num">{r.returnUnits ? count(r.returnUnits) : "–"}</td>
                      <td className="num">{rupees(r.salesExGst)}</td>
                      <td className="num">{rupees(r.revenue)}</td>
                      <td className="num text-muted">{r.revenueEstimated ? rupees(r.revenueEstimated) : "–"}</td>
                      <td className={`num ${r.shortfall > 0 ? "font-semibold text-red-700" : ""}`}>{r.payoutRate != null ? percent(r.payoutRate, 2) : "–"}</td>
                      <td className="num">{rupees(r.costPerUnit)}</td>
                      <td className="num">{rupees(r.productCost)}</td>
                      <td className={`num font-semibold ${r.profit < 0 ? "text-red-700" : ""}`}>{rupees(r.profit)}</td>
                      <td className="num">{percent(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

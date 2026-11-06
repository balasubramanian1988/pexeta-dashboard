import Link from "next/link";
import { DailyBars, Kpi, KpiRupees, Section } from "@/components/ui";
import { getFlipkart, getFreshness } from "@/lib/data";
import { compactRupees, count, dateLabel, percent, rupees } from "@/lib/format";
import { FLIPKART_REPORTS, REPORT_LABEL } from "@/lib/parsers";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

export function FkHowItWorks() {
  return (
    <p className="mb-6 text-xs text-muted">
      On Flipkart the customer pays your selling price less any offer. You earn that amount plus the part of the offer Flipkart funds (
      <b>Flipkart-funded offers</b>), minus the part you fund. From it Flipkart deducts its fees (commission, fixed fee, shipping, return shipping), plus
      TCS, TDS and GST on the fees: tax credits you claim back, so not costs here. Returns take the sale back. Ads are Flipkart Ads spend, excluding GST.
      Orders not yet in a settlement report are estimated.
    </p>
  );
}

export default async function FkOverview({ account, period, team }: FcPageProps) {
  const [{ result, hasData }, fresh] = await Promise.all([getFlipkart(account, period.from, period.to), getFreshness(account.id)]);
  const t = result.totals;
  const base = `/a/${account.id}`, q = `?from=${period.from}&to=${period.to}`;
  const top = [...result.rows].sort((a, b) => b.profit - a.profit).slice(0, 6);
  const adsDaysMissing = result.ads ? result.ads.periodDays - result.ads.daysWithData : 0;
  return (
    <>
      <FcHeader account={account} period={period} title="Overview" slug="" />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Flipkart" /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiRupees label="Net sales (excl. GST)" value={t.sales} sub={`${count(t.units - t.returnUnits)} units after returns`} />
            <KpiRupees label="Net profit" value={t.profit} signed sub={`${percent(t.margin)} of sales`} />
            <KpiRupees label="Flipkart fees" value={t.fees} sub={`${percent(t.sales ? t.fees / t.sales : 0)} of sales`} />
            <KpiRupees label="Flipkart-funded offers" value={t.offers} sub="added to what you earn" />
            <KpiRupees label="Ads" value={t.ads} sub={result.ads ? `${percent(t.sales ? t.ads / t.sales : 0)} of sales` : "no Flipkart Ads report for these dates"} />
            <Kpi label="Not delivered (RTO)" value={percent(t.rtoRate)} sub={`${count(t.rtoUnits)} of ${count(t.shipped)} shipped`} tone={t.rtoRate > 0.1 ? "bad" : undefined} />
          </div>
          <FkHowItWorks />

          {(t.rtoRate > 0.1 || t.returnUnits > 0 || t.estimatedLines > 0 || !result.ads || adsDaysMissing > 0) && (
            <Section title="Needs attention">
              <ul className="divide-y divide-line text-sm">
                {t.rtoRate > 0.1 && <li className="px-4 py-3"><b>{percent(t.rtoRate, 0)} of shipped orders came back undelivered.</b> <span className="text-xs text-muted">RTOs earn nothing and tie up stock. See the reasons on Orders &amp; returns. <Link href={`${base}/revenue${q}`} className="font-semibold text-brand hover:underline">Details</Link></span></li>}
                {t.returnUnits > 0 && <li className="px-4 py-3"><b>{count(t.returnUnits)} customer return{t.returnUnits > 1 ? "s" : ""}.</b> <span className="text-xs text-muted">Each loses the sale and pays return shipping.</span></li>}
                {t.estimatedLines > 0 && <li className="px-4 py-3 text-xs text-muted">{count(t.estimatedLines)} orders are not in an uploaded settlement report yet, so their revenue and fees are estimated ({rupees(t.estimated)}){t.feeRate > 0 ? <>, using the recent fee rate of {percent(t.feeRate, 1)}</> : <>, with no fees: Flipkart charged none on the latest settled month&apos;s orders</>}.</li>}
                {!result.ads && <li className="px-4 py-3 text-xs text-muted">No Flipkart Ads report covers these dates, so profit is before ads. Upload the campaign-by-day report for the month.</li>}
                {result.ads && adsDaysMissing > 0 && <li className="px-4 py-3 text-xs text-muted">Flipkart Ads reports cover {count(result.ads.daysWithData)} of the {count(result.ads.periodDays)} days. Ads on the other days are not counted yet.</li>}
              </ul>
            </Section>
          )}

          <Section title="Net sales by day" sub="Customer invoice value excluding GST, by order date, after returns.">
            <DailyBars data={result.daily.map((d) => ({ date: d.date, value: d.sales }))} format={(n) => compactRupees(n)} label="Flipkart net sales by day" />
          </Section>

          <Section title="Most profitable products" sub="After ads, where a Flipkart Ads product report splits them by product." action={<Link href={`${base}/profit${q}`} className="text-xs font-semibold text-brand hover:underline">All products</Link>}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>{top.map((r) => <tr key={r.sku}><td>{r.name}<div className="text-[11px] text-faint">{r.sku}</div></td><td className="num">{count(r.units - r.returnUnits)}</td><td className="num">{rupees(r.sales)}</td><td className="num">{rupees(r.profit)}</td><td className="num">{percent(r.margin)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}
      <Section title="Data received from Flipkart" sub="The latest upload of each report.">
        <table className="tbl">
          <thead><tr><th>Report</th><th>Data up to</th><th>Uploaded</th></tr></thead>
          <tbody>{FLIPKART_REPORTS.map((k) => <tr key={k}><td>{REPORT_LABEL[k]}</td><td>{fresh[k] ? dateLabel(fresh[k].periodEnd) : <span className="text-faint">Not yet</span>}</td><td className="text-muted">{fresh[k] ? dateLabel(fresh[k].uploadedAt) : ""}</td></tr>)}</tbody>
        </table>
      </Section>
    </>
  );
}

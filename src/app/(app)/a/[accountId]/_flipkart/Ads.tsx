// Flipkart Ads tab: spend and return from Flipkart Ads reports, set against Flipkart sales and profit for the same dates.
import Link from "next/link";
import { DailyBars, Empty, Kpi, KpiRupees, Section } from "@/components/ui";
import { getFlipkart } from "@/lib/data";
import type { FkAdGroup } from "@/lib/engine/flipkart";
import { compactRupees, count, monthLabel, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

const ratio = (a: number, b: number) => (b ? a / b : NaN);

function AdTable({ rows, label, name }: { rows: FkAdGroup[]; label: string; name: (g: FkAdGroup) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{label}</th><th className="num">Spend</th><th className="num">Ad revenue</th><th className="num">ROAS</th><th className="num">ACoS</th><th className="num">Views</th><th className="num">Clicks</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">Units</th><th className="num">Conversion</th></tr></thead>
        <tbody>
          {rows.map((x) => {
            const roas = ratio(x.revenue, x.spend);
            return (
              <tr key={x.key}>
                <td className="min-w-48">{name(x)}</td>
                <td className="num">{rupees(x.spend)}</td>
                <td className="num">{rupees(x.revenue)}</td>
                <td className={`num ${Number.isFinite(roas) && roas < 3 ? "font-semibold text-red-700" : ""}`}>{Number.isFinite(roas) ? `${roas.toFixed(2)}×` : "–"}</td>
                <td className="num">{percent(ratio(x.spend, x.revenue))}</td>
                <td className="num">{count(x.views)}</td>
                <td className="num">{count(x.clicks)}</td>
                <td className="num">{percent(ratio(x.clicks, x.views), 2)}</td>
                <td className="num">{rupees(ratio(x.spend, x.clicks) || 0, 2)}</td>
                <td className="num">{count(x.units)}</td>
                <td className="num">{percent(ratio(x.units, x.clicks))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function FkAds({ account, period, team }: FcPageProps) {
  const { result, hasData } = await getFlipkart(account, period.from, period.to);
  const t = result.totals;
  const ads = result.ads;
  if (!ads) {
    return (
      <>
        <FcHeader account={account} period={period} title="Ads" slug="ads" sub="Spend excludes GST." />
        {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Flipkart" /> : (
          <div className="card">
            <Empty>
              No Flipkart Ads report for these dates yet.{" "}
              {team ? <Link className="font-semibold text-brand underline" href={`/a/${account.id}/uploads`}>Upload the campaign-by-day and product reports</Link> : "Pexeta uploads them regularly; check back soon."}
            </Empty>
          </div>
        )}
      </>
    );
  }
  const profitBeforeAds = t.profit + ads.spend;
  return (
    <>
      <FcHeader account={account} period={period} title="Ads" slug="ads"
        sub={<>Spend as in Flipkart Ads reports (excl. GST).{ads.spread ? " Days covered only by a product report for a date range get that range's daily average." : ""}</>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiRupees label="Ad spend" value={ads.spend} sub={ads.daysWithData < ads.periodDays ? `${ads.daysWithData} of ${ads.periodDays} days reported` : undefined} />
        <KpiRupees label="Ad revenue" value={ads.revenue} sub="As attributed by Flipkart" />
        <Kpi label="ROAS" value={Number.isFinite(ratio(ads.revenue, ads.spend)) ? `${ratio(ads.revenue, ads.spend).toFixed(2)}×` : "–"} sub="Ad revenue ÷ spend" />
        <Kpi label="ACoS" value={percent(ratio(ads.spend, ads.revenue))} sub="Spend ÷ ad revenue" />
        <Kpi label="TACoS" value={percent(ratio(ads.spend, t.sales))} sub="Spend ÷ all Flipkart net sales" />
        <Kpi label="CPC" value={rupees(ratio(ads.spend, ads.clicks) || 0, 2)} sub={`${count(ads.clicks)} clicks · CTR ${percent(ratio(ads.clicks, ads.views), 2)}`} />
        <KpiRupees label="Net profit after ads" value={t.profit} signed sub={`Before ads ${compactRupees(profitBeforeAds)}`} />
      </div>
      <p className="mb-6 text-xs text-muted">
        Flipkart&apos;s ad revenue is the value of orders it credits to ads (incl. GST), so ROAS and ACoS use it. TACoS compares spend with all Flipkart net sales for the same dates ({compactRupees(t.sales)}).
        ROAS below 3× is in red: after Flipkart&apos;s cut and product cost, ads at that level rarely pay for themselves.
      </p>
      {/* A month known only from a product report for the whole month is flat: no point charting it. */}
      {ads.daily.length > 1 && new Set(ads.daily.map((d) => d.value.toFixed(2))).size > 1 && (
        <Section title="Spend by day">
          <DailyBars data={ads.daily} format={(n) => compactRupees(n)} label="Flipkart ad spend by day" />
        </Section>
      )}
      <Section title="By month" sub="The part of each month inside the chosen dates.">
        <AdTable rows={ads.byMonth} label="Month" name={(g) => monthLabel(`${g.key}-01`)} />
      </Section>
      {ads.byCampaign.length > 0 && (
        <Section title="By campaign">
          <AdTable rows={ads.byCampaign} label="Campaign" name={(g) => <>{g.name}<div className="text-[11px] text-faint">{g.key}</div></>} />
        </Section>
      )}
      {ads.byProduct.length > 0 ? (
        <Section title="By product" sub="Each day's spend split by the Flipkart Ads product report covering it.">
          <AdTable rows={ads.byProduct} label="Product" name={(g) => <>{g.name}<div className="text-[11px] text-faint">{g.key}</div></>} />
          {ads.unallocated > 1 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{rupees(ads.unallocated)} of spend is not split by product: days with no product report, or spend Flipkart shows without a SKU.</p>}
        </Section>
      ) : (
        <p className="text-xs text-muted">No Flipkart Ads product report covers these dates, so spend can&apos;t be split by product. Upload the product report (Flipkart Ads › Reports, by product) for the month.</p>
      )}
    </>
  );
}

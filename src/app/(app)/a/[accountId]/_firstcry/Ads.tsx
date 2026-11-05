// FirstCry Ads tab: spend and return from FirstCry's Product Ads performance report,
// set against FirstCry sales and profit for the same dates.
import Link from "next/link";
import { DailyBars, Empty, Kpi, KpiRupees, Section } from "@/components/ui";
import { getFirstCry } from "@/lib/data";
import type { FcAdGroup } from "@/lib/engine/firstcry";
import { compactRupees, count, monthLabel, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "./common";

const ratio = (a: number, b: number) => (b ? a / b : NaN);

function AdTable({ rows, label, name }: { rows: FcAdGroup[]; label: string; name: (k: string) => string }) {
  return (
    <table className="tbl">
      <thead><tr><th>{label}</th><th className="num">Spend</th><th className="num">Ad sales (MRP)</th><th className="num">ROAS</th><th className="num">ACoS</th><th className="num">Impressions</th><th className="num">Clicks</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">Orders</th><th className="num">Conversion</th></tr></thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key}>
            <td>{name(x.key)}</td>
            <td className="num">{rupees(x.spend)}</td>
            <td className="num">{rupees(x.adSales)}</td>
            <td className="num">{Number.isFinite(ratio(x.adSales, x.spend)) ? `${ratio(x.adSales, x.spend).toFixed(2)}×` : "–"}</td>
            <td className="num">{percent(ratio(x.spend, x.adSales))}</td>
            <td className="num">{count(x.impressions)}</td>
            <td className="num">{count(x.clicks)}</td>
            <td className="num">{percent(ratio(x.clicks, x.impressions), 2)}</td>
            <td className="num">{rupees(ratio(x.spend, x.clicks) || 0, 2)}</td>
            <td className="num">{count(x.orders)}</td>
            <td className="num">{percent(ratio(x.orders, x.clicks))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function FcAds({ account, period, team }: FcPageProps) {
  const { result, ads, hasSales, hasRecon } = await getFirstCry(account, period.from, period.to);
  const t = result.totals;
  const names = new Map(result.rows.map((r) => [r.id, r.name]));

  if (!ads) {
    return (
      <>
        <FcHeader account={account} period={period} title="Ads" slug="ads" sub="Spend excludes GST." />
        {!hasSales && !hasRecon ? <FcNoData accountId={account.id} team={team} /> : (
          <div className="card">
            <Empty>
              No FirstCry Ads report for these dates yet.{" "}
              {team ? <Link className="font-semibold text-brand underline" href={`/a/${account.id}/uploads`}>Upload the Product Ads performance report</Link> : "Pexeta uploads it regularly; check back soon."}
            </Empty>
          </div>
        )}
      </>
    );
  }

  const profitAfterAds = t.profit - ads.spend;
  const daily = [...ads.daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));

  return (
    <>
      <FcHeader account={account} period={period} title="Ads" slug="ads"
        sub={<>Spend as in FirstCry&apos;s ads report (excl. GST).{ads.spread ? " Months with only a monthly total are spread evenly over their days." : ""}</>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiRupees label="Ad spend" value={ads.spend} />
        <KpiRupees label="Ad sales at MRP" value={ads.adSales} sub="As attributed by FirstCry" />
        <Kpi label="ROAS" value={ads.roas != null ? `${ads.roas.toFixed(2)}×` : "–"} sub="Ad sales ÷ spend" />
        <Kpi label="ACoS" value={percent(ratio(ads.spend, ads.adSales))} sub="Spend ÷ ad sales" />
        <Kpi label="TACoS" value={percent(ratio(ads.spend, t.mrpValue))} sub="Spend ÷ all FirstCry sales at MRP" />
        <Kpi label="CPC" value={rupees(ratio(ads.spend, ads.clicks) || 0, 2)} sub={`${count(ads.clicks)} clicks · CTR ${percent(ratio(ads.clicks, ads.impressions), 2)}`} />
        <KpiRupees label="Net profit after ads" value={profitAfterAds} signed sub={`Before ads ${compactRupees(t.profit)}`} />
      </div>
      <p className="mb-6 text-xs text-muted">
        FirstCry reports ad sales at MRP, so ROAS and ACoS are measured on MRP. TACoS compares spend with all FirstCry orders at MRP for the same dates ({compactRupees(t.mrpValue)}).
        Ad spend is a cost of selling: net profit after ads is the FirstCry profit for these dates ({compactRupees(t.profit)}) minus ad spend.
      </p>

      {daily.length > 1 && (
        <Section title="Spend by day" sub={ads.spread ? "Days from a monthly total show the month's average." : undefined}>
          <DailyBars data={daily} format={(n) => compactRupees(n)} label="FirstCry ad spend by day" />
        </Section>
      )}

      <Section title="By month" sub="The part of each month inside the chosen dates.">
        <AdTable rows={ads.byMonth} label="Month" name={(k) => monthLabel(`${k}-01`)} />
      </Section>

      {ads.byCampaign.length > 0 && (
        <Section title="By campaign">
          <AdTable rows={ads.byCampaign} label="Campaign" name={(k) => k} />
        </Section>
      )}

      {ads.byProductDetail.length > 0 ? (
        <Section title="By product">
          <AdTable rows={ads.byProductDetail} label="Product" name={(k) => names.get(k) ?? `FirstCry ${k}`} />
        </Section>
      ) : (
        <p className="text-xs text-muted">The report uploaded is a total for the account, so spend can&apos;t be split by product or campaign. A day-wise or product-wise download from FirstCry Ads would add those tables.</p>
      )}
    </>
  );
}

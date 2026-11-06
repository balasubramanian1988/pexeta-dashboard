import PeriodPicker from "@/components/PeriodPicker";
import { DailyBars, Kpi, KpiRupees, NoData, PageHeader, PeriodNote, Section } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getProfit } from "@/lib/data";
import { AD_TYPE_LABEL, aggregateAds, dailyAdSpend } from "@/lib/engine/summaries";
import { compactRupees, count, percent, rupees } from "@/lib/format";
import { getPeriod } from "@/lib/period";
import { notFound } from "next/navigation";
import FcAds from "../_firstcry/Ads";
import FkAds from "../_flipkart/Ads";

export const metadata = { title: "Ads" };

const ratio = (a: number, b: number) => (b ? a / b : NaN);

export default async function AdsPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  if (account.marketplace === "Myntra") notFound(); // Myntra ads come on monthly invoices, shown in profit
  const period = await getPeriod(account.id, await searchParams);
  if (account.marketplace === "Flipkart") return <FkAds account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  if (account.marketplace === "FirstCry") return <FcAds account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  const { result, ads, sbPurchases } = await getProfit(account, period.from, period.to);
  const t = result.totals;
  const byType = aggregateAds(ads, "type");
  const campaigns = aggregateAds(ads, "campaign").slice(0, 40);
  const reported = byType.reduce((s, x) => s + x.spend, 0);
  const adSalesTotal = byType.filter((x) => x.adType !== "SB").reduce((s, x) => s + x.sales, 0) + sbPurchases.reduce((s, x) => s + x.sales, 0);
  const products = result.rows.filter((r) => r.ads > 0 || r.adSales > 0).sort((a, b) => b.ads - a.ads);
  const sbSpendReported = byType.find((x) => x.adType === "SB")?.spend ?? 0;

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Ads" sub={<><PeriodNote from={period.from} to={period.to} />. Spend excludes GST.</>} action={<PeriodPicker period={period} basePath={`/a/${account.id}/ads`} />} />
      {!ads.length && !result.ads.amazonChargeExGst ? <div className="card"><NoData accountId={account.id} what="advertising data" team={viewer.kind === "team"} /></div> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiRupees label="Ad spend" value={t.ads} sub={result.ads.source === "amazon_charge" ? "As charged by Amazon" : "From ads reports"} />
            <KpiRupees label="Ad-attributed sales" value={adSalesTotal} />
            <Kpi label="ACoS" value={percent(ratio(t.ads, adSalesTotal))} sub="Ad spend ÷ ad sales" />
            <Kpi label="ROAS" value={Number.isFinite(ratio(adSalesTotal, t.ads)) ? `${ratio(adSalesTotal, t.ads).toFixed(2)}×` : "–"} />
            <Kpi label="TACoS" value={percent(ratio(t.ads, t.netSales))} sub="Ad spend ÷ all net sales" />
          </div>

          <Section title="Daily spend" sub="Sponsored Products and Display, plus Sponsored Brands days where the keyword report was uploaded.">
            <DailyBars data={dailyAdSpend(ads, period.from, period.to)} format={(n) => compactRupees(n)} label="Ad spend by day" />
          </Section>

          <Section title="By ad type" sub={result.ads.source === "amazon_charge"
            ? `Amazon charged ${rupees(result.ads.amazonChargeExGst)} excl. GST. Products and Display reports account for ${rupees(result.ads.spSd)}; the balance of ${rupees(result.ads.sbResidual)} is Sponsored Brands.`
            : "Amazon's advertising charge for this period is not in the transaction data yet, so spend comes from the ads reports."}>
            <table className="tbl">
              <thead><tr><th>Ad type</th><th className="num">Spend</th><th className="num">Sales</th><th className="num">ACoS</th><th className="num">Impressions</th><th className="num">Clicks</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">Orders</th><th className="num">Conversion</th></tr></thead>
              <tbody>
                {byType.map((x) => {
                  const isSb = x.adType === "SB";
                  const spend = isSb && result.ads.source === "amazon_charge" ? result.ads.sbResidual : x.spend;
                  const sales = isSb ? sbPurchases.reduce((s, p) => s + p.sales, 0) || x.sales : x.sales;
                  return (
                    <tr key={x.key}>
                      <td>{AD_TYPE_LABEL[x.adType]}{isSb && sbSpendReported !== spend && <div className="text-[11px] text-faint">Keyword report shows {rupees(sbSpendReported)} for the days uploaded</div>}</td>
                      <td className="num">{rupees(spend)}</td><td className="num">{rupees(sales)}</td><td className="num">{percent(ratio(spend, sales))}</td>
                      <td className="num">{count(x.impressions)}</td><td className="num">{count(x.clicks)}</td><td className="num">{percent(ratio(x.clicks, x.impressions), 2)}</td>
                      <td className="num">{rupees(ratio(x.spend, x.clicks) || 0, 2)}</td><td className="num">{count(x.orders)}</td><td className="num">{percent(ratio(x.orders, x.clicks))}</td>
                    </tr>
                  );
                })}
                {!byType.some((x) => x.adType === "SB") && result.ads.sbResidual > 0 && (
                  <tr><td>{AD_TYPE_LABEL.SB}</td><td className="num">{rupees(result.ads.sbResidual)}</td><td className="num">{rupees(sbPurchases.reduce((s, p) => s + p.sales, 0))}</td><td className="num">{percent(ratio(result.ads.sbResidual, sbPurchases.reduce((s, p) => s + p.sales, 0)))}</td><td colSpan={6} className="text-xs text-faint">Upload the Sponsored Brands keyword report for clicks and impressions.</td></tr>
                )}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">Reported spend in ads reports: {rupees(reported)}.</p>
          </Section>

          <Section title="By product" sub="Sponsored Brands spend is shared out by each product's Sponsored Brands sales.">
            <div className="max-h-[70vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Ad spend</th><th className="num">Ad sales</th><th className="num">ACoS</th><th className="num">Total net sales</th><th className="num">TACoS</th><th className="num">Net profit</th></tr></thead>
                <tbody>
                  {products.map((r) => (
                    <tr key={r.asin}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.asin}</div></td>
                      <td className="num">{rupees(r.ads)}</td><td className="num">{rupees(r.adSales)}</td><td className="num">{percent(ratio(r.ads, r.adSales))}</td>
                      <td className="num">{rupees(r.netSales)}</td><td className={`num ${ratio(r.ads, r.netSales) > 0.2 ? "font-semibold text-red-700" : ""}`}>{percent(ratio(r.ads, r.netSales))}</td>
                      <td className={`num ${r.profit < 0 ? "text-red-700" : ""}`}>{rupees(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Top campaigns by spend">
            <div className="max-h-[60vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Campaign</th><th>Type</th><th className="num">Spend</th><th className="num">Sales</th><th className="num">ACoS</th><th className="num">Clicks</th><th className="num">CPC</th><th className="num">Orders</th></tr></thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.key}><td className="min-w-64">{c.label || "–"}</td><td>{c.adType}</td><td className="num">{rupees(c.spend)}</td><td className="num">{rupees(c.sales)}</td><td className="num">{percent(ratio(c.spend, c.sales))}</td><td className="num">{count(c.clicks)}</td><td className="num">{rupees(ratio(c.spend, c.clicks) || 0, 2)}</td><td className="num">{count(c.orders)}</td></tr>
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

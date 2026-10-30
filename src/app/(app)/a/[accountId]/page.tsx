import Link from "next/link";
import PeriodPicker from "@/components/PeriodPicker";
import { DailyBars, Kpi, KpiRupees, NoData, PageHeader, PeriodNote, Section, StatusPill } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getFreshness, getProfit, getStock } from "@/lib/data";
import { dailyNetSales } from "@/lib/engine/summaries";
import { compactRupees, count, dateLabel, percent, rupees } from "@/lib/format";
import { getPeriod } from "@/lib/period";
import { REPORT_LABEL, type ReportType } from "@/lib/parsers";
import FcOverview from "./_firstcry/Overview";

export const metadata = { title: "Overview" };

const DAILY: ReportType[] = ["unified_transactions", "orders", "business_child", "fba_inventory", "listings", "sp_advertised", "sd_advertised", "sb_keyword", "sb_purchases", "returns"];

export default async function Overview({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  const period = await getPeriod(account.id, await searchParams);
  if (account.marketplace === "FirstCry") return <FcOverview account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  const [{ result, txns }, stock, fresh] = await Promise.all([
    getProfit(account, period.from, period.to),
    getStock(account, period.from, period.to, period.days),
    getFreshness(account.id),
  ]);
  const t = result.totals;
  const base = `/a/${account.id}`;
  const q = `?from=${period.from}&to=${period.to}`;
  const urgent = stock.rows.filter((r) => r.status === "urgent");
  const counts = stock.rows.filter((r) => r.status === "count_needed").length;
  const make = stock.rows.filter((r) => r.status === "make");
  const top = [...result.rows].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const loss = result.rows.filter((r) => r.profit < 0);

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Overview" sub={<PeriodNote from={period.from} to={period.to} />} action={<PeriodPicker period={period} basePath={base} />} />
      {!txns.length ? (
        <div className="card"><NoData accountId={account.id} what="settled sales" team={viewer.kind === "team"} /></div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiRupees label="Net sales (excl. GST)" value={t.netSales} sub={`${count(t.units)} units`} />
            <KpiRupees label="Net profit" value={result.profitAfterAccountLevel} signed sub={`${percent(result.marginAfterAccountLevel)} margin`} />
            <KpiRupees label="Ad spend" value={t.ads} sub={`TACoS ${percent(t.netSales ? t.ads / t.netSales : 0)}`} />
            <KpiRupees label="Amazon fees" value={t.fees} sub={`${percent(t.netSales ? t.fees / t.netSales : 0)} of sales`} />
            <KpiRupees label="Product cost" value={t.productCost} sub={`${percent(t.netSales ? t.productCost / t.netSales : 0)} of sales`} />
            <Kpi label="Refunds" value={compactRupees(t.refunds)} sub={`${count(t.unitsRefunded)} units`} />
          </div>

          <Section title="Net sales by day" sub="Excluding GST, by Amazon posting date (IST).">
            <DailyBars data={dailyNetSales(txns, period.from, period.to)} format={(n) => compactRupees(n)} label="Net sales by day" />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Most profitable products" action={<Link href={`${base}/profit${q}`} className="text-xs font-semibold text-brand hover:underline">All products</Link>}>
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Net sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.asin}><td>{r.name}<div className="text-[11px] text-faint">{r.asin}</div></td><td className="num">{rupees(r.netSales)}</td><td className="num">{rupees(r.profit)}</td><td className="num">{percent(r.margin)}</td></tr>
                  ))}
                </tbody>
              </table>
              {loss.length > 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-red-700">{loss.length} product{loss.length > 1 ? "s" : ""} made a loss in this period.</p>}
            </Section>

            <Section title="Stock to make" sub={`Next ${account.plan_horizon_days} days, lead time ${account.default_lead_time_days} days.`} action={<Link href={`${base}/stock${q}`} className="text-xs font-semibold text-brand hover:underline">Stock plan</Link>}>
              {counts > 0 && <p className="border-b border-line px-4 py-2 text-xs text-sky-800">{counts} Easy Ship product{counts > 1 ? "s need" : " needs"} your warehouse stock count before they can be planned.</p>}
              {urgent.length + make.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">Every product has enough stock for the plan.</p>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Days left</th><th className="num">Make now</th><th></th></tr></thead>
                  <tbody>
                    {[...urgent, ...make].slice(0, 6).map((r) => (
                      <tr key={r.asin}><td>{r.name}</td><td className="num">{r.daysLeft == null ? "–" : Math.floor(r.daysLeft)}</td><td className="num">{count(r.toMake)}</td>
                        <td>{r.status === "urgent" ? <StatusPill tone="red">Urgent</StatusPill> : <StatusPill tone="amber">Make now</StatusPill>}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>
        </>
      )}

      <Section title="Data received from Amazon" sub="The latest upload of each daily report.">
        <table className="tbl">
          <thead><tr><th>Report</th><th>Data up to</th><th>Uploaded</th></tr></thead>
          <tbody>
            {DAILY.map((k) => (
              <tr key={k}><td>{REPORT_LABEL[k]}</td><td>{fresh[k] ? dateLabel(fresh[k].periodEnd) : <span className="text-faint">Not yet</span>}</td><td className="text-muted">{fresh[k] ? dateLabel(fresh[k].uploadedAt) : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

import Link from "next/link";
import { DailyBars, Kpi, KpiRupees, Section, StatusPill } from "@/components/ui";
import { getFirstCry, getFreshness } from "@/lib/data";
import { compactRupees, count, dateLabel, percent, rupees } from "@/lib/format";
import { REPORT_LABEL, FIRSTCRY_REPORTS } from "@/lib/parsers";
import { FcHeader, FcNoData, HowItWorks, type FcPageProps } from "./common";

export default async function FcOverview({ account, period, team }: FcPageProps) {
  const [{ result, hasSales, hasRecon }, fresh] = await Promise.all([getFirstCry(account, period.from, period.to), getFreshness(account.id)]);
  const t = result.totals;
  const base = `/a/${account.id}`;
  const q = `?from=${period.from}&to=${period.to}`;
  const top = [...result.rows].sort((a, b) => b.profit - a.profit).slice(0, 6);
  const loss = result.rows.filter((r) => r.profit < 0);
  const shortRows = result.rows.filter((r) => r.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  const highRto = result.rows.filter((r) => r.shippedUnits >= 10 && r.rtoUnits / r.shippedUnits >= Math.max(0.08, t.rtoRate * 1.5)).sort((a, b) => b.rtoUnits - a.rtoUnits);

  return (
    <>
      <FcHeader account={account} period={period} title="Overview" slug="" />
      {!hasSales && !hasRecon ? <FcNoData accountId={account.id} team={team} /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiRupees label="Revenue from FirstCry (excl. GST)" value={t.revenue} sub={t.revenueEstimated ? `incl. ${compactRupees(t.revenueEstimated)} estimated` : "all from FirstCry's files"} />
            <KpiRupees label="Net profit" value={t.profit} signed sub={`${percent(t.margin)} margin`} />
            <Kpi label="Units ordered" value={count(t.units)} sub={`${compactRupees(t.mrpValue)} at MRP`} />
            <Kpi label="Usual payout rate" value={result.typicalRate != null ? percent(result.typicalRate, 2) : "–"} sub="base cost ÷ MRP excl. GST" />
            <Kpi label="Not delivered (RTO)" value={percent(t.rtoRate)} sub={`${count(t.rtoUnits)} of ${count(t.shippedUnits)} units shipped`} tone={t.rtoRate > 0.08 ? "bad" : undefined} />
            <KpiRupees label="Product cost" value={t.productCost} sub={`${percent(t.revenue ? t.productCost / t.revenue : 0)} of revenue`} />
          </div>
          <HowItWorks />

          {(shortRows.length > 0 || highRto.length > 0 || loss.length > 0 || result.missingRate.length > 0) && (
            <Section title="Needs attention">
              <ul className="divide-y divide-line text-sm">
                {shortRows.length > 0 && (
                  <li className="px-4 py-3">
                    <b>FirstCry pays less than its usual rate on {shortRows.length} product{shortRows.length > 1 ? "s" : ""}: about {rupees(t.shortfall)} in this period.</b>
                    <div className="mt-0.5 text-xs text-muted">Most products are paid {percent(result.typicalRate ?? 0, 2)} of MRP excluding GST. {shortRows.slice(0, 3).map((r) => `${r.name} (${percent(r.payoutRate ?? 0, 1)})`).join(", ")}{shortRows.length > 3 ? " and others" : ""}. This often happens when a GST rate changes but the base cost is not recalculated. Check the agreement with FirstCry. <Link href={`${base}/payments${q}`} className="font-semibold text-brand hover:underline">Details</Link></div>
                  </li>
                )}
                {highRto.length > 0 && (
                  <li className="px-4 py-3">
                    <b>High undelivered (RTO) rate on {highRto.length} product{highRto.length > 1 ? "s" : ""}.</b>
                    <div className="mt-0.5 text-xs text-muted">{highRto.slice(0, 3).map((r) => `${r.name}: ${count(r.rtoUnits)} of ${count(r.shippedUnits)}`).join("; ")}. RTO units earn nothing and cost shipping both ways. <Link href={`${base}/revenue${q}`} className="font-semibold text-brand hover:underline">Orders & returns</Link></div>
                  </li>
                )}
                {loss.length > 0 && <li className="px-4 py-3"><b>{loss.length} product{loss.length > 1 ? "s" : ""} made a loss.</b> <Link href={`${base}/profit${q}`} className="text-xs font-semibold text-brand hover:underline">Profitability</Link></li>}
                {result.missingRate.length > 0 && <li className="px-4 py-3 text-xs text-muted">{result.missingRate.length} product(s) have orders but no FirstCry payout history yet, so their revenue is shown as ₹0 until a Vendor Reconciliation file includes them.</li>}
              </ul>
            </Section>
          )}

          <Section title="Revenue by day" sub="Base cost from FirstCry, excluding GST, by order date. Recent days include estimates.">
            <DailyBars data={result.daily.map((d) => ({ date: d.date, value: d.revenue }))} format={(n) => compactRupees(n)} label="FirstCry revenue by day" />
          </Section>

          <Section title="Most profitable products" action={<Link href={`${base}/profit${q}`} className="text-xs font-semibold text-brand hover:underline">All products</Link>}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.id}><td>{r.name}<div className="text-[11px] text-faint">{r.styleCode || "No style code"} · {r.id}</div></td><td className="num">{count(r.units)}</td><td className="num">{rupees(r.revenue)}</td><td className="num">{rupees(r.profit)}</td><td className="num">{percent(r.margin)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Section title="Data received from FirstCry" sub="The latest upload of each report.">
        <table className="tbl">
          <thead><tr><th>Report</th><th>Data up to</th><th>Uploaded</th></tr></thead>
          <tbody>
            {FIRSTCRY_REPORTS.map((k) => (
              <tr key={k}><td>{REPORT_LABEL[k]}</td><td>{fresh[k] ? (fresh[k].periodEnd ? dateLabel(fresh[k].periodEnd) : "Current list") : <span className="text-faint">Not yet</span>}</td><td className="text-muted">{fresh[k] ? dateLabel(fresh[k].uploadedAt) : ""}</td></tr>
            ))}
          </tbody>
        </table>
        {!fresh.fc_products && team && <p className="border-t border-line px-4 py-2.5 text-xs"><StatusPill tone="amber">Product list missing</StatusPill> Upload &quot;All Product data&quot; so products show names and GST rates.</p>}
      </Section>
    </>
  );
}

import Link from "next/link";
import PeriodPicker from "@/components/PeriodPicker";
import { KpiRupees, NoData, PageHeader, PeriodNote, Section, StatusPill } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getProfit } from "@/lib/data";
import { count, percent, rupees } from "@/lib/format";
import { getPeriod } from "@/lib/period";

export const metadata = { title: "Profitability" };

const SOURCE: Record<string, { tone: "green" | "blue" | "grey"; label: string }> = {
  seller_rupees: { tone: "green", label: "Seller ₹" },
  seller_pct: { tone: "blue", label: "Seller %" },
  default: { tone: "grey", label: "Default" },
};

export default async function ProfitPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  const period = await getPeriod(account.id, await searchParams);
  const { result, txns } = await getProfit(account, period.from, period.to);
  const t = result.totals;
  const defaults = result.rows.filter((r) => r.costSource === "default").length;

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Profitability" sub={<>By product, <PeriodNote from={period.from} to={period.to} />. All amounts exclude GST.</>} action={<PeriodPicker period={period} basePath={`/a/${account.id}/profit`} />} />
      {!txns.length ? <div className="card"><NoData accountId={account.id} what="settled sales" team={viewer.kind === "team"} /></div> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiRupees label="Net sales" value={t.netSales} />
            <KpiRupees label="Amazon fees" value={t.fees} sub={percent(t.netSales ? t.fees / t.netSales : 0)} />
            <KpiRupees label="Ad spend" value={t.ads} sub={percent(t.netSales ? t.ads / t.netSales : 0)} />
            <KpiRupees label="Product cost" value={t.productCost} sub={percent(t.netSales ? t.productCost / t.netSales : 0)} />
            <KpiRupees label="Net profit" value={result.profitAfterAccountLevel} signed sub={`${percent(result.marginAfterAccountLevel)} margin`} />
          </div>
          {defaults > 0 && (
            <p className="mb-4 rounded-lg border border-amber/40 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              {defaults} of {result.rows.length} products use the default product cost of {percent(account.default_cost_pct, 0)} of the selling price.{" "}
              {viewer.canEditCosts && <Link href={`/a/${account.id}/costs`} className="font-semibold underline">Enter actual costs</Link>}
            </p>
          )}
          <Section title="Profit by product">
            <div className="max-h-[70vh] overflow-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Product</th><th className="num">Units</th><th className="num">Avg price incl. GST</th><th className="num">Net sales</th><th className="num">Amazon fees</th><th className="num">Ad spend</th><th className="num">Reimburse&shy;ments</th><th className="num">Cost / unit</th><th className="num">Product cost</th><th className="num">Net profit</th><th className="num">Margin</th></tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.asin}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.asin}{r.unitsRefunded ? ` · ${r.unitsRefunded} refunded` : ""}</div></td>
                      <td className="num">{count(r.units)}</td>
                      <td className="num">{rupees(r.avgPriceInclGst)}</td>
                      <td className="num">{rupees(r.netSales)}</td>
                      <td className="num">{rupees(r.fees)}</td>
                      <td className="num">{rupees(r.ads)}</td>
                      <td className="num">{r.reimbursements ? rupees(r.reimbursements) : "–"}</td>
                      <td className="num">{rupees(r.costPerUnit)} <StatusPill tone={SOURCE[r.costSource].tone}>{SOURCE[r.costSource].label}</StatusPill></td>
                      <td className="num">{rupees(r.productCost)}</td>
                      <td className={`num font-semibold ${r.profit < 0 ? "text-red-700" : ""}`}>{rupees(r.profit)}</td>
                      <td className="num">{percent(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>All products</td><td className="num">{count(t.units)}</td><td></td><td className="num">{rupees(t.netSales)}</td><td className="num">{rupees(t.fees)}</td><td className="num">{rupees(t.ads)}</td><td className="num">{rupees(t.reimbursements)}</td><td></td><td className="num">{rupees(t.productCost)}</td><td className="num">{rupees(t.profit)}</td><td className="num">{percent(t.margin)}</td></tr>
                </tfoot>
              </table>
            </div>
          </Section>

          <Section title="Account-level items" sub="Charges and credits Amazon does not tie to a product (storage fees, cancellation charges, fee refunds on older orders).">
            <table className="tbl">
              <tbody>
                {result.accountLevel.map((x) => <tr key={x.label}><td>{x.label}</td><td className="num">{rupees(x.amount)}</td></tr>)}
                <tr><td className="font-semibold">Profit from products</td><td className="num font-semibold">{rupees(t.profit)}</td></tr>
                <tr><td className="font-semibold">Net profit after account-level items</td><td className="num font-bold">{rupees(result.profitAfterAccountLevel)} ({percent(result.marginAfterAccountLevel)})</td></tr>
              </tbody>
            </table>
          </Section>

          <Section title="How this is calculated">
            <ul className="list-disc space-y-1.5 px-8 py-4 text-sm text-muted">
              <li><b>Net sales</b>: product sales, shipping and gift wrap credits, less promotional rebates and refunds, from Amazon&apos;s Custom Unified Transaction report. GST is excluded because it is paid to the government.</li>
              <li><b>Amazon fees</b>: referral, closing, FBA, Easy Ship and other transaction fees, net of fee refunds. Amazon reports them including 18% GST; the dashboard divides by 1.18 because the GST is claimed back as input credit.</li>
              <li><b>Ad spend</b>: Sponsored Products and Display spend by product. Sponsored Brands spend is the rest of Amazon&apos;s advertising charge ({rupees(result.ads.sbResidual)} this period), split by each product&apos;s share of Sponsored Brands attributed sales.</li>
              <li><b>Product cost</b>: the seller&apos;s cost per unit, or cost %, or else {percent(account.default_cost_pct, 0)} of the average selling price including GST. Packaging, inbound freight and overheads are not included yet.</li>
              <li><b>Not counted as cost</b>: GST, TCS ({rupees(result.tcs)}) and TDS ({rupees(result.tds)}), which are claimable, and payouts to the bank.</li>
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

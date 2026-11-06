import { Bar, Kpi, Section } from "@/components/ui";
import { getFlipkart } from "@/lib/data";
import { count, percent } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

export default async function FkOrders({ account, period, team }: FcPageProps) {
  const { result, hasData } = await getFlipkart(account, period.from, period.to);
  const t = result.totals;
  const rto = result.rows.filter((r) => r.rtoUnits > 0).sort((a, b) => b.rtoUnits - a.rtoUnits);
  const cancels = result.reasons.filter((r) => r.kind === "RTO / cancelled");
  const returns = result.reasons.filter((r) => r.kind === "Return");
  const cTotal = cancels.reduce((s, r) => s + r.count, 0);
  return (
    <>
      <FcHeader account={account} period={period} title="Orders & returns" slug="revenue"
        sub="RTO = shipped but not delivered (Flipkart's courier returns, including orders cancelled after shipping). Customer return = delivered, then returned." />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Flipkart" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Order items" value={count(t.orders)} />
            <Kpi label="Cancelled before shipping" value={count(t.cancelled)} />
            <Kpi label="Shipped" value={count(t.shipped)} />
            <Kpi label="Not delivered (RTO)" value={percent(t.rtoRate)} sub={`${count(t.rtoUnits)} units`} tone={t.rtoRate > 0.1 ? "bad" : undefined} />
            <Kpi label="Customer returns" value={percent(t.returnRate)} sub={`${count(t.returnUnits)} of ${count(t.units)} delivered`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Why orders were cancelled or not delivered" sub="Reasons from the Flipkart returns and orders reports.">
              {!cancels.length ? <p className="px-4 py-6 text-sm text-muted">No cancellations or RTOs in this period.</p> : (
                <table className="tbl">
                  <thead><tr><th>Reason</th><th className="num">Orders</th><th></th></tr></thead>
                  <tbody>{cancels.map((r) => <tr key={r.reason}><td>{r.reason}</td><td className="num">{count(r.count)}</td><td><Bar share={cTotal ? r.count / cTotal : 0} tone="amber" /></td></tr>)}</tbody>
                </table>
              )}
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Flipkart&apos;s orders report gives no reason for cancellations before shipping. &quot;Attempts exhausted&quot; and &quot;not serviceable&quot; are delivery failures; cash-on-delivery orders and slow dispatch raise them.</p>
            </Section>
            <div className="space-y-6">
              <Section title="Undelivered (RTO) by product">
                {!rto.length ? <p className="px-4 py-6 text-sm text-muted">No RTO in this period.</p> : (
                  <table className="tbl">
                    <thead><tr><th>Product</th><th className="num">Shipped</th><th className="num">RTO</th><th className="num">Rate</th></tr></thead>
                    <tbody>{rto.map((r) => { const shipped = r.units + r.rtoUnits; return <tr key={r.sku}><td>{r.name}<div className="text-[11px] text-faint">{r.sku}</div></td><td className="num">{count(shipped)}</td><td className="num">{count(r.rtoUnits)}</td><td className="num">{percent(shipped ? r.rtoUnits / shipped : 0)}</td></tr>; })}</tbody>
                  </table>
                )}
              </Section>
              <Section title="Why customers returned" sub="From the Flipkart returns report.">
                {!returns.length ? <p className="px-4 py-6 text-sm text-muted">No customer returns in this period.</p> : (
                  <table className="tbl"><thead><tr><th>Reason</th><th className="num">Returns</th></tr></thead>
                    <tbody>{returns.map((r) => <tr key={r.reason}><td>{r.reason}</td><td className="num">{count(r.count)}</td></tr>)}</tbody></table>
                )}
              </Section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

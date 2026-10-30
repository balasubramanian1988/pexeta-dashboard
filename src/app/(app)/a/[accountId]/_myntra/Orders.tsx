import { Bar, Kpi, Section } from "@/components/ui";
import { getMyntra } from "@/lib/data";
import { count, percent } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

export default async function MyOrders({ account, period, team }: FcPageProps) {
  const { result, hasData } = await getMyntra(account, period.from, period.to);
  const t = result.totals;
  const rto = result.rows.filter((r) => r.rtoUnits > 0).sort((a, b) => b.rtoUnits - a.rtoUnits);
  const cancels = result.reasons.filter((r) => r.kind === "RTO / cancelled");
  const returns = result.reasons.filter((r) => r.kind === "Return");
  const cTotal = cancels.reduce((s, r) => s + r.count, 0);
  return (
    <>
      <FcHeader account={account} period={period} title="Orders & returns" slug="revenue"
        sub="RTO = shipped but not delivered (including orders cancelled after shipping). Customer return = delivered, then returned." />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Myntra" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Order lines" value={count(t.orders)} />
            <Kpi label="Cancelled before shipping" value={count(t.cancelled)} />
            <Kpi label="Shipped" value={count(t.shipped)} />
            <Kpi label="Not delivered (RTO)" value={percent(t.rtoRate)} sub={`${count(t.rtoUnits)} orders`} tone={t.rtoRate > 0.1 ? "bad" : undefined} />
            <Kpi label="Customer returns" value={percent(t.returnRate)} sub={`${count(t.returnUnits)} of ${count(t.units)} delivered`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Why orders were cancelled or not delivered" sub="Cancellation reasons from the Myntra orders report.">
              {!cancels.length ? <p className="px-4 py-6 text-sm text-muted">No cancellations or RTOs in this period.</p> : (
                <table className="tbl">
                  <thead><tr><th>Reason</th><th className="num">Orders</th><th></th></tr></thead>
                  <tbody>{cancels.map((r) => <tr key={r.reason}><td>{r.reason}</td><td className="num">{count(r.count)}</td><td><Bar share={cTotal ? r.count / cTotal : 0} tone="amber" /></td></tr>)}</tbody>
                </table>
              )}
              {cancels.some((r) => /delay/i.test(r.reason)) && <p className="border-t border-line px-4 py-2.5 text-xs text-amber-800">&quot;Delayed delivery&quot; cancellations happen after you ship: faster packing and pickup reduce them.</p>}
            </Section>
            <div className="space-y-6">
              <Section title="Undelivered (RTO) by product">
                {!rto.length ? <p className="px-4 py-6 text-sm text-muted">No RTO in this period.</p> : (
                  <table className="tbl">
                    <thead><tr><th>Product</th><th className="num">Shipped</th><th className="num">RTO</th><th className="num">Rate</th></tr></thead>
                    <tbody>{rto.map((r) => { const shipped = r.units + r.rtoUnits; return <tr key={r.sku}><td>{r.name}</td><td className="num">{count(shipped)}</td><td className="num">{count(r.rtoUnits)}</td><td className="num">{percent(shipped ? r.rtoUnits / shipped : 0)}</td></tr>; })}</tbody>
                  </table>
                )}
              </Section>
              <Section title="Why customers returned" sub="From the Myntra returns report.">
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

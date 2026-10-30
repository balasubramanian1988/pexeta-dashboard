import { Bar, Kpi, Section } from "@/components/ui";
import { getFirstCry } from "@/lib/data";
import { returnReasons } from "@/lib/engine/firstcry";
import { count, percent } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "./common";

export default async function FcOrders({ account, period, team }: FcPageProps) {
  const { result, returns, hasSales, hasRecon } = await getFirstCry(account, period.from, period.to);
  const t = result.totals;
  const rto = result.rows.filter((r) => r.rtoUnits > 0).sort((a, b) => b.rtoUnits - a.rtoUnits);
  const reasons = returnReasons(returns);
  const reasonTotal = reasons.reduce((s, r) => s + r.units, 0);
  return (
    <>
      <FcHeader account={account} period={period} title="Orders & returns" slug="revenue"
        sub="RTO = shipped but not delivered and sent back to you. Customer return = delivered, then returned. FirstCry recovers both by debit note." />
      {!hasSales && !hasRecon ? <FcNoData accountId={account.id} team={team} /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Units ordered" value={count(t.units)} sub={`${count(t.estimatedUnits)} not yet invoiced`} />
            <Kpi label="Units shipped" value={count(t.shippedUnits)} sub="in Vendor Reconciliation" />
            <Kpi label="Not delivered (RTO)" value={percent(t.rtoRate)} sub={`${count(t.rtoUnits)} units`} tone={t.rtoRate > 0.08 ? "bad" : undefined} />
            <Kpi label="Customer returns" value={percent(t.returnRate)} sub={`${count(t.returnUnits)} units`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Undelivered (RTO) by product" sub="Share of the product's shipped units that came back undelivered.">
              {!rto.length ? <p className="px-4 py-6 text-sm text-muted">No RTO in this period.</p> : (
                <table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Shipped</th><th className="num">RTO</th><th className="num">Rate</th><th></th></tr></thead>
                  <tbody>
                    {rto.map((r) => {
                      const rate = r.shippedUnits ? r.rtoUnits / r.shippedUnits : 0;
                      return <tr key={r.id}><td>{r.name}</td><td className="num">{count(r.shippedUnits)}</td><td className="num">{count(r.rtoUnits)}</td><td className="num">{percent(rate)}</td><td><Bar share={rate * 4} tone="amber" /></td></tr>;
                    })}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title="Why customers returned" sub="From FirstCry's Sale Return data, by return date.">
              {!reasons.length ? <p className="px-4 py-6 text-sm text-muted">No customer returns recorded for these dates{team ? ". Upload Sale Return data to see reasons." : "."}</p> : (
                <table className="tbl">
                  <thead><tr><th>Reason</th><th>Detail</th><th className="num">Units</th><th></th></tr></thead>
                  <tbody>
                    {reasons.map((r) => (
                      <tr key={`${r.reason}|${r.detail}`}><td>{r.reason}</td><td className="text-muted">{r.detail || "–"}</td><td className="num">{count(r.units)}</td><td><Bar share={reasonTotal ? r.units / reasonTotal : 0} /></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {reasons.some((r) => /damag|leak|spill|wrong|different/i.test(`${r.reason} ${r.detail}`)) && (
                <p className="border-t border-line px-4 py-2.5 text-xs text-amber-800">Damaged, leaking or wrong-item returns usually point to packing or dispatch, not the product.</p>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}

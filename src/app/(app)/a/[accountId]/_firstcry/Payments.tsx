import { KpiRupees, Section } from "@/components/ui";
import { getFirstCry } from "@/lib/data";
import { UNIT_STATUS_LABEL, type UnitStatus } from "@/lib/engine/firstcry";
import { count, percent, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "./common";

const ORDER: UnitStatus[] = ["paid", "awaiting_payment", "in_transit", "not_invoiced", "rto", "customer_return"];

export default async function FcPayments({ account, period, team }: FcPageProps) {
  const { result, hasRecon } = await getFirstCry(account, period.from, period.to);
  const s = result.status;
  const short = result.rows.filter((r) => r.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  return (
    <>
      <FcHeader account={account} period={period} title="Payments" slug="payments" sub="Amounts include GST, as FirstCry pays them. Based on Vendor Reconciliation files." />
      {!hasRecon ? <FcNoData accountId={account.id} team={team} what="Vendor Reconciliation data" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiRupees label="Paid" value={s.paid.amount} sub={`${count(s.paid.units)} units`} />
            <KpiRupees label="Delivered, awaiting payment" value={s.awaiting_payment.amount} sub={`${count(s.awaiting_payment.units)} units`} />
            <KpiRupees label="Shipped, not yet delivered" value={s.in_transit.amount} sub={`${count(s.in_transit.units)} units`} />
            <KpiRupees label="Debited (RTO + returns)" value={s.rto.amount + s.customer_return.amount} sub={`${count(s.rto.units + s.customer_return.units)} units`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Where every unit stands" sub="Orders placed in the period.">
              <table className="tbl">
                <thead><tr><th>Status</th><th className="num">Units</th><th className="num">Amount incl. GST</th></tr></thead>
                <tbody>
                  {ORDER.map((k) => <tr key={k}><td>{UNIT_STATUS_LABEL[k]}</td><td className="num">{count(s[k].units)}</td><td className="num">{rupees(s[k].amount)}</td></tr>)}
                </tbody>
              </table>
            </Section>
            <Section title="Payment advices" sub="FirstCry payment advice numbers covering these orders. Match them to bank credits.">
              {!result.advices.length ? <p className="px-4 py-6 text-sm text-muted">No payments yet for these orders.</p> : (
                <table className="tbl">
                  <thead><tr><th>Payment advice</th><th className="num">Units</th><th className="num">Amount incl. GST</th></tr></thead>
                  <tbody>{result.advices.map((a) => <tr key={a.advice}><td className="font-mono text-xs">{a.advice}</td><td className="num">{count(a.units)}</td><td className="num">{rupees(a.amount)}</td></tr>)}</tbody>
                </table>
              )}
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">An advice can also cover orders outside these dates, so its bank credit may be larger.</p>
            </Section>
          </div>

          <Section title="Payout rate check" sub={result.typicalRate != null ? <>Most products are paid {percent(result.typicalRate, 2)} of MRP excluding GST. Products paid noticeably less are listed with the difference on units kept.</> : "Needs Vendor Reconciliation data."}>
            {!short.length ? <p className="px-4 py-6 text-sm text-muted">Every product was paid at the usual rate in this period.</p> : (
              <>
                <table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Units paid</th><th className="num">Paid rate</th><th className="num">Usual rate</th><th className="num">Difference</th></tr></thead>
                  <tbody>
                    {short.map((r) => <tr key={r.id}><td>{r.name}<div className="text-[11px] text-faint">{r.styleCode || "No style code"} · {r.id}</div></td><td className="num">{count(r.payoutUnits)}</td><td className="num text-red-700">{percent(r.payoutRate ?? 0, 2)}</td><td className="num">{percent(result.typicalRate ?? 0, 2)}</td><td className="num font-semibold">{rupees(r.shortfall)}</td></tr>)}
                    <tr className="font-semibold"><td>Total</td><td></td><td></td><td></td><td className="num">{rupees(result.totals.shortfall)}</td></tr>
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Seen on Root and Soil: after a product&apos;s GST rate changed (18% to 5% or 0%), the invoices used the new GST rate but the base cost stayed at its old 18% value. Whether this is recoverable depends on the agreement with FirstCry.</p>
              </>
            )}
          </Section>
        </>
      )}
    </>
  );
}

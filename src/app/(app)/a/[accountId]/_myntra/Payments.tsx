import { KpiRupees, Section } from "@/components/ui";
import { getMyntra } from "@/lib/data";
import { MY_STATUS_LABEL, type MyLineStatus } from "@/lib/engine/myntra";
import { count, dateLabel, monthLabel, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

const ORDER: MyLineStatus[] = ["settled", "pending_settlement", "not_in_settlement", "returned", "rto", "cancelled"];

export default async function MyPayments({ account, period, team }: FcPageProps) {
  const { result, invoices, deductions, hasData } = await getMyntra(account, period.from, period.to);
  const s = result.status;
  const ded = [...deductions].sort((a, b) => String(b.settlement_date).localeCompare(String(a.settlement_date)));
  return (
    <>
      <FcHeader account={account} period={period} title="Payments" slug="payments" sub="Payouts as Myntra pays them, after commission, shipping, TCS and TDS. From the settlement reports." />
      {!hasData ? <FcNoData accountId={account.id} team={team} marketplace="Myntra" what="Myntra settlement data" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiRupees label="Paid" value={s.settled.amount} sub={`${count(s.settled.lines)} orders`} />
            <KpiRupees label="Due, not yet paid" value={s.pending_settlement.amount} sub={`${count(s.pending_settlement.lines)} orders`} />
            <KpiRupees label="Not yet in a settlement file" value={s.not_in_settlement.amount} sub={`${count(s.not_in_settlement.lines)} orders, estimated`} />
            <KpiRupees label="Returns (net debit)" value={s.returned.amount} sub={`${count(s.returned.lines)} orders`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Where every order stands" sub="Orders placed in the period.">
              <table className="tbl">
                <thead><tr><th>Status</th><th className="num">Orders</th><th className="num">Payout</th></tr></thead>
                <tbody>{ORDER.map((k) => <tr key={k}><td>{MY_STATUS_LABEL[k]}</td><td className="num">{count(s[k].lines)}</td><td className="num">{k === "rto" || k === "cancelled" ? "–" : rupees(s[k].amount)}</td></tr>)}</tbody>
              </table>
            </Section>
            <Section title="Bank credits (UTR)" sub="Myntra pays prepaid and cash-on-delivery amounts separately. Match each UTR to the bank statement.">
              {!result.utrs.length ? <p className="px-4 py-6 text-sm text-muted">No payouts yet for these orders.</p> : (
                <table className="tbl">
                  <thead><tr><th>UTR</th><th>Date</th><th className="num">Orders</th><th className="num">Amount</th></tr></thead>
                  <tbody>{result.utrs.map((u) => <tr key={u.utr}><td className="break-all font-mono text-[11px]">{u.utr}</td><td className="whitespace-nowrap">{dateLabel(u.date)}</td><td className="num">{count(u.lines)}</td><td className="num">{rupees(u.amount, 2)}</td></tr>)}</tbody>
                </table>
              )}
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">A UTR can also cover orders outside these dates, and non-order deductions are taken from it, so the bank credit can differ.</p>
            </Section>
          </div>
          <Section title="Deductions not tied to an order" sub="Taken from payouts by Myntra: ads (Marketing Claim) and other adjustments. Shown for all dates.">
            {!ded.length ? <p className="px-4 py-6 text-sm text-muted">None uploaded.</p> : (
              <table className="tbl">
                <thead><tr><th>Reference</th><th>Settled on</th><th>UTR</th><th className="num">Amount</th></tr></thead>
                <tbody>{ded.map((d) => <tr key={d.invoice_ref}><td className="font-mono text-[11px]">{d.description || d.invoice_ref}</td><td>{d.settlement_date ? dateLabel(d.settlement_date) : "Not yet"}</td><td className="break-all font-mono text-[11px]">{d.utr ?? "–"}</td><td className="num">{rupees(d.amount, 2)}</td></tr>)}</tbody>
              </table>
            )}
          </Section>
          <Section title="Myntra invoices" sub="Tax invoices for ads, commission, logistics and subscription. Commission and logistics are already deducted order by order; these are the GST documents for them.">
            {!invoices.length ? <p className="px-4 py-6 text-sm text-muted">No invoices uploaded.</p> : (
              <table className="tbl">
                <thead><tr><th>Invoice</th><th>Type</th><th>For</th><th>Detail</th><th className="num">Excl. GST</th><th className="num">Total</th></tr></thead>
                <tbody>{[...invoices].sort((a, b) => b.charge_month.localeCompare(a.charge_month)).map((i) => <tr key={i.number}><td className="font-mono text-xs">{i.number}</td><td>{i.category}</td><td>{monthLabel(i.charge_month.slice(0, 7))}</td><td className="text-xs text-muted">{i.description}</td><td className="num">{rupees(i.base_amount, 2)}</td><td className="num">{rupees(i.total, 2)}</td></tr>)}</tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </>
  );
}

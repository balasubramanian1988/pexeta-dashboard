import { KpiRupees, Section } from "@/components/ui";
import { getFkPayments, getFlipkart } from "@/lib/data";
import { FK_STATUS_LABEL, type FkLineStatus } from "@/lib/engine/flipkart";
import { count, dateLabel, rupees } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "../_firstcry/common";

const ORDER: FkLineStatus[] = ["paid", "not_in_settlement", "returned", "rto", "cancelled"];
const SHEET_LABEL: Record<string, string> = { Ads: "Flipkart Ads wallet top-ups", "MP Fee Rebate": "Fee rebates", Non_Order_SPF: "Seller protection fund", Storage_Recall: "Storage and recall fees", Fines: "Fines", TCS_Recovery: "TCS recovery", TDS: "TDS" };

export default async function FkPayments({ account, period, team }: FcPageProps) {
  const [{ result, hasData }, pay] = await Promise.all([getFlipkart(account, period.from, period.to), getFkPayments(account, period.from, period.to)]);
  const s = result.status;
  const received = pay.payouts.reduce((x, p) => x + p.total, 0);
  return (
    <>
      <FcHeader account={account} period={period} title="Payments" slug="payments" sub="Payouts as Flipkart pays them, after fees, TCS, TDS and GST on fees. From the settlement reports." />
      {!hasData && !pay.payouts.length ? <FcNoData accountId={account.id} team={team} marketplace="Flipkart" what="Flipkart settlement data" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiRupees label="Paid on these orders" value={s.paid.amount} sub={`${count(s.paid.lines)} order${s.paid.lines === 1 ? "" : "s"}`} />
            <KpiRupees label="Not yet in a settlement report" value={s.not_in_settlement.amount} sub={`${count(s.not_in_settlement.lines)} orders, estimated`} />
            <KpiRupees label="Returns (net)" value={s.returned.amount} sub={`${count(s.returned.lines)} order${s.returned.lines === 1 ? "" : "s"}`} />
            <KpiRupees label="Received in the bank" value={received} sub={`${count(pay.payouts.length)} transfers dated in the period`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Where every order stands" sub="Orders placed in the period.">
              <table className="tbl">
                <thead><tr><th>Status</th><th className="num">Orders</th><th className="num">Payout</th></tr></thead>
                <tbody>{ORDER.map((k) => <tr key={k}><td>{FK_STATUS_LABEL[k]}</td><td className="num">{count(s[k].lines)}</td><td className="num">{k === "cancelled" ? "–" : rupees(s[k].amount)}</td></tr>)}</tbody>
              </table>
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">RTO payouts are what Flipkart kept or paid after reversing the sale (usually close to zero).</p>
            </Section>
            <Section title="Bank transfers (NEFT)" sub="Transfers dated in the period, for matching the bank statement. Each pays orders from several dates, less deductions such as Flipkart Ads wallet top-ups.">
              {!pay.payouts.length ? <p className="px-4 py-6 text-sm text-muted">No payouts dated in this period.</p> : (
                <table className="tbl">
                  <thead><tr><th>NEFT</th><th>Date</th><th className="num">Orders</th><th className="num">Deductions</th><th className="num">Paid</th></tr></thead>
                  <tbody>{pay.payouts.map((p) => <tr key={p.neft}><td className="break-all font-mono text-[11px]">{p.neft}<div className="font-sans text-[11px] text-faint">{p.type}</div></td><td className="whitespace-nowrap">{dateLabel(p.date)}</td><td className="num">{rupees(p.orders, 2)}</td><td className="num">{p.deductions ? rupees(p.deductions, 2) : "–"}</td><td className="num font-semibold">{rupees(p.total, 2)}</td></tr>)}</tbody>
                </table>
              )}
            </Section>
          </div>
          {pay.deductions.length > 0 && (
            <Section title="Deductions not tied to an order" sub="Taken from payouts dated in the period, incl. GST.">
              <table className="tbl">
                <thead><tr><th>What</th><th className="num">Amount</th></tr></thead>
                <tbody>{pay.deductions.map((d) => <tr key={d.sheet}><td>{SHEET_LABEL[d.sheet] ?? d.sheet}</td><td className="num">{rupees(d.amount, 2)}</td></tr>)}</tbody>
              </table>
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Ads wallet top-ups are cash moved to the ads wallet. Profit counts ads when spent, from the Flipkart Ads reports, so the two can differ by month.</p>
            </Section>
          )}
          <Section title="Flipkart invoices and credit notes" sub="GST documents for Flipkart's fees and ads. Fees are already deducted order by order; ads are paid from the ads wallet. Shown for all dates.">
            {!pay.invoices.length ? <p className="px-4 py-6 text-sm text-muted">No invoices uploaded.</p> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Number</th><th>Date</th><th className="num">Ads</th><th className="num">Commission</th><th className="num">Fixed fee</th><th className="num">Shipping</th><th className="num">Other</th><th className="num">Excl. GST</th><th className="num">GST</th><th className="num">Total</th></tr></thead>
                  <tbody>{pay.invoices.map((i) => (
                    <tr key={i.number}>
                      <td className="font-mono text-xs">{i.number}{i.doc_type === "credit_note" && <div className="font-sans text-[11px] text-faint">Credit note{i.original_number ? ` on ${i.original_number}` : ""}</div>}</td>
                      <td className="whitespace-nowrap">{dateLabel(i.invoice_date)}</td>
                      <td className="num">{i.ads ? rupees(i.ads, 2) : "–"}</td><td className="num">{i.commission ? rupees(i.commission, 2) : "–"}</td><td className="num">{i.fixed_fee ? rupees(i.fixed_fee, 2) : "–"}</td>
                      <td className="num">{i.shipping ? rupees(i.shipping, 2) : "–"}</td><td className="num">{i.other ? rupees(i.other, 2) : "–"}</td>
                      <td className="num">{rupees(i.base_amount, 2)}</td><td className="num">{rupees(i.gst, 2)}</td><td className="num font-semibold">{rupees(i.total, 2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

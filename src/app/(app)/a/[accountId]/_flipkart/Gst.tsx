// Flipkart GST tab: output GST from the Sales report (by GST registration, state and rate, HSN), TCS and TDS
// Flipkart deducted, and Flipkart's fee invoices for input credit. One month at a time, by invoice date.
import Link from "next/link";
import { Download } from "lucide-react";
import { Empty, KpiRupees, PageHeader, Section, StatusPill } from "@/components/ui";
import type { Account } from "@/lib/auth";
import { count, dateLabel, monthLabel, rupees } from "@/lib/format";
import { fkGstMonth, fkGstMonths, type FkGstRow } from "@/lib/gst";

function TaxTable({ rows, label }: { rows: FkGstRow[]; label: string }) {
  const t = rows.reduce((a, r) => ({ q: a.q + r.quantity, v: a.v + r.taxable, i: a.i + r.igst, c: a.c + r.cgst, s: a.s + r.sgst }), { q: 0, v: 0, i: 0, c: 0, s: 0 });
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{label}</th><th className="num">GST rate</th><th className="num">Units (net)</th><th className="num">Taxable value</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Total GST</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key}><td>{r.label}</td><td className="num">{r.rate}%</td><td className="num">{count(r.quantity)}</td><td className="num">{rupees(r.taxable, 2)}</td><td className="num">{rupees(r.igst, 2)}</td><td className="num">{rupees(r.cgst, 2)}</td><td className="num">{rupees(r.sgst, 2)}</td><td className="num">{rupees(r.igst + r.cgst + r.sgst, 2)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={2}>Total</td><td className="num">{count(t.q)}</td><td className="num">{rupees(t.v, 2)}</td><td className="num">{rupees(t.i, 2)}</td><td className="num">{rupees(t.c, 2)}</td><td className="num">{rupees(t.s, 2)}</td><td className="num">{rupees(t.i + t.c + t.s, 2)}</td></tr></tfoot>
      </table>
    </div>
  );
}

export default async function FkGst({ account, team, month: wanted }: { account: Account; team: boolean; month?: string }) {
  const months = await fkGstMonths(account.id);
  const month = wanted && /^\d{4}-\d{2}$/.test(wanted) && months.includes(`${wanted}-01`) ? `${wanted}-01` : months[0];
  const base = `/a/${account.id}/gst`;
  const fileHref = (path: string) => `/api/a/${account.id}/files?path=${encodeURIComponent(path)}`;
  if (!month) {
    return (
      <>
        <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="GST & documents" />
        <div className="card"><Empty>No Flipkart Sales reports or invoices yet. {team ? <Link className="font-semibold text-brand underline" href={`/a/${account.id}/uploads`}>Upload the Sales report and Flipkart&apos;s invoices</Link> : "Pexeta uploads them every month."}</Empty></div>
      </>
    );
  }
  const { summaries, byState, byHsn, docs, files, lines } = await fkGstMonth(account.id, account.client_id, month);
  const sum = (f: (s: (typeof summaries)[number]) => number) => summaries.reduce((a, s) => a + f(s), 0);
  const feeGst = docs.reduce((s, d) => s + d.gst, 0);
  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title={`GST & documents: ${monthLabel(month)}`}
        sub="Sales, returns and GST as reported in Flipkart's Sales report, by the date of each invoice and credit note, and Flipkart's tax invoices for its fees and ads. Download everything for your auditor in one ZIP."
        action={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <a href={`/api/a/${account.id}/gst?month=${month.slice(0, 7)}`} className="btn btn-primary"><Download size={16} /> Download all for {monthLabel(month)}</a>
            <div className="flex flex-wrap gap-1.5">
              {months.slice(0, 12).map((m) => (
                <Link key={m} href={`${base}?month=${m.slice(0, 7)}`} className={`rounded-full px-3 py-1 text-xs font-semibold ${m === month ? "bg-navy text-white" : "border border-line bg-white hover:bg-ice-dim"}`}>{monthLabel(m)}</Link>
              ))}
            </div>
          </div>
        } />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiRupees label="Taxable sales (net)" value={sum((s) => s.b2c.sales + s.b2b.sales - s.b2c.returns - s.b2b.returns)} sub={`after ${rupees(sum((s) => s.b2c.returns + s.b2b.returns))} of returns and cancellations`} />
        <KpiRupees label="Output GST" value={sum((s) => s.b2c.tax + s.b2b.tax)} />
        <KpiRupees label="TCS collected by Flipkart" value={sum((s) => s.b2c.tcs + s.b2b.tcs)} sub="claim in GSTR-3B" />
        <KpiRupees label="TDS deducted by Flipkart" value={sum((s) => s.b2c.tds + s.b2b.tds)} sub="section 194-O, in Form 26AS" />
        <KpiRupees label="Input GST on Flipkart fees" value={feeGst} sub={`${docs.length} Flipkart document${docs.length === 1 ? "" : "s"} this month`} />
      </div>

      {!lines ? <div className="card mb-6"><Empty>No Flipkart Sales report covers {monthLabel(month)} yet{team ? ": upload it from Seller Hub › Reports › Tax reports" : ""}.</Empty></div> : (
        <>
          <Section title="By GST registration" sub="B2B = orders where the buyer gave a GSTIN; everything else is B2C.">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>GSTIN</th><th className="num">B2C sales</th><th className="num">B2C returns</th><th className="num">B2B sales</th><th className="num">B2B returns</th><th className="num">Output GST</th><th className="num">TCS</th><th className="num">TDS</th><th className="num">Invoices</th><th className="num">Credit notes</th></tr></thead>
                <tbody>{summaries.map((s) => (
                  <tr key={s.gstin}>
                    <td className="whitespace-nowrap"><span className="font-mono text-xs">{s.gstin}</span><div className="text-[11px] text-faint">{s.state || "Not in the GSTIN list"}</div></td>
                    <td className="num">{rupees(s.b2c.sales)}</td><td className="num">{rupees(s.b2c.returns)}</td><td className="num">{rupees(s.b2b.sales)}</td><td className="num">{rupees(s.b2b.returns)}</td>
                    <td className="num">{rupees(s.b2c.tax + s.b2b.tax)}</td><td className="num">{rupees(s.b2c.tcs + s.b2b.tcs)}</td><td className="num">{rupees(s.b2c.tds + s.b2b.tds)}</td>
                    <td className="num">{count(s.b2c.invoices + s.b2b.invoices)}</td><td className="num">{count(s.b2c.creditNotes + s.b2b.creditNotes)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">Values exclude GST unless stated. Returns include orders cancelled after the invoice was raised (Flipkart issues a credit note for both). A return is counted in the month of its credit note, not of the original sale.</p>
          </Section>

          <Section title="By state of delivery and GST rate" sub="Place of supply, for GSTR-1 (B2C). Delivery in your own state is CGST + SGST; other states are IGST.">
            <TaxTable rows={byState} label="State" />
          </Section>

          <Section title="By HSN code" sub="HSN-wise summary for GSTR-1.">
            <TaxTable rows={byHsn} label="HSN" />
          </Section>
        </>
      )}

      <Section title="Flipkart GST reports" sub="The original Sales report files downloaded from Seller Hub.">
        {!files.length ? <Empty>No Sales report files for this month yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>File</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.id}><td className="break-all text-xs">{f.file_name}</td><td className="text-muted">{dateLabel(f.created_at)}</td>
                <td><a href={fileHref(f.storage_path)} className="text-xs font-semibold text-brand hover:underline">Download</a></td></tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      <Section title="Flipkart tax invoices and credit notes" sub="For commission, fixed fee, shipping and Flipkart Ads. Claim the GST on these as input credit.">
        {!docs.length ? <Empty>No Flipkart invoices for this month yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Number</th><th>Date</th><th>Type</th><th className="num">Ads</th><th className="num">Fees</th><th className="num">Excl. GST</th><th className="num">GST</th><th className="num">Total</th><th></th></tr></thead>
              <tbody>{docs.map((d) => (
                <tr key={d.number}>
                  <td className="whitespace-nowrap font-mono text-xs">{d.number}{d.original_number && <div className="font-sans text-[11px] text-faint">on {d.original_number}</div>}</td>
                  <td className="whitespace-nowrap">{dateLabel(d.invoice_date)}</td>
                  <td>{d.doc_type === "credit_note" ? <StatusPill tone="blue">Credit note</StatusPill> : <StatusPill tone="grey">Invoice</StatusPill>}</td>
                  <td className="num">{d.ads ? rupees(d.ads, 2) : "–"}</td><td className="num">{rupees(d.base_amount - d.ads, 2)}</td>
                  <td className="num">{rupees(d.base_amount, 2)}</td><td className="num">{rupees(d.gst, 2)}</td><td className="num">{rupees(d.total, 2)}</td>
                  <td>{d.storage_path && <a href={fileHref(d.storage_path)} className="text-xs font-semibold text-brand hover:underline">PDF</a>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="num">{rupees(docs.reduce((s, d) => s + d.base_amount, 0), 2)}</td><td className="num">{rupees(feeGst, 2)}</td><td className="num">{rupees(docs.reduce((s, d) => s + d.total, 0), 2)}</td><td></td></tr></tfoot>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

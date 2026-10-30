import Link from "next/link";
import { Download } from "lucide-react";
import { Empty, KpiRupees, PageHeader, Section, StatusPill } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { dateLabel, monthLabel, rupees } from "@/lib/format";
import { gstMonth, gstMonths } from "@/lib/gst";
import { REPORT_LABEL, type ReportType } from "@/lib/parsers";
import { notFound } from "next/navigation";

export const metadata = { title: "GST & documents" };

export default async function GstPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  if (account.marketplace === "FirstCry") notFound(); // FirstCry has no ads or GST document reports here yet
  const months = await gstMonths(account.id);
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) && months.includes(`${sp.month}-01`) ? `${sp.month}-01` : months[0];
  const base = `/a/${account.id}/gst`;
  const fileHref = (path: string) => `/api/a/${account.id}/files?path=${encodeURIComponent(path)}`;

  if (!month) {
    return (
      <>
        <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="GST & documents" />
        <div className="card"><Empty>No GST reports or Amazon invoices yet. {viewer.kind === "team" ? <Link className="font-semibold text-brand underline" href={`/a/${account.id}/uploads`}>Upload the monthly MTR reports and invoices</Link> : "Pexeta uploads them every month."}</Empty></div>
      </>
    );
  }
  const { summaries, docs, files } = await gstMonth(account.id, account.client_id, month);
  const sum = (f: (s: (typeof summaries)[number]) => number) => summaries.reduce((a, s) => a + f(s), 0);

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title={`GST & documents: ${monthLabel(month)}`}
        sub="Sales as reported by Amazon in the Merchant Tax Reports, and Amazon's tax invoices for its fees and ads, by GST registration. Download everything for your auditor in one ZIP."
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

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiRupees label="Taxable sales (B2C + B2B)" value={sum((s) => s.b2c.sales + s.b2b.sales - s.b2c.returns - s.b2b.returns)} sub="Net of returns" />
        <KpiRupees label="Output GST" value={sum((s) => s.b2c.tax + s.b2b.tax)} />
        <KpiRupees label="Input GST on Amazon fees" value={sum((s) => s.feeGst)} sub={`${docs.length} invoices and credit notes`} />
        <KpiRupees label="TCS collected by Amazon" value={sum((s) => s.b2c.tcs + s.b2b.tcs)} />
      </div>

      <Section title="By GST registration">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>GSTIN</th><th className="num">B2C sales</th><th className="num">B2C returns</th><th className="num">B2B sales</th><th className="num">B2B returns</th><th className="num">Output GST</th><th className="num">TCS</th><th className="num">Stock sent out</th><th className="num">Stock received</th><th className="num">Moved within GSTIN</th><th className="num">Amazon fees</th><th className="num">Input GST</th></tr></thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.gstin}>
                  <td className="whitespace-nowrap"><span className="font-mono text-xs">{s.gstin}</span><div className="text-[11px] text-faint">{s.state || "Not in the GSTIN list"}</div></td>
                  <td className="num">{rupees(s.b2c.sales)}</td><td className="num">{rupees(s.b2c.returns)}</td>
                  <td className="num">{rupees(s.b2b.sales)}</td><td className="num">{rupees(s.b2b.returns)}</td>
                  <td className="num">{rupees(s.b2c.tax + s.b2b.tax)}</td><td className="num">{rupees(s.b2c.tcs + s.b2b.tcs)}</td>
                  <td className="num">{rupees(s.transfersOut)}</td><td className="num">{rupees(s.transfersIn)}</td><td className="num">{rupees(s.transfersWithin)}</td>
                  <td className="num">{rupees(s.fees)}</td><td className="num">{rupees(s.feeGst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-faint">Values exclude GST unless stated. Stock transfers between your own registrations are shown for the e-way bill and ITC trail; they are not sales. Refunds of invoices from earlier months are counted in the month Amazon reports them.</p>
      </Section>

      <Section title="Amazon GST reports" sub="The original files downloaded from Seller Central.">
        {!files.length ? <Empty>No MTR files for this month yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Report</th><th>File</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.id}><td>{REPORT_LABEL[f.report_type as ReportType] ?? f.report_type}</td><td className="break-all text-xs">{f.file_name}</td><td className="text-muted">{dateLabel(f.created_at)}</td>
                <td><a href={fileHref(f.storage_path)} className="text-xs font-semibold text-brand hover:underline">Download</a></td></tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      <Section title="Amazon tax invoices and credit notes" sub="For selling fees, FBA, Easy Ship and advertising. Claim the GST on these as input credit.">
        {!docs.length ? <Empty>No invoices for this month yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Number</th><th>Date</th><th>Type</th><th>For</th><th>Your GSTIN</th><th className="num">Fees</th><th className="num">GST</th><th className="num">Total</th><th></th></tr></thead>
              <tbody>{docs.map((d) => (
                <tr key={d.number}>
                  <td className="whitespace-nowrap font-mono text-xs">{d.number}</td><td className="whitespace-nowrap">{dateLabel(d.doc_date)}</td>
                  <td>{d.doc_type === "credit_note" ? <StatusPill tone="blue">Credit note</StatusPill> : <StatusPill tone="grey">Invoice</StatusPill>}</td>
                  <td>{d.category}</td><td className="font-mono text-xs">{d.seller_gstin}</td>
                  <td className="num">{rupees(d.fees, 2)}</td><td className="num">{rupees(d.gst, 2)}</td><td className="num">{rupees(d.total, 2)}</td>
                  <td>{d.storage_path && <a href={fileHref(d.storage_path)} className="text-xs font-semibold text-brand hover:underline">PDF</a>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="num">{rupees(docs.reduce((s, d) => s + d.fees, 0), 2)}</td><td className="num">{rupees(docs.reduce((s, d) => s + d.gst, 0), 2)}</td><td className="num">{rupees(docs.reduce((s, d) => s + d.total, 0), 2)}</td><td></td></tr></tfoot>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

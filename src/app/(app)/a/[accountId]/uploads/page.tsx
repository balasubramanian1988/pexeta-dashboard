import { PageHeader, Section, StatusPill } from "@/components/ui";
import { getAccount, requireTeam } from "@/lib/auth";
import { getFreshness } from "@/lib/data";
import { dateLabel, dateTimeLabel } from "@/lib/format";
import { addDays, todayIst } from "@/lib/period";
import { REPORT_LABEL, type ReportType } from "@/lib/parsers";
import { createClient } from "@/lib/supabase/server";
import Uploader from "./Uploader";

export const metadata = { title: "Upload reports" };

// What to download from Seller Central, and how often. Paths as they appear in Seller Central (India), Oct 2026.
const CHECKLIST: { type: ReportType; when: string; where: string }[] = [
  { type: "unified_transactions", when: "Daily", where: "Payments › Reports Repository › Transaction: Custom Unified, month to date" },
  { type: "orders", when: "Daily", where: "Reports › Fulfilment › All Orders, last 7 days" },
  { type: "business_child", when: "Daily", where: "Reports › Business Reports › By ASIN › Detail Page Sales and Traffic by Child Item, yesterday" },
  { type: "fba_inventory", when: "Daily", where: "Reports › Fulfilment › Manage FBA Inventory" },
  { type: "listings", when: "Daily", where: "Inventory › Inventory Reports › Active Listings Report" },
  { type: "sp_advertised", when: "Daily", where: "Advertising › Measurement & Reporting › Sponsored Products › Advertised product, daily" },
  { type: "sd_advertised", when: "Daily", where: "Advertising › Sponsored Display › Advertised product, daily" },
  { type: "sb_keyword", when: "Daily", where: "Advertising › Sponsored Brands › Keyword, daily" },
  { type: "sb_purchases", when: "Daily", where: "Advertising › Sponsored Brands › Attributed purchases, daily" },
  { type: "returns", when: "Weekly", where: "Reports › Fulfilment › Customer Returns" },
  { type: "mtr_b2c", when: "Monthly", where: "Reports › Tax Document Library › MTR B2C (ZIP as downloaded)" },
  { type: "mtr_b2b", when: "Monthly", where: "Reports › Tax Document Library › MTR B2B" },
  { type: "stock_transfer", when: "Monthly", where: "Reports › Tax Document Library › Stock Transfer report" },
  { type: "tax_document", when: "Monthly", where: "Reports › Tax Document Library › Seller Fee Tax Invoices, and the Advertising invoice (PDFs)" },
];

// FirstCry vendor panel downloads (Oct 2026). Overlapping date ranges are fine: rows are keyed, so nothing double counts.
const FIRSTCRY_CHECKLIST: { type: ReportType; when: string; where: string }[] = [
  { type: "fc_sales", when: "Daily", where: "Sales report (file name starts \"dashboardsale\"), last 7 days. Gives units and orders at MRP." },
  { type: "fc_recon", when: "Weekly", where: "Vendor Reconciliation, order dates covering the last 45 days. Gives what FirstCry pays (base cost), deliveries, payment advices and RTO / return debits. Re-downloading older weeks updates their status." },
  { type: "fc_returns", when: "Weekly", where: "Sale Return data, last 30 days. Gives customer return reasons." },
  { type: "fc_products", when: "Monthly, and whenever products, MRP or GST change", where: "All Product data. Gives product names, style codes, MRP and GST rates." },
];

// Myntra Partner Portal downloads (Oct 2026). Overlapping dates are fine: rows are keyed by order line.
const MYNTRA_CHECKLIST: { type: ReportType; when: string; where: string }[] = [
  { type: "my_orders", when: "Daily", where: "MDirect Orders report, last 7 days (CSV). Orders, status, customer price, Myntra margin, cancellation reasons." },
  { type: "my_settlement", when: "Weekly", where: "Settlement report (file \"SellerYearMonthWeekKey…\"), current and previous month, both the settled and the unsettled file. Payout per order, commission, shipping, UTRs; also brings the non-order deductions." },
  { type: "my_returns", when: "Weekly", where: "MDirect Returns report, last 30 days (CSV). RTOs and customer returns with reasons." },
  { type: "my_invoice", when: "Monthly", where: "Tax invoices (PDF): the \"Marketing Claim\" ads invoice every month, plus commission, logistics and MDirect invoices for GST." },
];

export default async function UploadsPage({ params }: { params: Promise<{ accountId: string }> }) {
  await requireTeam();
  const { accountId } = await params;
  const account = await getAccount(accountId);
  const sb = await createClient();
  const [fresh, { data: recent }] = await Promise.all([
    getFreshness(account.id),
    sb.from("sd_uploads").select("id, report_type, file_name, period_start, period_end, rows_saved, status, message, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(40),
  ]);
  const yesterday = addDays(todayIst(), -1);
  const fc = account.marketplace === "FirstCry";
  const my = account.marketplace === "Myntra";

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Upload reports" sub={`Seller ID ${account.seller_id || "not set"}. Re-uploading a report, or one that overlaps an earlier one, updates the data without double counting.`} />
      <Section title="Upload"><Uploader accountId={account.id} defaultDate={yesterday} marketplace={account.marketplace} /></Section>

      <Section title="What to upload" sub={fc ? "Download from the FirstCry vendor panel. Upload the files exactly as downloaded (XLSX)." : my ? "Download from the Myntra Partner Portal. Upload the files exactly as downloaded: do not open and re-save CSVs in Excel, which turns order IDs into numbers like 1.00366E+11." : "Download from Seller Central with this account selected."}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Report</th><th>How often</th><th>{fc || my ? "What to download" : "Where in Seller Central"}</th><th>Data up to</th></tr></thead>
            <tbody>
              {(fc ? FIRSTCRY_CHECKLIST : my ? MYNTRA_CHECKLIST : CHECKLIST).map((c) => {
                const f = fresh[c.type];
                const stale = c.when === "Daily" && (!f?.periodEnd || f.periodEnd < addDays(yesterday, -1));
                return (
                  <tr key={c.type}>
                    <td className="whitespace-nowrap font-medium">{REPORT_LABEL[c.type]}</td><td>{c.when}</td><td className="text-xs text-muted">{c.where}</td>
                    <td className="whitespace-nowrap">{f ? (f.periodEnd ? dateLabel(f.periodEnd) : dateLabel(f.uploadedAt)) : "–"} {stale && <StatusPill tone="amber">Due</StatusPill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent uploads">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>When</th><th>Report</th><th>File</th><th>Covers</th><th className="num">Rows</th><th>Status</th></tr></thead>
            <tbody>
              {(recent ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap text-muted">{dateTimeLabel(u.created_at)}</td>
                  <td>{REPORT_LABEL[u.report_type as ReportType] ?? "Not recognised"}</td>
                  <td className="max-w-64 break-all text-xs">{u.file_name}</td>
                  <td className="whitespace-nowrap text-xs">{u.period_start ? `${dateLabel(u.period_start)}${u.period_end !== u.period_start ? ` – ${dateLabel(u.period_end)}` : ""}` : "–"}</td>
                  <td className="num">{u.rows_saved.toLocaleString("en-IN")}</td>
                  <td className="text-xs">{u.status === "done" ? <StatusPill tone="green">Saved</StatusPill> : u.status === "failed" ? <StatusPill tone="red">Failed</StatusPill> : <StatusPill tone="grey">Processing</StatusPill>}{u.message && <div className="mt-1 max-w-72 text-muted">{u.message}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

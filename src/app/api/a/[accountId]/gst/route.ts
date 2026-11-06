// One ZIP per month for the auditor: Amazon's MTR files, every fee invoice / credit note PDF filed by GSTIN,
// and a summary CSV.
import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { getAccount } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fkGstMonth, gstMonth } from "@/lib/gst";

export const runtime = "nodejs";
export const maxDuration = 120;

const csvCell = (v: string | number) => (typeof v === "number" ? v.toFixed(2) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const account = await getAccount(accountId);
  const m = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  const month = `${m}-01`;
  if (account.marketplace === "Flipkart") return flipkartPack(account, m, month);
  const { summaries, docs, files } = await gstMonth(account.id, account.client_id, month);
  const admin = createAdminClient();
  const out: Record<string, Uint8Array> = {};
  const missing: string[] = [];

  const fetchFile = async (path: string) => {
    const { data } = await admin.storage.from("sd-files").download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  };
  for (const f of files) {
    const bytes = await fetchFile(f.storage_path);
    const stored = f.storage_path.split("/").pop()!.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}-/, "");
    if (bytes) out[`1 Amazon GST reports (MTR)/${stored}`] = bytes; else missing.push(f.file_name);
  }
  for (const d of docs) {
    if (!d.storage_path) { missing.push(`${d.number}.pdf`); continue; }
    const bytes = await fetchFile(d.storage_path);
    if (bytes) out[`2 Amazon fee invoices/${d.seller_gstin || "GSTIN unknown"}/${d.doc_date} ${d.number}.pdf`] = bytes; else missing.push(`${d.number}.pdf`);
  }

  out["3 Summary by GSTIN.csv"] = strToU8(csv([
    ["GSTIN", "State", "B2C sales", "B2C returns", "B2C GST", "B2B sales", "B2B returns", "B2B GST", "TCS", "Stock sent out", "Stock received", "Moved within GSTIN", "Amazon fees", "Input GST on fees", "Fee documents"],
    ...summaries.map((s) => [s.gstin, s.state, s.b2c.sales, s.b2c.returns, s.b2c.tax, s.b2b.sales, s.b2b.returns, s.b2b.tax, s.b2c.tcs + s.b2b.tcs, s.transfersOut, s.transfersIn, s.transfersWithin, s.fees, s.feeGst, String(s.docs)]),
  ]));
  out["4 Amazon fee invoices list.csv"] = strToU8(csv([
    ["Number", "Date", "Type", "Category", "Seller GSTIN", "Fees", "GST", "Total"],
    ...docs.map((d) => [d.number, d.doc_date, d.doc_type === "credit_note" ? "Credit note" : "Invoice", d.category, d.seller_gstin, d.fees, d.gst, d.total]),
  ]));
  out["README.txt"] = strToU8(
    `${account.client_name}: ${account.marketplace} GST pack for ${m}\r\nPrepared by the Pexeta Seller Dashboard on ${new Date().toISOString().slice(0, 10)}.\r\n\r\n` +
    `1  Merchant Tax Reports (B2C, B2B, stock transfer) as downloaded from Amazon Seller Central.\r\n` +
    `2  Amazon's tax invoices and credit notes for its fees and advertising, filed by your GSTIN.\r\n` +
    `3  Summary of sales, GST, TCS, stock transfers and fee GST by GSTIN, from the files above. Amounts exclude GST unless the column says GST.\r\n` +
    `4  List of the fee invoices.\r\n` +
    (missing.length ? `\r\nNot included (file not stored): ${missing.join(", ")}\r\n` : ""),
  );

  const zip = zipSync(out, { level: 6 });
  const name = `${account.client_name.replace(/[^A-Za-z0-9]+/g, "-")}-${account.marketplace}-GST-${m}.zip`;
  return new NextResponse(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}

/** Flipkart: the Sales report files, Flipkart's fee invoices and credit notes, and summaries for GSTR-1 and 3B. */
async function flipkartPack(account: Awaited<ReturnType<typeof getAccount>>, m: string, month: string) {
  const { summaries, byState, byHsn, docs, files } = await fkGstMonth(account.id, account.client_id, month);
  const admin = createAdminClient();
  const out: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  const fetchFile = async (path: string) => {
    const { data } = await admin.storage.from("sd-files").download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  };
  for (const f of files) {
    const bytes = await fetchFile(f.storage_path);
    const stored = f.storage_path.split("/").pop()!.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}-/, "");
    if (bytes) out[`1 Flipkart Sales report/${stored}`] = bytes; else missing.push(f.file_name);
  }
  for (const d of docs) {
    if (!d.storage_path) { missing.push(`${d.number}.pdf`); continue; }
    const bytes = await fetchFile(d.storage_path);
    if (bytes) out[`2 Flipkart fee invoices/${d.invoice_date} ${d.number}.pdf`] = bytes; else missing.push(`${d.number}.pdf`);
  }
  out["3 Summary by GSTIN.csv"] = strToU8(csv([
    ["GSTIN", "State", "B2C sales", "B2C returns", "B2C GST", "B2B sales", "B2B returns", "B2B GST", "TCS", "TDS", "Invoices", "Credit notes"],
    ...summaries.map((s) => [s.gstin, s.state, s.b2c.sales, s.b2c.returns, s.b2c.tax, s.b2b.sales, s.b2b.returns, s.b2b.tax, s.b2c.tcs + s.b2b.tcs, s.b2c.tds + s.b2b.tds, String(s.b2c.invoices + s.b2b.invoices), String(s.b2c.creditNotes + s.b2b.creditNotes)]),
  ]));
  const taxRows = (rows: typeof byState) => rows.map((r) => [r.label, `${r.rate}%`, String(r.quantity), r.taxable, r.igst, r.cgst, r.sgst, r.igst + r.cgst + r.sgst]);
  out["4 By state of delivery and rate.csv"] = strToU8(csv([["State", "GST rate", "Units (net)", "Taxable value", "IGST", "CGST", "SGST", "Total GST"], ...taxRows(byState)]));
  out["5 By HSN.csv"] = strToU8(csv([["HSN", "GST rate", "Units (net)", "Taxable value", "IGST", "CGST", "SGST", "Total GST"], ...taxRows(byHsn)]));
  out["6 Flipkart fee invoices list.csv"] = strToU8(csv([
    ["Number", "Date", "Type", "Original invoice", "Ads", "Commission", "Fixed fee", "Shipping", "Other", "Excl. GST", "GST", "Total"],
    ...docs.map((d) => [d.number, d.invoice_date, d.doc_type === "credit_note" ? "Credit note" : "Invoice", d.original_number, d.ads, d.commission, d.fixed_fee, d.shipping, d.other, d.base_amount, d.gst, d.total]),
  ]));
  out["README.txt"] = strToU8(
    `${account.client_name}: Flipkart GST pack for ${m}\r\nPrepared by the Pexeta Seller Dashboard on ${new Date().toISOString().slice(0, 10)}.\r\n\r\n` +
    `1  Flipkart Sales report(s) as downloaded from Seller Hub (Reports > Tax reports).\r\n` +
    `2  Flipkart's tax invoices and credit notes for its fees and Flipkart Ads.\r\n` +
    `3  Sales, returns, GST, TCS and TDS by your GSTIN, by invoice / credit note date. Amounts exclude GST unless the column says GST.\r\n` +
    `4  Taxable value and GST by state of delivery (place of supply) and rate.\r\n` +
    `5  HSN-wise summary.\r\n` +
    `6  List of Flipkart's invoices.\r\n` +
    (missing.length ? `\r\nNot included (file not stored): ${missing.join(", ")}\r\n` : ""),
  );
  const zip = zipSync(out, { level: 6 });
  const name = `${account.client_name.replace(/[^A-Za-z0-9]+/g, "-")}-Flipkart-GST-${m}.zip`;
  return new NextResponse(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}

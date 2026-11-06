// GST tab data: sales (MTR B2C/B2B), stock transfers and Amazon fee invoices for one month, by GSTIN.
import "server-only";
import { fetchAll } from "./data";
import { createClient } from "./supabase/server";

export type GstinSummary = {
  gstin: string; state: string;
  b2c: { sales: number; returns: number; tax: number; tcs: number; invoices: number };
  b2b: { sales: number; returns: number; tax: number; tcs: number; invoices: number };
  transfersOut: number; transfersIn: number; transfersWithin: number;
  fees: number; feeGst: number; docs: number;
};
export type TaxDoc = { number: string; doc_type: string; category: string; doc_date: string; seller_gstin: string; fees: number; gst: number; total: number; storage_path: string };
export type GstFile = { id: string; report_type: string; file_name: string; storage_path: string; created_at: string };

export const GST_REPORTS = ["mtr_b2c", "mtr_b2b", "stock_transfer"];

type Sb = Awaited<ReturnType<typeof createClient>>;

export async function gstMonths(accountId: string, client?: Sb): Promise<string[]> {
  const sb = client ?? (await createClient());
  const [ups, docs] = await Promise.all([
    sb.from("sd_uploads").select("period_start, period_end").eq("account_id", accountId).eq("status", "done").in("report_type", [...GST_REPORTS, "tax_document"]).limit(2000),
    sb.from("sd_tax_documents").select("month").eq("account_id", accountId).limit(5000),
  ]);
  const set = new Set<string>();
  for (const u of ups.data ?? []) for (const d of [u.period_start, u.period_end]) if (d) set.add(`${String(d).slice(0, 7)}-01`);
  for (const d of docs.data ?? []) set.add(String(d.month).slice(0, 10));
  return [...set].sort().reverse();
}

export async function gstMonth(accountId: string, clientId: string, month: string, client?: Sb) {
  const sb = client ?? (await createClient());
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  type Line = { kind: "B2C" | "B2B"; seller_gstin: string; transaction_type: string; invoice_number: string; taxable_value: number; total_tax: number; tcs: number };
  type Transfer = { supplier_gstin: string; receiver_gstin: string; taxable_value: number; transaction_type: string };
  const [lines, transfers, docs, gstins, files] = await Promise.all([
    fetchAll<Line>((f, t) => sb.from("sd_tax_lines").select("kind, seller_gstin, transaction_type, invoice_number, taxable_value, total_tax, tcs").eq("account_id", accountId).eq("month", month).order("row_hash").range(f, t)),
    fetchAll<Transfer>((f, t) => sb.from("sd_stock_transfers").select("supplier_gstin, receiver_gstin, taxable_value, transaction_type").eq("account_id", accountId).eq("month", month).order("row_hash").range(f, t)),
    fetchAll<TaxDoc>((f, t) => sb.from("sd_tax_documents").select("number, doc_type, category, doc_date, seller_gstin, fees, gst, total, storage_path").eq("account_id", accountId).eq("month", month).order("doc_date").order("number").range(f, t)),
    sb.from("sd_gstins").select("gstin, state").eq("client_id", clientId).order("state"),
    sb.from("sd_uploads").select("id, report_type, file_name, storage_path, created_at").eq("account_id", accountId).eq("status", "done").in("report_type", GST_REPORTS).lte("period_start", end).gte("period_end", month).order("created_at", { ascending: false }),
  ]);

  const map = new Map<string, GstinSummary>();
  const blank = () => ({ sales: 0, returns: 0, tax: 0, tcs: 0, invoices: 0 });
  const get = (g: string) => {
    let x = map.get(g);
    if (!x) map.set(g, (x = { gstin: g, state: "", b2c: blank(), b2b: blank(), transfersOut: 0, transfersIn: 0, transfersWithin: 0, fees: 0, feeGst: 0, docs: 0 }));
    return x;
  };
  for (const g of gstins.data ?? []) get(g.gstin).state = g.state;
  const invoices = new Map<string, Set<string>>();
  for (const l of lines) {
    const s = get(l.seller_gstin)[l.kind === "B2C" ? "b2c" : "b2b"];
    const v = Number(l.taxable_value);
    if (v >= 0) s.sales += v; else s.returns += -v;
    s.tax += Number(l.total_tax);
    s.tcs += Number(l.tcs);
    if (l.transaction_type === "Shipment" && l.invoice_number) {
      const k = `${l.seller_gstin}|${l.kind}`;
      if (!invoices.has(k)) invoices.set(k, new Set());
      invoices.get(k)!.add(l.invoice_number);
    }
  }
  for (const [k, set] of invoices) { const [g, kind] = k.split("|"); get(g)[kind === "B2C" ? "b2c" : "b2b"].invoices = set.size; }
  for (const t of transfers) {
    const v = Number(t.taxable_value);
    if (t.supplier_gstin && t.supplier_gstin !== t.receiver_gstin) get(t.supplier_gstin).transfersOut += v;
    if (t.receiver_gstin && t.supplier_gstin !== t.receiver_gstin) get(t.receiver_gstin).transfersIn += v;
    if (t.supplier_gstin && t.supplier_gstin === t.receiver_gstin) get(t.supplier_gstin).transfersWithin += v;
  }
  const docsNum = docs.map((d) => ({ ...d, fees: Number(d.fees), gst: Number(d.gst), total: Number(d.total) }));
  for (const d of docsNum) { const x = get(d.seller_gstin); x.fees += d.fees; x.feeGst += d.gst; x.docs++; }

  // Keep one entry per stored file (a ZIP can hold several reports).
  const seen = new Set<string>();
  const fileList = ((files.data ?? []) as GstFile[]).filter((f) => !seen.has(f.storage_path) && seen.add(f.storage_path));
  return { summaries: [...map.values()].sort((a, b) => a.state.localeCompare(b.state) || a.gstin.localeCompare(b.gstin)), docs: docsNum, files: fileList, end };
}

// ---------- Flipkart ----------
// From the Flipkart Sales report (Seller Hub › Reports › Tax reports): one row per sale, return and cancellation, each
// dated by its buyer invoice or credit note. The month is the invoice date's month, as for GSTR-1. Flipkart shows taxable
// value, GST and TCS as negative on returns and cancellations, but TDS as positive: TDS takes the event's sign here.
export type FkGstinSummary = {
  gstin: string; state: string;
  b2c: { sales: number; returns: number; tax: number; tcs: number; tds: number; invoices: number; creditNotes: number };
  b2b: { sales: number; returns: number; tax: number; tcs: number; tds: number; invoices: number; creditNotes: number };
};
export type FkGstRow = { key: string; label: string; rate: number; quantity: number; taxable: number; igst: number; cgst: number; sgst: number };
export type FkInvoiceDoc = { number: string; doc_type: string; invoice_date: string; original_number: string; ads: number; commission: number; fixed_fee: number; shipping: number; other: number; base_amount: number; gst: number; total: number; storage_path: string };

export async function fkGstMonths(accountId: string, client?: Sb): Promise<string[]> {
  const sb = client ?? (await createClient());
  const [first, last, docs] = await Promise.all([
    sb.from("sd_fk_sales").select("invoice_date").eq("account_id", accountId).not("invoice_date", "is", null).order("invoice_date", { ascending: true }).limit(1).maybeSingle(),
    sb.from("sd_fk_sales").select("invoice_date").eq("account_id", accountId).not("invoice_date", "is", null).order("invoice_date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sd_fk_invoices").select("invoice_date").eq("account_id", accountId).limit(5000),
  ]);
  const set = new Set<string>();
  const a = first.data?.invoice_date as string | undefined, b = last.data?.invoice_date as string | undefined;
  if (a && b) for (let m = `${a.slice(0, 7)}-01`; m <= b; m = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10)) set.add(m);
  for (const d of docs.data ?? []) set.add(`${String(d.invoice_date).slice(0, 7)}-01`);
  return [...set].sort().reverse();
}

export async function fkGstMonth(accountId: string, clientId: string, month: string, client?: Sb) {
  const sb = client ?? (await createClient());
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  type Line = { event_sub_type: string; seller_gstin: string; buyer_gstin: string; invoice_id: string; delivery_state: string; hsn: string; gst_rate: number; quantity: number; taxable_value: number; igst: number; cgst: number; sgst: number; tcs: number; tds: number };
  const [lines, docs, gstins, files] = await Promise.all([
    fetchAll<Line>((f, t) => sb.from("sd_fk_sales").select("event_sub_type, seller_gstin, buyer_gstin, invoice_id, delivery_state, hsn, gst_rate, quantity, taxable_value, igst, cgst, sgst, tcs, tds").eq("account_id", accountId).gte("invoice_date", month).lte("invoice_date", end).order("row_key").range(f, t)),
    fetchAll<FkInvoiceDoc>((f, t) => sb.from("sd_fk_invoices").select("number, doc_type, invoice_date, original_number, ads, commission, fixed_fee, shipping, other, base_amount, gst, total, storage_path").eq("account_id", accountId).gte("invoice_date", month).lte("invoice_date", end).order("invoice_date").order("number").range(f, t)),
    sb.from("sd_gstins").select("gstin, state").eq("client_id", clientId).order("state"),
    sb.from("sd_uploads").select("id, report_type, file_name, storage_path, created_at").eq("account_id", accountId).eq("status", "done").eq("report_type", "fk_sales").lte("period_start", end).gte("period_end", month).order("created_at", { ascending: false }),
  ]);
  const state = new Map((gstins.data ?? []).map((g) => [g.gstin as string, g.state as string]));
  const blank = () => ({ sales: 0, returns: 0, tax: 0, tcs: 0, tds: 0, invoices: 0, creditNotes: 0 });
  const by = new Map<string, FkGstinSummary>();
  const byState = new Map<string, FkGstRow>(), byHsn = new Map<string, FkGstRow>();
  const docSeen = new Set<string>();
  const n = (v: unknown) => Number(v) || 0;
  for (const l of lines) {
    const g = l.seller_gstin || "GSTIN not in the report";
    let s = by.get(g);
    if (!s) by.set(g, (s = { gstin: g, state: state.get(g) ?? "", b2c: blank(), b2b: blank() }));
    const x = l.buyer_gstin ? s.b2b : s.b2c;
    const v = n(l.taxable_value), sign = v < 0 ? -1 : 1;
    const tax = n(l.igst) + n(l.cgst) + n(l.sgst);
    if (v >= 0) x.sales += v; else x.returns += -v;
    x.tax += tax; x.tcs += n(l.tcs); x.tds += sign * Math.abs(n(l.tds));
    if (l.invoice_id && !docSeen.has(l.invoice_id)) { docSeen.add(l.invoice_id); if (v >= 0) x.invoices++; else x.creditNotes++; }
    const rate = n(l.gst_rate);
    for (const [m, key, label] of [[byState, `${l.delivery_state}|${rate}`, l.delivery_state || "State not given"], [byHsn, `${l.hsn}|${rate}`, l.hsn || "HSN not given"]] as const) {
      let r = m.get(key);
      if (!r) m.set(key, (r = { key, label, rate, quantity: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 }));
      r.quantity += sign * Math.abs(n(l.quantity)); r.taxable += v; r.igst += n(l.igst); r.cgst += n(l.cgst); r.sgst += n(l.sgst);
    }
  }
  const sortRows = (m: Map<string, FkGstRow>) => [...m.values()].sort((a, b) => a.label.localeCompare(b.label) || a.rate - b.rate);
  const seen = new Set<string>();
  const fileList = ((files.data ?? []) as GstFile[]).filter((f) => !seen.has(f.storage_path) && seen.add(f.storage_path));
  const docsNum = docs.map((d) => ({ ...d, ads: n(d.ads), commission: n(d.commission), fixed_fee: n(d.fixed_fee), shipping: n(d.shipping), other: n(d.other), base_amount: n(d.base_amount), gst: n(d.gst), total: n(d.total) }));
  return { summaries: [...by.values()].sort((a, b) => a.gstin.localeCompare(b.gstin)), byState: sortRows(byState), byHsn: sortRows(byHsn), docs: docsNum, files: fileList, end, lines: lines.length };
}

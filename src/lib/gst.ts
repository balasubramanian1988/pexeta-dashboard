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

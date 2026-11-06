// Entry point: file bytes in, recognised and mapped reports out.
import { detectPdf, detectSheet, detectTable, type ReportType } from "./detect";
import { mapTable, taxDocument, type Parsed } from "./map";
import { fkInvoice, fkSettlementOther } from "./flipkart";
import { myInvoice } from "./myntra";
import { readUpload } from "./read";

export type ParseResult =
  | ({ ok: true; fileName: string; pdf?: Uint8Array } & Parsed)
  | { ok: false; fileName: string; reason: string; type?: ReportType };

export async function parseUpload(fileName: string, data: Uint8Array, reportDate: string | null = null): Promise<ParseResult[]> {
  const files = await readUpload(fileName, data);
  const out: ParseResult[] = [];
  for (const f of files) {
    if (f.kind === "unsupported") { out.push({ ok: false, fileName: f.fileName, reason: f.reason }); continue; }
    if (f.kind === "pdf") {
      const d = detectPdf(f.text);
      if (!d.type) { out.push({ ok: false, fileName: f.fileName, reason: d.reason }); continue; }
      out.push({ ok: true, fileName: f.fileName, pdf: f.data, ...(d.type === "my_invoice" ? myInvoice(f.text, f.fileName) : d.type === "fk_invoice" ? fkInvoice(f.text) : taxDocument(f.text, f.fileName)) });
      continue;
    }
    const sheet = f.fileName.includes(" › ") ? f.fileName.split(" › ").pop()! : null;
    if (!f.table.rows.length && sheet) continue; // an empty sheet in a multi-sheet workbook
    const d = (sheet ? detectSheet(sheet, f.table.headers) : null) ?? detectTable(f.table.headers);
    if (!d.type) { if (!d.skip) out.push({ ok: false, fileName: f.fileName, reason: d.reason }); continue; }
    if (d.type === "fk_settlement_other") { const p = fkSettlementOther(f.table, sheet ?? "Other"); if (p.rows.length) out.push({ ok: true, fileName: f.fileName, ...p }); continue; }
    out.push({ ok: true, fileName: f.fileName, ...mapTable(d.type, f.table, { reportDate, fileName: f.fileName }) });
  }
  return out;
}

export { REPORT_LABEL, NEEDS_REPORT_DATE, AMAZON_REPORTS, FIRSTCRY_REPORTS, MYNTRA_REPORTS, FLIPKART_REPORTS, reportMarketplace, type ReportType } from "./detect";
export type { Parsed, DbRow } from "./map";

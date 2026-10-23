// Entry point: file bytes in, recognised and mapped reports out.
import { detectPdf, detectTable, type ReportType } from "./detect";
import { mapTable, taxDocument, type Parsed } from "./map";
import { readUpload } from "./read";

export type ParseResult =
  | ({ ok: true; fileName: string; pdf?: Uint8Array } & Parsed)
  | { ok: false; fileName: string; reason: string; type?: ReportType };

export async function parseUpload(fileName: string, data: Uint8Array, reportDate: string | null = null): Promise<ParseResult[]> {
  const files = await readUpload(fileName, data);
  const out: ParseResult[] = [];
  for (const f of files) {
    if (f.kind === "pdf") {
      const d = detectPdf(f.text);
      if (!d.type) { out.push({ ok: false, fileName: f.fileName, reason: d.reason }); continue; }
      out.push({ ok: true, fileName: f.fileName, pdf: f.data, ...taxDocument(f.text, f.fileName) });
      continue;
    }
    const d = detectTable(f.table.headers);
    if (!d.type) { out.push({ ok: false, fileName: f.fileName, reason: d.reason }); continue; }
    out.push({ ok: true, fileName: f.fileName, ...mapTable(d.type, f.table, { reportDate, fileName: f.fileName }) });
  }
  return out;
}

export { REPORT_LABEL, NEEDS_REPORT_DATE, type ReportType } from "./detect";
export type { Parsed, DbRow } from "./map";

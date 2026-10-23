// Turns an uploaded file (CSV, tab-separated TXT, XLSX, ZIP, PDF) into header + rows.
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import type { Cell, Row } from "./util";

export type Table = { headers: string[]; rows: Row[] };
export type ReadFile =
  | { kind: "table"; fileName: string; table: Table }
  | { kind: "pdf"; fileName: string; text: string; data: Uint8Array };

const KNOWN_HEADER_STARTS = ["date/time", "amazon-order-id", "item-name", "sku", "(parent) asin", "date", "return-date",
  "seller gstin", "gstin of receiver", "invoice number"];

/** Some Amazon CSVs start with explanation lines; find the real header row. */
function findHeaderLine(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const first = lines[i].replace(/^﻿/, "").split(/[,\t]/)[0].replace(/"/g, "").trim().toLowerCase();
    const cols = lines[i].split(/[,\t]/).length;
    if (cols >= 5 && KNOWN_HEADER_STARTS.includes(first)) return i;
  }
  return 0;
}

function readDelimited(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);
  const start = findHeaderLine(lines);
  const body = lines.slice(start).join("\n");
  const tab = (lines[start] ?? "").split("\t").length > (lines[start] ?? "").split(",").length;
  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: tab ? "\t" : ",",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  return { headers, rows: parsed.data as Row[] };
}

async function readXlsx(buf: Uint8Array): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  // exceljs accepts a Node Buffer; copy so we don't depend on the caller's ArrayBuffer offset.
  await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers: string[] = [];
  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    const values = (row.values as unknown[]).slice(1); // exceljs rows are 1-based
    if (i === 1) {
      values.forEach((v) => headers.push(String(v ?? "").trim()));
      return;
    }
    const r: Row = {};
    headers.forEach((h, j) => {
      let v = values[j] as unknown;
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
        v = o.result ?? o.text ?? (o.richText ? o.richText.map((t) => t.text).join("") : "");
      }
      r[h] = v as Cell;
    });
    rows.push(r);
  });
  return { headers, rows };
}

/** PDF → text with one line per visual line, so label/value pairs stay together. */
async function readPdf(buf: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2; // tolerate tiny baseline differences
      const arr = lines.get(y) ?? [];
      arr.push({ x: item.transform[4], s: item.str });
      lines.set(y, arr);
    }
    [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => out.push(parts.sort((a, b) => a.x - b.x).map((t) => t.s).join("  ")));
  }
  return out.join("\n");
}

/** Reads one uploaded file. A ZIP can hold several reports, so this returns a list. */
export async function readUpload(fileName: string, data: Uint8Array): Promise<ReadFile[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    const files = unzipSync(data);
    const out: ReadFile[] = [];
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith("/") || name.startsWith("__MACOSX")) continue;
      out.push(...(await readUpload(name.split("/").pop() || name, content)));
    }
    return out;
  }
  if (lower.endsWith(".pdf")) { const copy = data.slice(); return [{ kind: "pdf", fileName, text: await readPdf(data), data: copy }]; }
  if (lower.endsWith(".xlsx")) return [{ kind: "table", fileName, table: await readXlsx(data) }];
  // .csv and Amazon's tab-separated .txt
  return [{ kind: "table", fileName, table: readDelimited(new TextDecoder("utf-8").decode(data)) }];
}

// Builds the All marketplaces Excel report: Summary, By marketplace, Products, Daily sales.
import ExcelJS from "exceljs";
import { brandTotals, findings, type Finding, type MarketSummary } from "@/lib/engine/brand";
import { eachDay } from "@/lib/engine/summaries";
import { dateLabel } from "@/lib/format";
import type { SearchResult } from "@/lib/engine/search";
import { THEME_LABEL, type ReturnsResult } from "@/lib/engine/returns";

const NAVY = "FF0B2A4A", ORANGE = "FFF2871E", ICE = "FFEEF4FA", RED_FILL = "FFFDECEC", GREEN = "FF1F7A4D", RED = "FFB42318", GREY = "FF64748B";
const FONT = "Arial";
const RS = '"₹"#,##0;[Red]-"₹"#,##0;"–"';
const PCT = '0.0%;[Red]-0.0%;"–"';
const INT = '#,##0;[Red]-#,##0;"–"';

type Cell = ExcelJS.CellValue;
const f = (formula: string, result: number): Cell => ({ formula, result });

function header(ws: ExcelJS.Worksheet, rowNo: number, labels: string[]) {
  const row = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", wrapText: true };
  });
  row.height = 30;
}

function title(ws: ExcelJS.Worksheet, text: string, sub: string, span: number) {
  ws.mergeCells(1, 1, 1, span);
  ws.getCell(1, 1).value = text;
  ws.getCell(1, 1).font = { name: FONT, bold: true, size: 15, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, span);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { name: FONT, size: 10, color: { argb: GREY } };
  ws.getRow(1).height = 24;
}

function fontAll(ws: ExcelJS.Worksheet) {
  ws.eachRow((row) => row.eachCell((c) => { c.font = { size: 10, ...c.font, name: FONT }; }));
}

function setup(ws: ExcelJS.Worksheet, landscape = true) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddFooter: "&L&8Pexeta Seller Dashboard&R&8Page &P of &N" };
}

export type BrandReportInput = {
  clientName: string; period: { from: string; to: string }; prevFrom: string; prevTo: string;
  markets: MarketSummary[]; extra: Finding[]; today?: string;
  search?: SearchResult | null;      // Amazon Brand Analytics: actions and progress, when uploaded
  returns?: ReturnsResult | null;    // why customers returned products, all marketplaces
  work?: { waiting: WorkLine[]; inProgress: WorkLine[]; completed: WorkLine[] } | null;   // client-visible Pexeta Ops tasks
};
type WorkLine = { ref: number; title: string; marketplace: string; need: string; due_date: string; done_at: string | null };

export function buildBrandWorkbook({ clientName, period, prevFrom, prevTo, markets, extra, today, search, returns, work }: BrandReportInput): ExcelJS.Workbook {
  const live = markets.filter((m) => m.hasData);
  const t = brandTotals(markets);
  const found = findings(markets, extra);
  const periodText = `${dateLabel(period.from)} to ${dateLabel(period.to)}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Pexeta Seller Dashboard";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  // ---------- Summary ----------
  const s = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  s.columns = [{ width: 34 }, { width: 18 }, { width: 16 }, { width: 50 }];
  title(s, `${clientName}: all marketplaces`, `${periodText}. Sales exclude GST. Prepared by Pexeta on ${dateLabel(today ?? new Date().toISOString().slice(0, 10))}.`, 4);
  header(s, 4, ["Headline", "Amount", "% of sales", "Note"]);
  const kpis: [string, number, boolean, string][] = [
    ["Net sales (excl. GST)", t.sales, false, t.change == null ? "No full previous period uploaded to compare with." : `${t.change >= 0 ? "Up" : "Down"} ${(Math.abs(t.change) * 100).toFixed(0)}% on ${dateLabel(prevFrom)} to ${dateLabel(prevTo)}.`],
    ["Marketplace fees", t.fees, true, "What the marketplaces keep: commission, shipping and other fees."],
    ["Ad spend", t.ads, true, t.adsMissing.length ? `Not included: ${t.adsMissing.join(", ")} (no ads report uploaded).` : ""],
    ["Product cost", t.productCost, true, "From product costs entered for the brand, or the default %."],
    ["Net profit", t.profit, true, "Net sales − fees − ads − product cost."],
  ];
  kpis.forEach(([label, v, pct, note], i) => {
    const r = 5 + i;
    s.getCell(r, 1).value = label;
    s.getCell(r, 2).value = v;
    s.getCell(r, 2).numFmt = RS;
    if (pct) { s.getCell(r, 3).value = f(`IF($B$5=0,0,B${r}/$B$5)`, t.sales ? v / t.sales : 0); s.getCell(r, 3).numFmt = PCT; }
    s.getCell(r, 4).value = note;
    s.getCell(r, 4).font = { color: { argb: GREY } };
    s.getCell(r, 4).alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    s.getRow(r).height = 26;
    s.getCell(r, 1).alignment = { vertical: "top" };
    s.getCell(r, 2).alignment = { vertical: "top" };
    s.getCell(r, 3).alignment = { vertical: "top" };
    if (i % 2) for (let c = 1; c <= 4; c++) s.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ICE } };
  });
  s.getCell(9, 1).font = { bold: true };
  s.getCell(9, 2).font = { bold: true, color: { argb: t.profit >= 0 ? GREEN : RED } };
  s.getCell(10, 1).value = "Units sold (after returns)";
  s.getCell(10, 2).value = t.units;
  s.getCell(10, 2).numFmt = INT;

  let r = 12;
  const block = (heading: string, color: string, items: typeof found) => {
    s.mergeCells(r, 1, r, 4);
    s.getCell(r, 1).value = heading;
    s.getCell(r, 1).font = { bold: true, size: 12, color: { argb: color } };
    s.getCell(r, 1).border = { bottom: { style: "thin", color: { argb: color } } };
    r++;
    if (!items.length) { s.getCell(r, 1).value = "Nothing stands out for these dates."; s.getCell(r, 1).font = { color: { argb: GREY } }; r += 2; return; }
    for (const it of items) {
      s.getCell(r, 1).value = it.title;
      s.getCell(r, 1).font = { bold: true };
      s.getCell(r, 1).alignment = { wrapText: true, vertical: "top" };
      s.mergeCells(r, 2, r, 4);
      s.getCell(r, 2).value = it.detail;
      s.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
      s.getRow(r).height = 30;
      r++;
    }
    r++;
  };
  block("What's working", GREEN, found.filter((x) => x.tone === "good"));
  block("Needs attention", RED, found.filter((x) => x.tone === "bad"));
  const notes = markets.flatMap((m) => m.notes.map((n) => `${m.marketplace}: ${n}`));
  if (notes.length) {
    s.getCell(r, 1).value = "Notes";
    s.getCell(r, 1).font = { bold: true, color: { argb: GREY } };
    r++;
    for (const n of notes) { s.mergeCells(r, 1, r, 4); s.getCell(r, 1).value = n; s.getCell(r, 1).font = { color: { argb: GREY }, size: 9 }; r++; }
  }
  setup(s, false);

  // ---------- By marketplace ----------
  const m = wb.addWorksheet("By marketplace", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  m.columns = [{ width: 16 }, { width: 14 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 13 }, { width: 9 }, { width: 13 }, { width: 9 }, { width: 14 }, { width: 14 }, { width: 9 }, { width: 14 }, { width: 10 }, { width: 44 }];
  title(m, `${clientName}: by marketplace`, `${periodText}. Previous period: ${dateLabel(prevFrom)} to ${dateLabel(prevTo)}.`, 15);
  header(m, 4, ["Marketplace", "Net sales", "Share", "Units", "Returns", "Fees", "Fees %", "Ads", "Ads %", "Product cost", "Profit", "Margin", "Previous sales", "Change", "Notes"]);
  const first = 5, last = first + live.length - 1, tot = last + 1;
  live.forEach((x: MarketSummary, i) => {
    const row = first + i;
    const vals: Cell[] = [
      x.marketplace, x.sales, f(`IF($B$${tot}=0,0,B${row}/$B$${tot})`, t.sales ? x.sales / t.sales : 0), x.units, x.returnRate ?? "–",
      x.fees, f(`IF(B${row}=0,0,F${row}/B${row})`, x.sales ? x.fees / x.sales : 0),
      x.ads ?? "no data", x.ads == null ? "–" : f(`IF(B${row}=0,0,H${row}/B${row})`, x.sales ? x.ads / x.sales : 0),
      x.productCost, x.profit, f(`IF(B${row}=0,0,K${row}/B${row})`, x.margin),
      x.prevSales ?? "–", x.prevSales ? f(`IF(M${row}=0,0,B${row}/M${row}-1)`, x.sales / x.prevSales - 1) : "–",
      x.notes.join(" "),
    ];
    m.getRow(row).values = vals;
    if (i % 2) for (let c = 1; c <= 15; c++) m.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ICE } };
    if (x.profit < 0) m.getCell(row, 11).font = { color: { argb: RED }, bold: true };
  });
  if (live.length) {
    const sum = (col: string, v: number) => f(`SUM(${col}${first}:${col}${last})`, v);
    m.getRow(tot).values = [
      "All marketplaces", sum("B", t.sales), f(`IF(B${tot}=0,0,1)`, t.sales ? 1 : 0), sum("D", t.units), "",
      sum("F", t.fees), f(`IF(B${tot}=0,0,F${tot}/B${tot})`, t.sales ? t.fees / t.sales : 0),
      sum("H", t.ads), f(`IF(B${tot}=0,0,H${tot}/B${tot})`, t.sales ? t.ads / t.sales : 0),
      sum("J", t.productCost), sum("K", t.profit), f(`IF(B${tot}=0,0,K${tot}/B${tot})`, t.margin),
      t.prevSales ?? "–", t.change == null ? "–" : f(`IF(M${tot}=0,0,B${tot}/M${tot}-1)`, t.change), "",
    ];
    for (let c = 1; c <= 15; c++) {
      const cell = m.getCell(tot, c);
      cell.font = { bold: true };
      cell.border = { top: { style: "thin", color: { argb: NAVY } }, bottom: { style: "double", color: { argb: NAVY } } };
    }
  }
  for (let row = first; row <= tot; row++) {
    for (const c of [2, 6, 8, 10, 11, 13]) m.getCell(row, c).numFmt = RS;
    for (const c of [3, 5, 7, 9, 12, 14]) m.getCell(row, c).numFmt = PCT;
    m.getCell(row, 4).numFmt = INT;
    m.getCell(row, 15).alignment = { wrapText: true, vertical: "top" };
    for (let c = 2; c <= 14; c++) m.getCell(row, c).alignment = { horizontal: "right" };
  }
  const nr = tot + 2;
  m.getCell(nr, 1).value = "Profit = net sales − fees − ads − product cost. Fees = what the marketplace keeps. Change is shown only where uploads cover the whole previous period.";
  m.getCell(nr, 1).font = { color: { argb: GREY }, size: 9 };
  setup(m);

  // ---------- Products ----------
  const p = wb.addWorksheet("Products", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  p.columns = [{ width: 13 }, { width: 18 }, { width: 46 }, { width: 9 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 9 }];
  title(p, `${clientName}: products by marketplace`, `${periodText}. Products losing money are highlighted. Codes differ by marketplace (ASIN, style code, SKU).`, 10);
  header(p, 4, ["Marketplace", "Code", "Product", "Units", "Net sales", "Fees", "Ads", "Product cost", "Profit", "Margin"]);
  let pr = 5;
  for (const x of live) {
    for (const it of [...x.products].sort((a, b) => b.sales - a.sales)) {
      p.getRow(pr).values = [x.marketplace, it.code, it.name, it.units, it.sales, it.fees, it.ads ?? "–", it.productCost, it.profit, f(`IF(E${pr}=0,0,I${pr}/E${pr})`, it.margin)];
      for (const c of [5, 6, 7, 8, 9]) p.getCell(pr, c).numFmt = RS;
      p.getCell(pr, 4).numFmt = INT;
      p.getCell(pr, 10).numFmt = PCT;
      for (let c = 4; c <= 10; c++) p.getCell(pr, c).alignment = { horizontal: "right" };
      if (it.profit < 0) for (let c = 1; c <= 10; c++) p.getCell(pr, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_FILL } };
      pr++;
    }
  }
  if (pr > 5) p.autoFilter = { from: { row: 4, column: 1 }, to: { row: pr - 1, column: 10 } };
  p.getCell(pr + 1, 1).value = "Amazon profit by product excludes account-level charges (e.g. storage, ads on products with no sales), so products may not add up to the marketplace total.";
  p.getCell(pr + 1, 1).font = { color: { argb: GREY }, size: 9 };
  setup(p);

  // ---------- Daily sales ----------
  const d = wb.addWorksheet("Daily sales", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  d.columns = [{ width: 14 }, ...live.map(() => ({ width: 14 })), { width: 14 }];
  title(d, `${clientName}: net sales by day`, `${periodText}. Excluding GST.`, live.length + 2);
  header(d, 4, ["Date", ...live.map((x) => x.marketplace), "Total"]);
  const days = eachDay(period.from, period.to);
  const lastCol = String.fromCharCode(65 + live.length);
  days.forEach((day, i) => {
    const row = 5 + i;
    const vals = live.map((x) => Math.round((x.daily.get(day) ?? 0) * 100) / 100);
    d.getRow(row).values = [new Date(`${day}T00:00:00Z`), ...vals, live.length ? f(`SUM(B${row}:${lastCol}${row})`, vals.reduce((a, b) => a + b, 0)) : 0];
    d.getCell(row, 1).numFmt = "dd mmm yyyy";
    for (let c = 2; c <= live.length + 2; c++) d.getCell(row, c).numFmt = RS;
  });
  if (days.length && live.length) {
    const tr = 5 + days.length, lr = tr - 1;
    d.getRow(tr).values = ["Total", ...live.map((x, i) => f(`SUM(${String.fromCharCode(66 + i)}5:${String.fromCharCode(66 + i)}${lr})`, [...x.daily.values()].reduce((a, b) => a + b, 0))), f(`SUM(${String.fromCharCode(66 + live.length)}5:${String.fromCharCode(66 + live.length)}${lr})`, live.reduce((a, x) => a + [...x.daily.values()].reduce((p, q) => p + q, 0), 0))];
    for (let c = 1; c <= live.length + 2; c++) {
      const cell = d.getCell(tr, c);
      cell.font = { bold: true };
      cell.border = { top: { style: "thin", color: { argb: NAVY } }, bottom: { style: "double", color: { argb: NAVY } } };
      if (c > 1) cell.numFmt = RS;
    }
  }
  setup(d, false);

  // ---------- Amazon search (Brand Analytics) ----------
  const sheets = [s, m, p, d];
  if (search && (search.actions.length || search.progress)) {
    const a = wb.addWorksheet("Amazon search", { views: [{ showGridLines: false }] });
    a.columns = [{ width: 52 }, { width: 16 }, { width: 16 }, { width: 14 }];
    title(a, `${clientName}: Amazon search`, "From Amazon Brand Analytics weekly reports. Search sales include GST.", 4);
    let ar = 4;
    a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = "This month's actions"; a.getCell(ar, 1).font = { bold: true, size: 12, color: { argb: NAVY } }; ar++;
    search.actions.forEach((x, i) => {
      a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = `${i + 1}. ${x.title} (${x.owner})`; a.getCell(ar, 1).font = { bold: true }; a.getCell(ar, 1).alignment = { wrapText: true, vertical: "top" }; a.getRow(ar).height = x.title.length > 85 ? 28 : 15; ar++;
      a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = x.why; a.getCell(ar, 1).font = { color: { argb: GREY }, size: 9 }; a.getCell(ar, 1).alignment = { wrapText: true, vertical: "top" }; a.getRow(ar).height = x.why.length > 120 ? 26 : 14; ar++;
    });
    const pg = search.progress;
    if (pg) {
      ar++;
      a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = "What Pexeta has improved"; a.getCell(ar, 1).font = { bold: true, size: 12, color: { argb: NAVY } }; ar++;
      a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = `Average week in ${dateLabel(pg.baseline.from)} – ${dateLabel(pg.baseline.to)} against ${dateLabel(pg.current.from)} – ${dateLabel(pg.current.to)}.${pg.early ? " Early days: comparisons become reliable after about eight weeks." : ""}`; a.getCell(ar, 1).font = { color: { argb: GREY }, size: 9 }; a.getCell(ar, 1).alignment = { wrapText: true, vertical: "top" }; a.getRow(ar).height = 26; ar++;
      header(a, ar, ["Measure", "Then", "Now", "Change"]); ar++;
      for (const x of pg.metrics) {
        const fmtN = x.unit === "rupees" ? RS : x.unit === "pct" ? "0.00%" : "#,##0";
        a.getRow(ar).values = [x.label, x.before, x.after, x.unit === "pct" ? f(`(C${ar}-B${ar})*100`, (x.after - x.before) * 100) : f(`IF(B${ar}=0,0,C${ar}/B${ar}-1)`, x.before ? x.after / x.before - 1 : 0)];
        a.getCell(ar, 2).numFmt = fmtN; a.getCell(ar, 3).numFmt = fmtN;
        a.getCell(ar, 4).numFmt = x.unit === "pct" ? '+0.00" pts";[Red]-0.00" pts";"–"' : '+0%;[Red]-0%;"–"';
        ar++;
      }
      const list = (heading: string, color: string, items: { label: string; detail: string }[]) => {
        if (!items.length) return;
        ar++; a.getCell(ar, 1).value = heading; a.getCell(ar, 1).font = { bold: true, color: { argb: color } }; ar++;
        for (const w of items.slice(0, 6)) { a.mergeCells(ar, 1, ar, 4); a.getCell(ar, 1).value = `${w.label}: ${w.detail}`; ar++; }
      };
      list("Gains", GREEN, pg.wins);
      list("To watch", "FFB54708", pg.slips.slice(0, 3));
    }
    setup(a, false);
    sheets.splice(1, 0, a);
  }

  // ---------- Returns ----------
  if (returns && returns.total) {
    const rt = wb.addWorksheet("Returns", { views: [{ showGridLines: false }] });
    rt.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 60 }];
    title(rt, `${clientName}: why products came back`, `${periodText}. Every returned or undelivered unit, by theme.`, 4);
    let rr = 4;
    header(rt, rr, ["Theme", "Units", "Share", ""]); rr++;
    const first = rr;
    for (const t of returns.byTheme) { rt.getRow(rr).values = [THEME_LABEL[t.theme], t.units, f(`IF(SUM($B$${first}:$B$${first + returns.byTheme.length - 1})=0,0,B${rr}/SUM($B$${first}:$B$${first + returns.byTheme.length - 1}))`, t.share)]; rt.getCell(rr, 3).numFmt = PCT; rr++; }
    rr++;
    rt.mergeCells(rr, 1, rr, 4); rt.getCell(rr, 1).value = "What to do about returns"; rt.getCell(rr, 1).font = { bold: true, size: 12, color: { argb: NAVY } }; rr++;
    returns.actions.forEach((x, i) => {
      rt.mergeCells(rr, 1, rr, 4); rt.getCell(rr, 1).value = `${i + 1}. ${x.title} (${x.owner})`; rt.getCell(rr, 1).font = { bold: true }; rr++;
      rt.mergeCells(rr, 1, rr, 4); rt.getCell(rr, 1).value = x.why; rt.getCell(rr, 1).font = { color: { argb: GREY }, size: 9 }; rt.getCell(rr, 1).alignment = { wrapText: true, vertical: "top" }; rt.getRow(rr).height = x.why.length > 120 ? 40 : 14; rr++;
    });
    rr++;
    header(rt, rr, ["Product", "Marketplace", "Units", "Customers said"]); rr++;
    for (const p of returns.products.slice(0, 25)) {
      rt.getRow(rr).values = [p.name, p.marketplace, p.total, p.comments.slice(0, 2).map((c) => `“${c.slice(0, 120)}”`).join(" ")];
      for (let c = 1; c <= 4; c++) rt.getCell(rr, c).alignment = { wrapText: c === 1 || c === 4, vertical: "top", horizontal: c === 3 ? "right" : undefined };
      const said = String(rt.getCell(rr, 4).value ?? "");
      if (said.length > 70) rt.getRow(rr).height = 13 * Math.min(4, Math.ceil(said.length / 70));
      rr++;
    }
    setup(rt, false);
    sheets.push(rt);
  }

  // ---------- Pexeta's work ----------
  if (work && work.waiting.length + work.inProgress.length + work.completed.length) {
    const wk = wb.addWorksheet("Pexeta's work", { views: [{ showGridLines: false }] });
    wk.columns = [{ width: 62 }, { width: 14 }, { width: 18 }, { width: 10 }];
    title(wk, `${clientName}: Pexeta's work`, `From Pexeta's task tracker. Completed: ${periodText}, closed by Pexeta's VP.`, 4);
    let wr = 4;
    const block = (heading: string, items: WorkLine[], dateHead: string, dateOf: (t: WorkLine) => string) => {
      if (!items.length) return;
      header(wk, wr, [heading, "Marketplace", dateHead, "Ref"]); wr++;
      for (const t of items) {
        wk.getRow(wr).values = [t.need ? `${t.title}\nWhat we need: ${t.need}` : t.title, t.marketplace, dateOf(t), `PX-${t.ref}`];
        wk.getCell(wr, 1).alignment = { wrapText: true, vertical: "top" };
        if (t.need) wk.getRow(wr).height = 28;
        wr++;
      }
      wr++;
    };
    block(`Waiting on you (${work.waiting.length})`, work.waiting, "Due", (t) => dateLabel(t.due_date));
    block(`In progress (${work.inProgress.length})`, work.inProgress, "Due", (t) => dateLabel(t.due_date));
    block(`Completed (${work.completed.length})`, work.completed, "Completed", (t) => dateLabel(t.done_at));
    setup(wk, false);
    sheets.splice(1, 0, wk);
  }

  for (const ws of sheets) {
    ws.getCell(2, 1).border = { bottom: { style: "medium", color: { argb: ORANGE } } };
    fontAll(ws);
  }

  return wb;
}

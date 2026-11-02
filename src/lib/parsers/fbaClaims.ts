// Amazon FBA reports for warehouse reimbursement checks → sd_ tables. Pure functions.
//   Inventory Ledger, detailed view (Reports › Fulfilment › Inventory Ledger › Detailed view, CSV)
//   Reimbursements (Reports › Fulfilment › Reimbursements, CSV)
import type { Parsed } from "./map";
import type { Table } from "./read";
import { num, rowHasher, str } from "./util";

function base(type: Parsed["type"], table: string): Parsed {
  return { type, table, rows: [], periodStart: null, periodEnd: null, products: [], skus: [], warnings: [] };
}
function span(p: Parsed, dates: string[]) {
  const d = dates.filter(Boolean).sort();
  p.periodStart = d[0] ?? null;
  p.periodEnd = d[d.length - 1] ?? null;
}

// Only the events that matter for lost, damaged and returned stock. Customer shipments and transfers between
// warehouses are most of the file and are not needed for claims.
const KEEP_EVENTS = new Set(["Adjustments", "Receipts", "CustomerReturns", "VendorReturns"]);

export function invLedger(t: Table): Parsed {
  const p = base("inv_ledger", "sd_inv_ledger");
  const hash = rowHasher();
  for (const r of t.rows) {
    const event = str(r["Event Type"]);
    if (!KEEP_EVENTS.has(event)) continue;
    // "Date and Time" is India time with offset, e.g. 2026-11-02T00:00:00+0530: its first ten characters are the date.
    const date = str(r["Date and Time"]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parts = ["Date and Time", "FNSKU", "MSKU", "Event Type", "Reference ID", "Quantity", "Fulfillment Center", "Disposition", "Reason"].map((h) => str(r[h]));
    const sku = str(r["MSKU"]), asin = str(r["ASIN"]);
    p.rows.push({
      row_key: hash(parts), event_date: date, event_type: event,
      fnsku: str(r["FNSKU"]), asin, sku, reference_id: str(r["Reference ID"]),
      quantity: num(r["Quantity"]), fc: str(r["Fulfillment Center"]), disposition: str(r["Disposition"]), reason: str(r["Reason"]),
      reconciled: num(r["Reconciled Quantity"]), unreconciled: num(r["Unreconciled Quantity"]),
    });
    if (sku && asin) p.skus.push({ sku, asin, fulfillment: "AFN" });
  }
  span(p, p.rows.map((x) => x.event_date as string));
  return p;
}

export function reimbursements(t: Table): Parsed {
  const p = base("reimbursements", "sd_reimbursements");
  for (const r of t.rows) {
    const id = str(r["reimbursement-id"]);
    const date = str(r["approval-date"]).slice(0, 10);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    p.rows.push({
      row_key: [id, str(r["sku"]), str(r["original-reimbursement-id"])].join("|"),
      approval_date: date, reimbursement_id: id, case_id: str(r["case-id"]), order_id: str(r["amazon-order-id"]),
      reason: str(r["reason"]), sku: str(r["sku"]), fnsku: str(r["fnsku"]), asin: str(r["asin"]), condition: str(r["condition"]),
      amount_per_unit: num(r["amount-per-unit"]), amount_total: num(r["amount-total"]),
      qty_cash: num(r["quantity-reimbursed-cash"]), qty_inventory: num(r["quantity-reimbursed-inventory"]), qty_total: num(r["quantity-reimbursed-total"]),
      original_id: str(r["original-reimbursement-id"]), original_type: str(r["original-reimbursement-type"]),
    });
  }
  span(p, p.rows.map((x) => x.approval_date as string));
  return p;
}

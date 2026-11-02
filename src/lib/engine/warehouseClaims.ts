// Stock lost or damaged inside Amazon's warehouses that Amazon has not paid for: from the Inventory Ledger
// (detailed view) checked against the Reimbursements report. Pure functions. Values are estimates for the team to
// verify in Seller Central before raising a case; Amazon decides the final amount.

export type LedgerRow = {
  event_date: string; event_type: string; fnsku: string; asin: string; sku: string; reference_id: string;
  quantity: number; fc: string; disposition: string; reason: string; reconciled: number; unreconciled: number;
};
export type ReimbursementRow = {
  approval_date: string; reimbursement_id: string; order_id: string; reason: string; sku: string; fnsku: string; asin: string;
  condition: string; amount_per_unit: number; amount_total: number; qty_cash: number; qty_inventory: number; qty_total: number;
};
export type WarehouseClaim = {
  kind: "lost" | "damaged" | "inbound_damaged";
  fnsku: string; sku: string; asin: string; name: string; fc: string; date: string; reference_id: string;
  units: number; unitValue: number; value: number; valueBasis: "amazon_rate" | "selling_price";
  status: "claim_now" | "wait" | "check";
  detail: string;
};
export type WarehouseClaims = {
  claims: WarehouseClaim[];
  claimable: number; pending: number; toCheck: number;
  lostUnits: number; damagedUnits: number;
  reimbursedByReason: { reason: string; amount: number; count: number }[];   // payments in the period, from the report
  reimbursedTotal: number;
};

export const WAREHOUSE_WAIT_DAYS = 30; // Amazon usually finds or reimburses lost and damaged stock on its own within this time
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const AMAZON_DAMAGE = new Set(["WAREHOUSE_DAMAGED"]);
const READABLE: Record<string, string> = {
  CustomerReturn: "Customer return", CustomerServiceIssue: "Customer service issue", Lost_Warehouse: "Lost in warehouse",
  Damaged_Warehouse: "Damaged in warehouse", Lost_Inbound: "Lost on the way in", Damaged_Inbound: "Damaged on the way in",
  FeeCorrection: "Fee correction", Reimbursement_Reversal: "Reversal", General_Adjustment: "General adjustment",
};
export const reimbursementReason = (r: string) => READABLE[r] ?? r.replace(/_/g, " ");

export function computeWarehouseClaims(args: {
  ledger: LedgerRow[];                    // all ledger events on record (claims need the history)
  reimbursements: ReimbursementRow[];     // all reimbursements on record
  from: string; to: string;               // the period, for "paid in these dates"
  asOf: string;                           // latest data date
  sellingPrice: (sku: string) => number | null;  // average selling price incl. GST, when Amazon has no rate for the product
  nameOf: (asin: string, sku: string) => string;
}): WarehouseClaims {
  // Amazon's own payout per unit for each product: the median cash rate in its reimbursements.
  const rates = new Map<string, number[]>();
  for (const r of args.reimbursements) if (r.amount_per_unit > 0 && r.qty_cash > 0) for (const k of [r.fnsku, r.sku]) if (k) rates.set(k, [...(rates.get(k) ?? []), r.amount_per_unit]);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const valueOf = (fnsku: string, sku: string): { v: number; basis: WarehouseClaim["valueBasis"] } => {
    const r = rates.get(fnsku) ?? rates.get(sku);
    if (r?.length) return { v: median(r), basis: "amazon_rate" };
    return { v: args.sellingPrice(sku) ?? 0, basis: "selling_price" };
  };
  // Units Amazon already paid for, by product and reason, used up oldest first.
  const paid = new Map<string, number>();
  const take = (key: string, units: number) => { const have = paid.get(key) ?? 0; const used = Math.min(have, units); paid.set(key, have - used); return units - used; };
  for (const r of args.reimbursements) {
    const kind = /lost/i.test(r.reason) ? "lost" : /damaged.*inbound|inbound.*damaged/i.test(r.reason) ? "inbound_damaged" : /damaged/i.test(r.reason) ? "damaged" : null;
    if (kind) paid.set(`${kind}|${r.fnsku}`, (paid.get(`${kind}|${r.fnsku}`) ?? 0) + r.qty_total);
  }

  const claims: WarehouseClaim[] = [];
  const events = [...args.ledger].sort((a, b) => a.event_date.localeCompare(b.event_date));
  for (const e of events) {
    let kind: WarehouseClaim["kind"] | null = null, units = 0;
    // Lost (code M): Amazon's ledger keeps the units neither found nor reimbursed as "unreconciled".
    if (e.event_type === "Adjustments" && e.reason === "M" && e.unreconciled > 0) { kind = "lost"; units = e.unreconciled; }
    // Damaged by the warehouse: units moved into "warehouse damaged" (code E, or a disposition change into it).
    else if (e.event_type === "Adjustments" && ((e.reason === "E" && e.unreconciled > 0) || (e.quantity > 0 && AMAZON_DAMAGE.has(e.disposition) && ["P", "6", "7"].includes(e.reason)))) { kind = "damaged"; units = e.reason === "E" ? e.unreconciled : e.quantity; }
    // Received damaged by the carrier: Amazon pays only if it was Amazon's partnered carrier, so the team checks.
    else if (e.event_type === "Receipts" && e.disposition === "CARRIER_DAMAGED" && e.quantity > 0) { kind = "inbound_damaged"; units = e.quantity; }
    if (!kind) continue;
    const open = take(`${kind}|${e.fnsku}`, units);
    if (open <= 0) continue;
    const { v, basis } = valueOf(e.fnsku, e.sku);
    const age = daysBetween(e.event_date, args.asOf);
    const status: WarehouseClaim["status"] = kind === "inbound_damaged" ? "check" : age >= WAREHOUSE_WAIT_DAYS ? "claim_now" : "wait";
    const where = `${e.fc}${e.reference_id ? `, reference ${e.reference_id}` : ""}`;
    const detail = kind === "lost"
      ? `${open} unit${open > 1 ? "s" : ""} lost at ${where} on ${e.event_date}; not found or reimbursed${status === "wait" ? ` yet (Amazon usually searches for ${WAREHOUSE_WAIT_DAYS} days)` : ` after ${age} days`}.`
      : kind === "damaged"
        ? `${open} unit${open > 1 ? "s" : ""} damaged by the warehouse at ${where} on ${e.event_date}; no reimbursement${status === "wait" ? " yet" : ` after ${age} days`}.`
        : `${open} unit${open > 1 ? "s" : ""} received damaged by the carrier at ${where} on ${e.event_date}. Claimable if the shipment used Amazon's partnered carrier.`;
    claims.push({ kind, fnsku: e.fnsku, sku: e.sku, asin: e.asin, name: args.nameOf(e.asin, e.sku), fc: e.fc, date: e.event_date, reference_id: e.reference_id, units: open, unitValue: v, value: v * open, valueBasis: basis, status, detail });
  }
  const order = { claim_now: 0, wait: 1, check: 2 } as const;
  claims.sort((a, b) => order[a.status] - order[b.status] || b.value - a.value);

  const inPeriod = args.reimbursements.filter((r) => r.approval_date >= args.from && r.approval_date <= args.to);
  const byReason = new Map<string, { amount: number; count: number }>();
  for (const r of inPeriod) { const x = byReason.get(r.reason) ?? { amount: 0, count: 0 }; x.amount += r.amount_total; x.count += 1; byReason.set(r.reason, x); }
  const sum = (s: WarehouseClaim["status"]) => claims.filter((c) => c.status === s).reduce((t, c) => t + c.value, 0);
  return {
    claims, claimable: sum("claim_now"), pending: sum("wait"), toCheck: sum("check"),
    lostUnits: claims.filter((c) => c.kind === "lost").reduce((s, c) => s + c.units, 0),
    damagedUnits: claims.filter((c) => c.kind !== "lost").reduce((s, c) => s + c.units, 0),
    reimbursedByReason: [...byReason.entries()].map(([reason, x]) => ({ reason, ...x })).sort((a, b) => b.amount - a.amount),
    reimbursedTotal: inPeriod.reduce((s, r) => s + r.amount_total, 0),
  };
}

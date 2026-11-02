// What returns cost in rupees, and what Amazon may owe back (Sellerboard-style reimbursement checks).
// Pure functions. Amounts include GST unless a name says otherwise. Claim values are estimates for the team to
// verify in Seller Central before raising a case; Amazon decides the final amount.

export type RefundRow = {
  posted_date: string; order_id: string; sku: string; asin: string; quantity: number; description: string;
  fulfillment: string;           // AFN = Fulfilled by Amazon; only these items go back to Amazon's warehouse
  product_sales: number; shipping_credits: number; gift_wrap_credits: number; promotional_rebates: number; tax_liable: number;
  selling_fees: number; fba_fees: number; other_transaction_fees: number; total: number;
};
export type FeeRow = { order_id: string; sku: string; selling_fees: number; fba_fees: number; other_transaction_fees: number };
export type ReimbRow = { posted_date: string; order_id: string; sku: string; description: string; quantity: number; total: number };
export type AmzReturnRow = { return_date: string; order_id: string; sku: string; asin: string; quantity: number; disposition: string; reason: string };

export type Claim = {
  kind: "not_returned" | "damaged_by_amazon";
  order_id: string; sku: string; asin: string; name: string; quantity: number;
  refundDate: string; returnDate: string | null;
  value: number;                 // estimate: item value refunded to the customer, incl. GST
  status: "claim_now" | "wait";  // wait = still inside Amazon's window for the customer to send it back
  claimFrom: string;             // first day a case makes sense
  detail: string;
};

export type ReturnsMoney = {
  amazon: {
    refunds: number; refundedUnits: number;
    refundedToCustomers: number;     // item, shipping and gift wrap refunded, incl. GST
    feesKept: number;                // fees on refunded orders that Amazon did not give back
    stockLost: number;               // returned units that cannot be resold, at product cost
    stockLostUnits: number;
    recovered: number;               // reimbursements Amazon paid in these dates
    recoveredItems: { date: string; description: string; order_id: string; amount: number }[];
    claimable: number;               // claims ready to raise now
    pending: number;                 // claims that become due after the waiting period
    claims: Claim[];
  } | null;
  firstcry: { debited: number; rtoDebited: number; returnDebited: number; units: number } | null;
  myntra: { deducted: number; reverseLogistics: number; lines: number } | null;
  total: {
    reversed: number;     // sales taken back: Amazon refunds, FirstCry debit notes, Myntra reverse settlements
    lost: number;         // money that does not come back: fees Amazon kept, Myntra return shipping, stock written off
    recoverable: number;  // estimated claims from Amazon, due now and pending
  };
};

const WAIT_DAYS = 45; // days after a refund before an item not sent back is treated as not returned
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const UNSELLABLE = /customer_damaged|defective|carrier_damaged|damaged|expired/i;
const AMAZON_DAMAGE = /carrier_damaged|^damaged$|warehouse|damaged_by_fc/i;
const isReimbursement = (r: { description: string }) => /reimburs/i.test(r.description);

export function computeReturnsMoney(args: {
  refunds: RefundRow[];                  // Refund rows posted in the period
  orderFees: FeeRow[];                   // Order rows (any date) for the refunded orders: their fees
  reimbursements: ReimbRow[];            // every reimbursement row for the refunded / returned orders, any date
  reimbursementsInPeriod: ReimbRow[];    // reimbursement rows posted in the period
  amazonReturns: AmzReturnRow[];         // every FBA customer return for the refunded orders, any date
  costPerUnit: (sku: string, asin: string, unitPrice: number) => number;
  nameOf: (asin: string, sku: string) => string;
  asOf: string;                          // latest data date
  fc: { rto_total: number; sr_total: number; rto_qty: number; sr_qty: number }[] | null;
  myReverse: { expected_settled: number; logistics: number }[] | null;
}): ReturnsMoney {
  let amazon: ReturnsMoney["amazon"] = null;
  if (args.refunds.length || args.reimbursementsInPeriod.length) {
    const feeByOrder = new Map<string, number>();
    for (const f of args.orderFees) feeByOrder.set(`${f.order_id}|${f.sku}`, (feeByOrder.get(`${f.order_id}|${f.sku}`) ?? 0) + f.selling_fees + f.fba_fees + f.other_transaction_fees);
    const retByOrder = new Map<string, AmzReturnRow[]>();
    for (const r of args.amazonReturns) retByOrder.set(r.order_id, [...(retByOrder.get(r.order_id) ?? []), r]);
    const reimbByOrder = new Map<string, number>();
    for (const r of args.reimbursements) if (isReimbursement(r)) reimbByOrder.set(r.order_id, (reimbByOrder.get(r.order_id) ?? 0) + r.total);

    let refundedToCustomers = 0, feesKept = 0, stockLost = 0, stockLostUnits = 0, refundedUnits = 0;
    const claims: Claim[] = [];
    for (const r of args.refunds) {
      const qty = Math.max(1, Math.abs(r.quantity));
      const item = -(r.product_sales + r.tax_liable);                       // item value refunded, incl. GST
      const refunded = item - (r.shipping_credits + r.gift_wrap_credits);  // plus shipping and gift wrap refunded
      refundedToCustomers += Math.max(0, refunded);
      refundedUnits += qty;
      // Fees: what the order paid (negative) plus what the refund gave back (positive) and any refund fee (negative).
      const orderFees = feeByOrder.get(`${r.order_id}|${r.sku}`) ?? 0;
      const refundFees = r.selling_fees + r.fba_fees + r.other_transaction_fees;
      feesKept += Math.max(0, -(orderFees + refundFees));

      const rets = retByOrder.get(r.order_id) ?? [];
      const reimbursed = reimbByOrder.get(r.order_id) ?? 0;
      const unitPrice = item / qty;
      const name = args.nameOf(r.asin, r.sku);
      // Amazon only owes for items that were meant to come back to its own warehouse (FBA).
      if (!rets.length && r.fulfillment !== "AFN") continue;
      if (!rets.length) {
        // Refunded but nothing came back: once the waiting period is over, Amazon should reimburse the item.
        const claimFrom = addDays(r.posted_date, WAIT_DAYS);
        if (reimbursed <= 0 && item > 0)
          claims.push({ kind: "not_returned", order_id: r.order_id, sku: r.sku, asin: r.asin, name, quantity: qty, refundDate: r.posted_date, returnDate: null, value: item,
            status: args.asOf >= claimFrom ? "claim_now" : "wait", claimFrom,
            detail: args.asOf >= claimFrom ? `Refunded on ${r.posted_date}; no return received in ${WAIT_DAYS} days and no reimbursement yet.` : `Refunded on ${r.posted_date}; no return yet. Raise a case from ${claimFrom} if it does not come back.` });
        continue;
      }
      for (const ret of rets) {
        const units = Math.max(1, ret.quantity);
        if (UNSELLABLE.test(ret.disposition)) { stockLost += args.costPerUnit(ret.sku, ret.asin, unitPrice) * units; stockLostUnits += units; }
        // Came back damaged by Amazon's warehouse or courier: Amazon is responsible for the item.
        if (AMAZON_DAMAGE.test(ret.disposition) || /damaged_by_fc|carrier/i.test(ret.reason)) {
          if (reimbursed <= 0 && item > 0)
            claims.push({ kind: "damaged_by_amazon", order_id: r.order_id, sku: r.sku, asin: r.asin, name, quantity: units, refundDate: r.posted_date, returnDate: ret.return_date, value: unitPrice * units,
              status: "claim_now", claimFrom: ret.return_date,
              detail: `Returned ${ret.return_date} as ${ret.disposition.toLowerCase().replace(/_/g, " ")} (${ret.reason.toLowerCase().replace(/_/g, " ")}); no reimbursement yet.` });
        }
      }
    }
    const recoveredItems = args.reimbursementsInPeriod.filter(isReimbursement).map((x) => ({ date: x.posted_date, description: x.description, order_id: x.order_id, amount: x.total }));
    const unique = new Map<string, Claim>();
    for (const c of claims) unique.set(`${c.kind}|${c.order_id}|${c.sku}`, c);
    const list = [...unique.values()].sort((a, b) => (a.status === b.status ? b.value - a.value : a.status === "claim_now" ? -1 : 1));
    amazon = {
      refunds: args.refunds.length, refundedUnits, refundedToCustomers, feesKept, stockLost, stockLostUnits,
      recovered: recoveredItems.reduce((s, x) => s + x.amount, 0), recoveredItems,
      claimable: list.filter((c) => c.status === "claim_now").reduce((s, c) => s + c.value, 0),
      pending: list.filter((c) => c.status === "wait").reduce((s, c) => s + c.value, 0),
      claims: list,
    };
  }

  const firstcry = args.fc && args.fc.length ? {
    rtoDebited: args.fc.reduce((s, r) => s + r.rto_total, 0), returnDebited: args.fc.reduce((s, r) => s + r.sr_total, 0),
    debited: args.fc.reduce((s, r) => s + r.rto_total + r.sr_total, 0), units: args.fc.reduce((s, r) => s + r.rto_qty + r.sr_qty, 0),
  } : null;
  const myntra = args.myReverse && args.myReverse.length ? {
    deducted: args.myReverse.reduce((s, r) => s + Math.max(0, -r.expected_settled), 0),
    reverseLogistics: args.myReverse.reduce((s, r) => s + Math.abs(r.logistics), 0), lines: args.myReverse.length,
  } : null;

  return {
    amazon, firstcry, myntra,
    total: {
      reversed: (amazon?.refundedToCustomers ?? 0) + (firstcry?.debited ?? 0) + (myntra?.deducted ?? 0),
      lost: (amazon ? amazon.feesKept + amazon.stockLost : 0) + (myntra?.reverseLogistics ?? 0),
      recoverable: (amazon?.claimable ?? 0) + (amazon?.pending ?? 0),
    },
  };
}

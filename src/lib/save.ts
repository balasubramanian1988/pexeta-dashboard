// Saves parsed reports into the sd_ tables (server only, service role, after access checks).
// Re-uploading the same or an overlapping report is safe: rows are keyed so they update rather than duplicate.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRow, Parsed } from "./parsers";
import { shortName } from "./parsers/util";

const CONFLICT: Record<string, string> = {
  sd_orders: "account_id,order_item_key",
  sd_transactions: "account_id,row_hash",
  sd_traffic: "account_id,date,asin",
  sd_ads: "account_id,date,ad_type,campaign,ad_group,target,asin",
  sd_sb_purchases: "account_id,date,campaign,attribution,asin",
  sd_returns: "account_id,row_key",
  sd_tax_lines: "account_id,row_hash",
  sd_stock_transfers: "account_id,row_hash",
  sd_tax_documents: "account_id,number",
  sd_fc_sales: "account_id,row_key",
  sd_fc_recon: "account_id,row_key",
  sd_fc_returns: "account_id,row_key",
};
// FirstCry reconciliation: a unit's invoice, payment advice and return debits arrive over several downloads.
// An older or narrower file must not wipe what a newer one recorded, so blanks never overwrite values.
const FC_KEEP_TEXT = ["vendor_invoice", "payment_advice", "debit_note", "ship_date", "delivery_date", "return_date"];
const FC_KEEP_NUM = ["sr_qty", "sr_total", "sr_gross", "rto_qty", "rto_total", "rto_gross"];
const SNAPSHOT = new Set(["sd_inventory", "sd_listings"]);
// Reports whose SKU → ASIN pairs and fulfilment channel are authoritative.
const SKU_SOURCE = new Set(["listings", "orders", "fba_inventory", "fc_products"]);
const CHUNK = 500;

async function chunked(rows: DbRow[], fn: (part: DbRow[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await fn(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
}

/** Dedupe by conflict key: Postgres refuses one upsert that touches the same row twice. */
function uniqueBy(rows: DbRow[], cols: string[]) {
  const m = new Map<string, DbRow>();
  for (const r of rows) m.set(cols.map((c) => String(r[c] ?? "")).join("␟"), r);
  return [...m.values()];
}

export async function saveParsed(admin: SupabaseClient, accountId: string, p: Parsed & { pdf?: Uint8Array }): Promise<{ saved: number; warnings: string[] }> {
  const warnings = [...p.warnings];

  // Product master first, so transactions can be matched to an ASIN.
  if (p.skus.length) {
    const skus = uniqueBy(p.skus.filter((s) => s.sku && s.asin).map((s) => ({ account_id: accountId, ...s })), ["sku"]);
    await chunked(skus, (part) => admin.from("sd_skus").upsert(part, { onConflict: "account_id,sku", ignoreDuplicates: !SKU_SOURCE.has(p.type) }));
  }
  if (p.type === "fc_products") {
    // The product list is authoritative for names, MRP, GST rate and status. Keep a short name the team has edited.
    const ids = [...new Set(p.products.map((x) => x.asin))];
    const { data: existing } = await admin.from("sd_products").select("asin, title, short_name").eq("account_id", accountId).in("asin", ids);
    const edited = new Map((existing ?? []).filter((e) => e.short_name && e.short_name !== shortName(e.title ?? "")).map((e) => [e.asin, e.short_name as string]));
    const rows = uniqueBy(p.products.map((x) => ({
      account_id: accountId, asin: x.asin, title: x.title, short_name: edited.get(x.asin) ?? shortName(x.title), mrp: x.mrp ?? null,
      style_code: x.style_code ?? "", gst_rate: x.gst_rate ?? null, status: x.status ?? "", category: x.category ?? "",
    })), ["asin"]);
    await chunked(rows, (part) => admin.from("sd_products").upsert(part, { onConflict: "account_id,asin" }));
    return { saved: rows.length, warnings };
  }
  if (p.products.length) {
    const byAsin = new Map<string, { asin: string; title: string; mrp?: number | null }>();
    for (const x of p.products) if (x.asin && (!byAsin.has(x.asin) || (!byAsin.get(x.asin)!.title && x.title))) byAsin.set(x.asin, x);
    const { data: existing } = await admin.from("sd_products").select("asin, title").eq("account_id", accountId).in("asin", [...byAsin.keys()]);
    const have = new Map((existing ?? []).map((e) => [e.asin, e.title as string]));
    const fresh = [...byAsin.values()].filter((x) => !have.has(x.asin)).map((x) => ({ account_id: accountId, asin: x.asin, title: x.title, short_name: shortName(x.title), mrp: x.mrp ?? null }));
    await chunked(fresh, (part) => admin.from("sd_products").insert(part));
    for (const x of byAsin.values()) {
      if (have.has(x.asin) && !have.get(x.asin) && x.title)
        await admin.from("sd_products").update({ title: x.title, short_name: shortName(x.title) }).eq("account_id", accountId).eq("asin", x.asin);
    }
  }

  let rows: DbRow[] = p.rows.map((r) => ({ account_id: accountId, ...r }));

  if (p.table === "sd_transactions") {
    const { data: skuRows } = await admin.from("sd_skus").select("sku, asin").eq("account_id", accountId);
    const asinOf = new Map((skuRows ?? []).map((s) => [s.sku, s.asin as string]));
    const orderSku = new Map<string, string>();
    for (const r of rows) if (r.sku && r.order_id && !orderSku.has(String(r.order_id))) orderSku.set(String(r.order_id), String(r.sku));
    let unmatched = 0;
    for (const r of rows) {
      const sku = String(r.sku || orderSku.get(String(r.order_id)) || "");
      r.asin = asinOf.get(sku) ?? "";
      if (sku && !r.asin) unmatched++;
    }
    if (unmatched) warnings.push(`${unmatched} rows have a SKU not yet in the product list. Upload Active Listings to match them.`);
  }

  if (p.table === "sd_tax_documents" && p.pdf && rows[0]) {
    const path = `${accountId}/tax-documents/${String(rows[0].number).replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
    const { error } = await admin.storage.from("sd-files").upload(path, p.pdf, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Could not store the PDF: ${error.message}`);
    rows[0].storage_path = path;
  }

  if (SNAPSHOT.has(p.table)) {
    const date = rows[0]?.snapshot_date;
    if (!date) return { saved: 0, warnings };
    const { error } = await admin.from(p.table).delete().eq("account_id", accountId).eq("snapshot_date", date);
    if (error) throw new Error(error.message);
    rows = uniqueBy(rows, ["sku"]);
    await chunked(rows, (part) => admin.from(p.table).insert(part));
    return { saved: rows.length, warnings };
  }

  if (p.table === "sd_fc_recon") {
    rows = uniqueBy(rows, ["row_key"]);
    const prior = new Map<string, DbRow>();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const keys = rows.slice(i, i + CHUNK).map((r) => String(r.row_key));
      const { data, error } = await admin.from("sd_fc_recon").select(["row_key", ...FC_KEEP_TEXT, ...FC_KEEP_NUM].join(", ")).eq("account_id", accountId).in("row_key", keys);
      if (error) throw new Error(error.message);
      for (const d of (data ?? []) as unknown as DbRow[]) prior.set(String(d.row_key), d);
    }
    for (const r of rows) {
      const old = prior.get(String(r.row_key));
      if (!old) continue;
      for (const k of FC_KEEP_TEXT) if (r[k] == null && old[k] != null) r[k] = old[k];
      for (const k of FC_KEEP_NUM) if (!Number(r[k]) && Number(old[k])) r[k] = Number(old[k]);
    }
  }

  const conflict = CONFLICT[p.table];
  if (!conflict) throw new Error(`No save rule for ${p.table}`);
  rows = uniqueBy(rows, conflict.split(","));
  await chunked(rows, (part) => admin.from(p.table).upsert(part, { onConflict: conflict }));
  return { saved: rows.length, warnings };
}

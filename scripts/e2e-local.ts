// End-to-end check against a local Postgres + PostgREST (see README, "Local end-to-end test").
// Saves every file in ./test-data through the real save layer, reads it back as the seller (row-level
// security on), and checks the profit engine gives the same totals as on the parsed files.
// Run: npx tsx --conditions=react-server scripts/e2e-local.ts
import { createHmac } from "node:crypto";
import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseUpload } from "../src/lib/parsers";
import { saveParsed } from "../src/lib/save";
import { getAds, getTransactions, fetchAll } from "../src/lib/data";
import { computeProfit } from "../src/lib/engine/profit";
import { gstMonth, gstMonths } from "../src/lib/gst";

const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-secret-local-e2e-secret-0123456789";
const PGRST = Number(process.env.E2E_PGRST_PORT ?? 3009);
const b64 = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };

// supabase-js expects /rest/v1 and /storage/v1; forward REST to PostgREST and accept storage uploads in memory.
const stored = new Map<string, number>();
const server = http.createServer((req, res) => {
  if (req.url!.startsWith("/storage/v1/object/")) {
    let n = 0; req.on("data", (c) => (n += c.length)); req.on("end", () => { stored.set(req.url!, n); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ Key: req.url })); });
    return;
  }
  const up = http.request({ host: "localhost", port: PGRST, path: req.url!.replace(/^\/rest\/v1/, ""), method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode!, r.headers); r.pipe(res); });
  req.pipe(up);
});

let fail = 0;
const check = (l: string, got: number, want: number, tol = 0.5) => { const ok = Math.abs(got - want) <= tol; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${l}: ${got.toFixed(2)} (expected ${want.toFixed(2)})`); };

async function main() {
  await new Promise<void>((r) => server.listen(54329, r));
  const url = "http://localhost:54329";
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, jwt({ role: "service_role" }), opts);
  const { data: acct } = await admin.from("sd_accounts").select("id, client_id").like("name", "Root and Soil%").single();
  const { data: other } = await admin.from("sd_accounts").select("id").like("name", "Other Brand%").single();
  const id = acct!.id;
  for (const t of ["sd_transactions", "sd_orders", "sd_ads", "sd_sb_purchases", "sd_inventory", "sd_listings", "sd_traffic", "sd_returns", "sd_tax_lines", "sd_stock_transfers", "sd_tax_documents", "sd_skus", "sd_products"])
    await admin.from(t).delete().eq("account_id", id);

  // Snapshot reports with SKU→ASIN first, as the team would on day one.
  const order = (f: string) => (/Listings|Inventory|Orders/i.test(f) ? 0 : 1);
  const files = readdirSync("test-data").sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  let saved = 0;
  for (const f of files) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join("test-data", f))), "2026-10-22")) {
    if (!r.ok || !r.rows.length) continue;
    const s = await saveParsed(admin, id, r);
    saved += s.saved;
  }
  console.log(`saved ${saved} rows; ${stored.size} PDFs stored`);
  // Upload the unified report again: nothing should double.
  const uf = files.find((f) => /CustomUnifiedTransaction/.test(f))!;
  for (const r of await parseUpload(uf, new Uint8Array(readFileSync(join("test-data", uf))), null)) if (r.ok) await saveParsed(admin, id, r);

  const seller = createClient(url, jwt({ role: "authenticated", sub: "11111111-1111-1111-1111-111111111111", email: "owner@rootandsoil.test", app_metadata: { providers: ["email"] } }), opts);
  const otherSeller = createClient(url, jwt({ role: "authenticated", sub: "22222222-2222-2222-2222-222222222222", email: "owner@other.test", app_metadata: { providers: ["email"] } }), opts);
  const fake = createClient(url, jwt({ role: "authenticated", sub: "33333333-3333-3333-3333-333333333333", email: "bala@pexeta.in", app_metadata: { providers: ["email"] } }), opts);

  const txns = await getTransactions(seller as never, id, "2026-10-01", "2026-10-22");
  const { ads, sbPurchases } = await getAds(seller as never, id, "2026-10-01", "2026-10-22");
  const [products, skus] = await Promise.all([
    fetchAll((f, t) => seller.from("sd_products").select("asin, title, short_name").eq("account_id", id).range(f, t)),
    fetchAll((f, t) => seller.from("sd_skus").select("sku, asin").eq("account_id", id).range(f, t)),
  ]);
  check("Seller reads transactions 1–22 Oct", txns.length, 5845, 0);
  const res = computeProfit({ txns, ads: ads.filter((a) => a.ad_type !== "SB"), sbPurchases, skus: skus as never, products: products as never, settings: [], defaults: { default_cost_pct: 0.25, default_lead_time_days: 30, default_safety_days: 7, plan_horizon_days: 45 } });
  check("Net units", res.totals.units, 4823, 0);
  check("Net sales", res.totals.netSales, 3368273.51);
  check("Ad spend", res.totals.ads, 201488.31);
  check("Profit before account-level", res.totals.profit, 1714478.18, 1);
  const { count: asinFilled } = await admin.from("sd_transactions").select("*", { count: "exact", head: true }).eq("account_id", id).eq("type", "Order").neq("asin", "");
  const { count: orders } = await admin.from("sd_transactions").select("*", { count: "exact", head: true }).eq("account_id", id).eq("type", "Order");
  check("Order rows matched to an ASIN on save", asinFilled ?? 0, (orders ?? 0) - 1, 0); // one SKU is not in any listing
  const { count: docs } = await seller.from("sd_tax_documents").select("*", { count: "exact", head: true }).eq("account_id", id);
  check("Tax documents saved", docs ?? 0, 18, 0);
  check("PDFs stored", stored.size, 18, 0);
  const { count: tl } = await seller.from("sd_tax_lines").select("*", { count: "exact", head: true }).eq("account_id", id);
  check("MTR lines saved", tl ?? 0, 7022 + (await (async () => { const { count } = await admin.from("sd_tax_lines").select("*", { count: "exact", head: true }).eq("account_id", id).eq("kind", "B2B"); return count ?? 0; })()), 0);

  const { count: leak } = await otherSeller.from("sd_transactions").select("*", { count: "exact", head: true }).eq("account_id", id);
  check("Other seller sees Root and Soil transactions", leak ?? 0, 0, 0);
  const { count: leak2 } = await fake.from("sd_transactions").select("*", { count: "exact", head: true });
  check("Password login with a team email sees transactions", leak2 ?? 0, 0, 0);
  const { error: writeErr } = await seller.from("sd_product_settings").insert({ account_id: id, asin: "B09GWBGMR7", cost_pct: 0.1 });
  check("Seller cannot write directly (RLS)", writeErr ? 1 : 0, 1, 0);
  void other;

  // GST tab: September MTR by GSTIN, and October invoices.
  const months = await gstMonths(id, seller as never);
  console.log("GST months:", months.join(", "));
  const sep = await gstMonth(id, acct!.client_id, "2026-09-01", seller as never);
  const tn = sep.summaries.find((x) => x.gstin === "33AALCR8246B1ZF")!;
  check("GST Sep: TN B2C sales", tn.b2c.sales, 2060010.58, 1);
  check("GST Sep: TN B2C returns (incl. refunds of earlier invoices)", tn.b2c.returns, 88188.13, 1);
  check("GST Sep: all B2C taxable (net)", sep.summaries.reduce((s, x) => s + x.b2c.sales - x.b2c.returns, 0), 3863034.21, 1);
  check("GST Sep: stock transfers (between + within GSTINs)", sep.summaries.reduce((s, x) => s + x.transfersOut + x.transfersWithin, 0), 2746556.82, 1);
  check("GST Sep: transfers out = transfers in", sep.summaries.reduce((s, x) => s + x.transfersOut - x.transfersIn, 0), 0, 0.01);
  const allDocs = (await Promise.all(months.map((m) => gstMonth(id, acct!.client_id, m, seller as never)))).flatMap((x) => x.docs);
  check("GST: input GST across invoice months", allDocs.reduce((s, d) => s + d.gst, 0), 150021.2, 0.05);

  server.close();
  console.log(fail ? `${fail} FAILED` : "All end-to-end checks passed");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

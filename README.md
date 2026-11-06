# Pexeta Seller Dashboard

`dashboard.pexeta.in`: profit, revenue, ads, a 45-day stock plan and GST documents for Pexeta's marketplace sellers. Amazon.in, FirstCry, Myntra and Flipkart are live (pilot: Root and Soil); quick commerce next.

Each brand is opted into the marketplaces it sells on (**Brands** page); each marketplace is one account with its own tabs.

- **Sellers** sign in with email and password and see only their own brand.
- **Pexeta team** signs in with Google (anyone active in `team_members`, shared with Pexeta Ops), sees every account, and uploads reports.

## What it shows

| Tab | What it is built from |
| --- | --- |
| Overview | Net sales, net profit, ad spend, fees, product cost, refunds; daily sales; top products; stock alerts; data freshness |
| Profitability | Per product (ASIN): net sales − Amazon fees ÷ 1.18 − ad spend − product cost + reimbursements; account-level charges below |
| Revenue | Gross sales, refunds, promotions, net sales by product and by day; orders placed by status |
| Ads | Spend, sales, ACoS, ROAS, TACoS by ad type, product and campaign. Sponsored Brands spend = Amazon's ad charge − SP − SD, split by SB attributed sales |
| 45-day stock plan | Units to make = daily rate × (45 + lead time + 7 safety days) − (FBA + inbound + seller's warehouse) |
| GST & documents | Month → GSTIN: B2C/B2B sales, returns, output GST, TCS, stock transfers, Amazon fee invoices (input GST). One ZIP for the auditor |
| Product costs | Seller enters cost % or ₹ per unit and lead time. Default 25% of the GST-inclusive selling price, 30-day lead time |

Totals were checked against the Root and Soil workbook for 1–22 Oct 2026 (net sales ₹33,68,273.51, ad spend ₹2,01,488, profit ₹17.14 L, 50.9%).

## FirstCry (marketplace / dropship)

FirstCry pays a fixed **base cost** per delivered unit plus GST; there are no commission or shipping lines, and RTO / customer returns are recovered by debit note. So:

- Revenue (excl. GST) = base cost − RTO base − return base, from Vendor Reconciliation. Orders not yet in a reconciliation file are estimated at the product's latest base cost.
- Profit = revenue − product cost (seller's cost per unit, or a % of MRP; default 25%).
- Payout rate check: base cost ÷ MRP excl. GST per product vs the account's usual rate (61.75% for Root and Soil). Flags products paid less, e.g. when a GST rate changed but the base cost was not recalculated.
- Stock plan from demand (stock sits in the seller's warehouse; warehouse count optional).

Tabs: Overview, Profitability, Orders & returns, Payments, 45-day stock plan, Product costs.

| Report (FirstCry vendor panel) | How often | Range |
| --- | --- | --- |
| Sales report (`dashboardsale_…xlsx`) | Daily | Last 7 days |
| Vendor Reconciliation | Weekly | Order dates covering the last 45 days, so deliveries, payments and RTOs update |
| Sale Return data | Weekly | Last 30 days |
| All Product data | Monthly, and when products, MRP or GST change | Whole list |

Overlapping downloads never double count: sales and returns are keyed by order + product, reconciliation by PO item + unit, and a later file never blanks an invoice, payment advice or return recorded earlier.

## Myntra (PPMP marketplace, seller ships)

Customer price (MRP − seller discount) − Myntra's margin ("GT charges") = seller product amount (the seller's invoice). Myntra then deducts commission (0–4.72% incl. GST) and a fixed fee with shipping, plus TCS and TDS (tax credits, not costs). Customer returns take back the sale and add return shipping; RTOs carry no charges. Ads come on monthly "Marketing Claim" invoices.

- Sales (excl. GST) = customer price ÷ (1 + GST); revenue = seller product amount ÷ (1 + GST); fees = (commission + shipping) ÷ 1.18.
- Profit = revenue − fees − product cost − ads (each month's ads invoice spread over its days).
- Orders not yet in a settlement file are estimated from the orders report and the product's latest fees.

| Report (Myntra Partner Portal) | How often | Range |
| --- | --- | --- |
| MDirect Orders report (CSV) | Daily | Last 7 days |
| Settlement report (`SellerYearMonthWeekKey…xlsx`, settled and unsettled) | Weekly | Current and previous month |
| MDirect Returns report (CSV) | Weekly | Last 30 days |
| Tax invoices (PDF): Marketing Claim (ads), commission, logistics, MDirect | Monthly | |

Upload CSVs as downloaded: re-saving in Excel turns order IDs into numbers like `1.00366E+11`.

## Flipkart (seller ships)

Per order item the settlement report shows: sale amount (what the customer paid) + offer amount + my share (the seller's part of the offer, negative) = what the seller earns, incl. GST; minus the marketplace fee (commission, fixed, collection, shipping, return shipping…, excl. GST), TCS, TDS and GST on fees; plus the refund on a return = bank settlement value. Ads are bought through the Flipkart Ads wallet, topped up from payouts.

- Sales (excl. GST) = taxable value from the Sales report, net of returns and cancellations; revenue = what the seller earns ÷ (1 + GST), so it includes offers Flipkart funds; fees = −marketplace fee.
- Profit = revenue − fees − product cost − ads (Flipkart Ads spend, excl. GST: campaign-by-day report for totals, product report for the split by product).
- The settlement file stores item ids as rounded numbers, so its rows are matched to orders by order id + SKU.
- Orders not yet in a settlement report are estimated: price before discount + the seller's share of the discount, and the fee rate of the latest settled 30 days.
- GST tab: from the Sales report, by invoice / credit note date: sales, returns, GST, TCS and TDS by GSTIN, by state of delivery and rate, and by HSN; Flipkart's fee invoices for input credit; one ZIP per month for the auditor.
- Returns in rupees: settlement rows with a return, by payout date: sales taken back (RTO and customer returns), return shipping incl. GST, Seller Protection Fund received.

| Report | How often | Range |
| --- | --- | --- |
| Seller Hub › Reports › Orders (XLSX) | Daily | Last 7 days |
| Seller Hub › Reports › Tax reports › Sales report (XLSX) | Weekly | Month to date |
| Seller Hub › Payments › Settlement report (XLSX, all sheets) | Weekly | Month to date |
| Seller Hub › Returns (XLSX) | Weekly | Last 30 days |
| Flipkart Ads › Campaign report, day-wise (CSV) | Weekly | Month to date |
| Flipkart Ads › Product report (CSV, keep the Start/End Time lines) | Monthly | The whole month |
| Commission / tax invoices and credit notes (PDF or ZIP) | Monthly | |

## Setup (once)

1. **Supabase** (the Pexeta Ops project): SQL editor → run `supabase/schema.sql` (existing installs: run the numbered files you have not run yet, e.g. `009_flipkart.sql`). It runs after the ops schema and is safe to run again. It creates the `sd_` tables, row-level security, the private `sd-files` bucket, and seeds Root and Soil (seller ID A20LNIW0086CNE, six GSTINs).
2. **Supabase Auth**:
   - URL configuration → add `https://dashboard.pexeta.in/auth/callback` to Redirect URLs.
   - Providers → Email: keep enabled, keep **Confirm email** on. Turn **off** "Allow new users to sign up" for email if your project allows it (seller logins are created by the team). Google stays as it is for ops.
3. **Vercel**: new project from this repo, framework Next.js. Environment variables from `.env.example`. Domain `dashboard.pexeta.in` (CNAME `dashboard` → `cname.vercel-dns.com`).
4. Sign in with Google as a team member → **All accounts** → Root and Soil → **Upload reports**.
5. **Seller logins** → create the seller's login. A temporary password is shown once; share it privately. The seller changes it under **Login**.

## Daily routine (team)

Upload page → drop the day's Amazon reports in one go. Each report is recognised from its columns; ZIPs are opened. Re-uploading or overlapping periods never double counts.

Daily: Custom Unified Transaction (month to date), All Orders, Business Report by child item, Manage FBA Inventory, Active Listings, SP / SD advertised product, SB keyword, SB attributed purchases. Weekly: customer returns. Monthly: MTR B2C, B2B, stock transfer, and the fee and ads tax invoice PDFs.

The "Transactions for statement period" daily summaries are rejected on purpose: they have no SKU.

## Code map

- `src/lib/parsers/` – reads CSV / TXT / XLSX / ZIP / PDF, detects the report type, maps rows to `sd_` tables.
- `src/lib/save.ts` – upserts rows (keyed so re-uploads replace), fills ASINs, stores invoice PDFs.
- `src/lib/engine/` – profit, stock plan and summaries (pure functions).
- `src/lib/auth.ts` – team vs seller; `getAccount()` 404s for accounts a seller may not see.
- Reads run as the signed-in user (row-level security). Writes run on the server with the service role, after checks. Files are served by short-lived signed URLs.

## Checks

```bash
npm run test          # parsers vs independently computed totals, engine vs workbook, FirstCry parsers + engine, parser columns vs schema
```

`test-data/` holds client files and is git-ignored. Put the Root and Soil Amazon files there, the FirstCry files in `test-data/firstcry/` the Myntra files in `test-data/myntra/` and the Flipkart files in `test-data/flipkart/`, to run the checks.

**Local end-to-end** (optional): a Postgres with `supabase/test/supabase_stub.sql`, the ops schema and `supabase/schema.sql`, plus PostgREST on port 3009 with `jwt-secret = "local-e2e-secret-local-e2e-secret-0123456789"`; then `npx tsx --conditions=react-server scripts/e2e-local.ts`. It saves every test file through the real save layer, reads back as the seller with row-level security on, and checks totals, GST by GSTIN and isolation between sellers.

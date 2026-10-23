# Pexeta Seller Dashboard

`dashboard.pexeta.in`: profit, revenue, ads, a 45-day stock plan and GST documents for Pexeta's marketplace sellers. Amazon.in first (pilot: Root and Soil); Flipkart, Myntra, FirstCry and quick commerce next.

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

## Setup (once)

1. **Supabase** (the Pexeta Ops project): SQL editor → run `supabase/schema.sql`. It runs after the ops schema and is safe to run again. It creates the `sd_` tables, row-level security, the private `sd-files` bucket, and seeds Root and Soil (seller ID A20LNIW0086CNE, six GSTINs).
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
npm run test          # parsers vs independently computed totals, engine vs workbook, parser columns vs schema
```

`test-data/` holds client files and is git-ignored. Put the Root and Soil files there to run the checks.

**Local end-to-end** (optional): a Postgres with `supabase/test/supabase_stub.sql`, the ops schema and `supabase/schema.sql`, plus PostgREST on port 3009 with `jwt-secret = "local-e2e-secret-local-e2e-secret-0123456789"`; then `npx tsx --conditions=react-server scripts/e2e-local.ts`. It saves every test file through the real save layer, reads back as the seller with row-level security on, and checks totals, GST by GSTIN and isolation between sellers.

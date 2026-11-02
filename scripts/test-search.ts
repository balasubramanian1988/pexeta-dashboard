// Brand Analytics readers and the search engine vs figures counted independently (Python) from Root and Soil's
// October weekly files. Put the files in test-data/brand-analytics/. Run: npx tsx scripts/test-search.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUpload, type ParseResult } from "../src/lib/parsers";
import { brandMatcher, computeSearch, type AsinRow, type BasketRow, type QueryRow } from "../src/lib/engine/search";
import { buildBrandWorkbook } from "../src/lib/report";

const DIR = join(process.cwd(), "test-data", "brand-analytics");
type Ok = Extract<ParseResult, { ok: true }>;
let failures = 0;
function expect(label: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${got.toFixed(4)} (expected ${want.toFixed(4)})`);
}
function check(label: string, ok: boolean) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); }

async function main() {
  const res: Ok[] = [];
  for (const f of readdirSync(DIR).sort()) for (const r of await parseUpload(f, new Uint8Array(readFileSync(join(DIR, f))))) {
    if (!r.ok) { failures++; console.log(`FAIL  not recognised: ${r.fileName}: ${r.reason}`); continue; }
    res.push(r);
    console.log(`read  ${r.type.padEnd(10)} ${String(r.rows.length).padStart(5)}  ${r.periodStart}→${r.periodEnd}  ${r.fileName}`);
  }
  const rows = <T,>(t: string) => res.filter((r) => r.type === t).flatMap((r) => r.rows) as unknown as T[];
  const queries = rows<QueryRow>("ba_sqp"), asins = rows<AsinRow>("ba_scp"), basket = rows<BasketRow>("ba_basket");
  expect("SQP rows", queries.length, 4000, 0);
  expect("SQP our purchases (4 weeks)", queries.reduce((s, r) => s + r.purch_brand, 0), 2029, 0);
  expect("Catalogue rows", asins.length, 40 + 40 + 41 + 43, 0);
  expect("Catalogue purchases (4 weeks)", asins.reduce((s, r) => s + r.purchases, 0), 559 + 505 + 445 + 546, 0);
  expect("Week to 10 Oct: fast-delivery impressions", asins.filter((r) => r.period_end === "2026-10-10").reduce((s, r) => s + r.impr_fast, 0), 111971, 0);
  expect("Basket rows", basket.length, 39 + 38, 0);

  const isB = brandMatcher("Root and Soil");
  check("brand search: root and soil almond oil", isB("root and soil almond oil"));
  check("brand search: roots and soil baby products", isB("roots and soil baby products"));
  check("brand search: rootandsoil", isB("rootandsoil"));
  check("brand search: roohts coconut oios", isB("roohts coconut oios"));
  check("not brand: eight roots kids bedtime lotion", !isB("eight roots kids bedtime lotion"));
  check("not brand: coconut oil for baby", !isB("coconut oil for baby"));

  const names = new Map([["B09GWBGMR7", "Almond oil 100 ml"], ["B0DZ6JFH9F", "Almond milk lotion 210 ml"], ["B08Q7MNX4Z", "Tummy roll-on"], ["B09CMXKDV8", "Cold roll-on"]]);
  const s = computeSearch({ queries, asins, basket, brandName: "Root and Soil", names });
  expect("Weeks", s.weeks.length, 4, 0);
  // Counted by hand in Python with a looser rule (any search containing "root"): 1,626 of 2,029. The matcher is
  // stricter about competitors such as "eight roots", so expect a little less.
  check(`Brand-search share of our purchases about 79–81% (${((s.brandedShare ?? 0) * 100).toFixed(1)}%)`, (s.brandedShare ?? 0) > 0.77 && (s.brandedShare ?? 0) < 0.81);
  check("Opportunity: almond oil for baby skin", s.opportunities.some((o) => o.query === "almond oil for baby skin"));
  check("Fast-delivery drop flagged for Almond oil 100 ml", s.asinIssues.some((i) => i.kind === "fast_drop" && i.asin === "B09GWBGMR7"));
  check("Click-rate drop flagged for Almond milk lotion 210 ml", s.asinIssues.some((i) => (i.kind === "ctr_drop" || i.kind === "low_ctr") && i.asin === "B0DZ6JFH9F"));
  check("Bundle: tummy + cold roll-on", s.bundles.some((b) => [b.a, b.b].sort().join() === ["B08Q7MNX4Z", "B09CMXKDV8"].sort().join()));
  check("Progress compares two 2-week periods", s.progress?.weeksEach === 2 && s.progress.early === true);
  check("At most five actions", s.actions.length > 0 && s.actions.length <= 5);

  console.log("\nActions:"); for (const a of s.actions) console.log(`  [${a.owner}] ${a.title}\n      ${a.why}`);
  console.log("\nProgress:"); for (const m of s.progress?.metrics ?? []) console.log(`  ${m.label}: ${m.before.toFixed(3)} → ${m.after.toFixed(3)}`);
  console.log("Wins:", s.progress?.wins.map((w) => `${w.label} (${w.detail})`).join("; "));
  console.log("Slips:", s.progress?.slips.map((w) => `${w.label} (${w.detail})`).join("; "));
  console.log("Issues:", s.asinIssues.map((i) => `${i.kind}:${i.name}`).join(", "));
  // The Excel report gains an "Amazon search" sheet with the actions and progress.
  const wb = buildBrandWorkbook({ clientName: "Root and Soil", period: { from: "2026-10-01", to: "2026-10-31" }, prevFrom: "2026-08-31", prevTo: "2026-09-30", markets: [], extra: [], search: s, today: "2026-11-02" });
  const sheet = wb.getWorksheet("Amazon search");
  check("Excel: Amazon search sheet", !!sheet);
  const out = process.argv[2];
  if (out) await wb.xlsx.writeFile(out);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll search checks passed");
  process.exit(failures ? 1 : 0);
}
main();

// Checks every parsed row's keys exist as columns of its sd_ table in supabase/schema.sql.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseUpload } from "../src/lib/parsers";

const sql = readFileSync("supabase/schema.sql", "utf8");
const cols = new Map<string, Set<string>>();
for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
  const set = new Set<string>();
  for (const line of m[2].split("\n")) { const c = line.trim().match(/^([a-z][a-z0-9_]*)\s+(?!key)/)?.[1]; if (c && c !== "primary") set.add(c); }
  cols.set(m[1], set);
}
(async () => {
  let bad = 0;
  const seen = new Set<string>();
  const files = ["test-data", "test-data/firstcry", "test-data/myntra", "test-data/brand-analytics"].flatMap((d) => { try { return readdirSync(d).map((f) => join(d, f)).filter((f) => statSync(f).isFile()); } catch { return []; } });
  for (const path of files) for (const r of await parseUpload(path.split("/").pop()!, new Uint8Array(readFileSync(path)), "2026-10-22")) {
    if (!r.ok || !r.rows.length || seen.has(r.type)) continue;
    seen.add(r.type);
    if (!r.rows.length) continue;
    const c = cols.get(r.table);
    if (!c) { console.log("NO TABLE", r.table); bad++; continue; }
    const missing = Object.keys(r.rows[0]).filter((k) => !c.has(k));
    console.log(`${missing.length ? "FAIL" : "PASS"}  ${r.type} → ${r.table}${missing.length ? " missing: " + missing.join(", ") : ""}`);
    if (missing.length) bad++;
  }
  process.exit(bad ? 1 : 0);
})();

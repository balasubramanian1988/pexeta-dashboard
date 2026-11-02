// Amazon Brand Analytics → what is working in search, what to do next, and what has improved since tracking began.
// Pure functions. Every statement is worked out from the uploaded weekly reports; thresholds are written next to each rule.

export type QueryRow = {
  period_end: string; query: string; volume: number;
  impr_total: number; impr_brand: number; click_total: number; click_brand: number;
  cart_total: number; cart_brand: number; purch_total: number; purch_brand: number;
  price_median: number | null; brand_price_median: number | null;
};
export type AsinRow = {
  period_end: string; asin: string; impressions: number; impr_fast: number; clicks: number; cart_adds: number;
  purchases: number; purch_fast: number; sales: number; price_median: number | null;
};
export type BasketRow = {
  period_end: string; asin: string; orders: number;
  with_asin_1: string; with_title_1: string; with_pct_1: number;
  with_asin_2: string; with_title_2: string; with_pct_2: number;
  with_asin_3: string; with_title_3: string; with_pct_3: number;
};

export type Week = {
  end: string;
  impressions: number; clicks: number; purchases: number; sales: number; fastImprShare: number | null;
  brandedPurch: number;        // our purchases on searches for the brand
  genericPurch: number;        // our purchases on all other searches: new customers
  genericMarketPurch: number;  // all purchases on those other searches, any brand
  hasQueries: boolean;         // search-term report uploaded for this week
};
export type Opportunity = { query: string; marketPurch: number; imprShare: number; clickShare: number; purchShare: number; ourPurch: number };
export type QueryIssue = { query: string; marketPurch: number; imprShare: number; clickShare: number; purchShare: number };
export type AsinStat = {
  asin: string; name: string; impressions: number; clicks: number; purchases: number; sales: number;
  ctr: number | null; conversion: number | null; fastShare: number | null; fastShareBefore: number | null; fastShareAfter: number | null;
  ctrBefore: number | null; ctrAfter: number | null; priceBefore: number | null; priceAfter: number | null;
};
export type AsinIssue = { asin: string; name: string; kind: "low_ctr" | "ctr_drop" | "low_conversion" | "fast_drop"; detail: string; weight: number };
export type Bundle = { a: string; aName: string; b: string; bName: string; pct: number; orders: number; month: string };
export type Metric = { label: string; before: number; after: number; unit: "count" | "rupees" | "pct"; higherIsBetter: boolean };
export type Win = { label: string; detail: string };
export type Action = { owner: "Seller" | "Pexeta" | "Seller + Pexeta"; title: string; why: string };

export type SearchResult = {
  weeks: Week[];
  recent: { from: string; to: string; weeks: number } | null;
  brandedShare: number | null;          // of our search purchases in the recent weeks, the share from brand searches
  opportunities: Opportunity[];
  queryIssues: QueryIssue[];
  asins: AsinStat[];
  asinIssues: AsinIssue[];
  bundles: Bundle[];
  progress: { baseline: { from: string; to: string }; current: { from: string; to: string }; weeksEach: number; early: boolean; metrics: Metric[]; wins: Win[]; slips: Win[] } | null;
  actions: Action[];
  topQueries: (Opportunity & { branded: boolean })[];
};

const share = (a: number, b: number) => (b > 0 ? a / b : 0);
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const minusDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Searches for the brand itself, including common misspellings: "root and soil", "roots soil", "rootandsoil", "roohts". */
export function brandMatcher(brandName: string) {
  const words = brandName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["and", "the", "for", "pvt", "ltd"].includes(w));
  const joined = words.join("");
  const joinedAll = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lead = words[0] ?? "";
  return (query: string) => {
    const q = query.toLowerCase();
    const flat = q.replace(/[^a-z0-9]/g, "");
    if ((joined && flat.includes(joined)) || (joinedAll.length >= 6 && flat.includes(joinedAll))) return true;
    const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length > 1 && words.slice(1).some((w) => w.length >= 4 && tokens.includes(w)) && tokens.some((t) => lead && t.startsWith(lead.slice(0, 3)))) return true;
    if (tokens.some((t) => words.includes(t) && t.length >= 5)) return true;
    // A misspelt first word on its own ("roohts coconut oil") only in short searches, so "eight roots kids lotion" stays a competitor's.
    return tokens.length <= 3 && lead.length >= 4 && tokens.some((t) => t.startsWith(lead.slice(0, 3)) && Math.abs(t.length - lead.length) <= 2);
  };
}

type Agg = { it: number; ib: number; ct: number; cb: number; pt: number; pb: number };
function aggQueries(rows: QueryRow[]) {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const a = m.get(r.query) ?? { it: 0, ib: 0, ct: 0, cb: 0, pt: 0, pb: 0 };
    a.it += r.impr_total; a.ib += r.impr_brand; a.ct += r.click_total; a.cb += r.click_brand; a.pt += r.purch_total; a.pb += r.purch_brand;
    m.set(r.query, a);
  }
  return m;
}

export function computeSearch(args: { queries: QueryRow[]; asins: AsinRow[]; basket: BasketRow[]; brandName: string; names: Map<string, string> }): SearchResult {
  const isBranded = brandMatcher(args.brandName);
  const nameOf = (asin: string) => args.names.get(asin) || asin;
  const ends = [...new Set([...args.queries.map((r) => r.period_end), ...args.asins.map((r) => r.period_end)])].sort();

  // ---------- Weekly trend ----------
  const weeks: Week[] = ends.map((end) => {
    const q = args.queries.filter((r) => r.period_end === end);
    const a = args.asins.filter((r) => r.period_end === end);
    const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    const generic = q.filter((r) => !isBranded(r.query));
    const impressions = sum(a, (r) => r.impressions);
    return {
      end, impressions, clicks: sum(a, (r) => r.clicks), purchases: sum(a, (r) => r.purchases), sales: sum(a, (r) => r.sales),
      fastImprShare: impressions ? sum(a, (r) => r.impr_fast) / impressions : null,
      brandedPurch: sum(q.filter((r) => isBranded(r.query)), (r) => r.purch_brand),
      genericPurch: sum(generic, (r) => r.purch_brand),
      genericMarketPurch: sum(generic, (r) => r.purch_total),
      hasQueries: q.length > 0,
    };
  });

  const empty: SearchResult = { weeks, recent: null, brandedShare: null, opportunities: [], queryIssues: [], asins: [], asinIssues: [], bundles: [], progress: null, actions: [], topQueries: [] };
  if (!ends.length) return empty;

  // ---------- The latest four weeks ----------
  const recentEnds = ends.slice(-4);
  const inRecent = (e: string) => recentEnds.includes(e);
  const half = Math.max(1, Math.floor(recentEnds.length / 2));
  const earlyEnds = recentEnds.slice(0, half), lateEnds = recentEnds.slice(-half);
  const recent = { from: minusDays(recentEnds[0], 6), to: recentEnds[recentEnds.length - 1], weeks: recentEnds.length };
  const rq = aggQueries(args.queries.filter((r) => inRecent(r.period_end)));

  const rw = weeks.filter((w) => inRecent(w.end));
  const branded = rw.reduce((s, w) => s + w.brandedPurch, 0), generic = rw.reduce((s, w) => s + w.genericPurch, 0);
  const brandedShare = branded + generic ? branded / (branded + generic) : null;

  const topQueries = [...rq.entries()].map(([query, a]) => ({ query, branded: isBranded(query), marketPurch: a.pt, imprShare: share(a.ib, a.it), clickShare: share(a.cb, a.ct), purchShare: share(a.pb, a.pt), ourPurch: a.pb }))
    .sort((x, y) => y.marketPurch - x.marketPurch);

  // Opportunity: on a non-brand search with real demand (20+ purchases in four weeks), we win buyers at 1.5× or more
  // the rate we are shown, and at least 5% of purchases. More visibility there should turn into sales.
  const opportunities = topQueries
    .filter((x) => !x.branded && x.marketPurch >= 20 && x.ourPurch >= 2 && x.purchShare >= 0.05 && x.purchShare >= 1.5 * x.imprShare)
    .sort((x, y) => y.marketPurch * (y.purchShare - y.imprShare) - x.marketPurch * (x.purchShare - x.imprShare))
    .slice(0, 12);

  // Seen but not clicked: shown in 5%+ of results on a busy search, but clicked at less than 60% of that rate.
  const queryIssues = topQueries
    .filter((x) => !x.branded && x.marketPurch >= 20 && x.imprShare >= 0.05 && x.clickShare < 0.6 * x.imprShare)
    .sort((x, y) => y.imprShare * y.marketPurch - x.imprShare * x.marketPurch)
    .slice(0, 10);

  // ---------- Products ----------
  const byAsin = new Map<string, AsinRow[]>();
  for (const r of args.asins) if (inRecent(r.period_end)) byAsin.set(r.asin, [...(byAsin.get(r.asin) ?? []), r]);
  const fastShare = (rows: AsinRow[]) => { const i = rows.reduce((s, r) => s + r.impressions, 0); return i ? rows.reduce((s, r) => s + r.impr_fast, 0) / i : null; };
  const ctrOf = (rows: AsinRow[]) => { const i = rows.reduce((s, r) => s + r.impressions, 0); return i ? rows.reduce((s, r) => s + r.clicks, 0) / i : null; };
  const priceOf = (rows: AsinRow[]) => { const p = rows.map((r) => r.price_median).filter((v): v is number => v != null && v > 0); return p.length ? p[p.length - 1] : null; };
  const asins: AsinStat[] = [...byAsin.entries()].map(([asin, rows]) => {
    const sum = (f: (r: AsinRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const impressions = sum((r) => r.impressions), clicks = sum((r) => r.clicks), purchases = sum((r) => r.purchases);
    const early = rows.filter((r) => earlyEnds.includes(r.period_end)).sort((a, b) => a.period_end.localeCompare(b.period_end));
    const late = rows.filter((r) => lateEnds.includes(r.period_end)).sort((a, b) => a.period_end.localeCompare(b.period_end));
    return {
      asin, name: nameOf(asin), impressions, clicks, purchases, sales: sum((r) => r.sales),
      ctr: impressions ? clicks / impressions : null, conversion: clicks ? purchases / clicks : null,
      fastShare: fastShare(rows), fastShareBefore: fastShare(early), fastShareAfter: fastShare(late),
      ctrBefore: ctrOf(early), ctrAfter: ctrOf(late), priceBefore: priceOf(early), priceAfter: priceOf(late),
    };
  }).sort((a, b) => b.sales - a.sales);

  const sizeable = asins.filter((a) => a.impressions >= 2000 * recentEnds.length / 4);
  const medCtr = median(sizeable.map((a) => a.ctr ?? 0));
  const medConv = median(asins.filter((a) => a.clicks >= 50).map((a) => a.conversion ?? 0));
  const asinIssues: AsinIssue[] = [];
  for (const a of asins) {
    const earlyRows = (byAsin.get(a.asin) ?? []).filter((r) => earlyEnds.includes(r.period_end));
    const earlyImpr = earlyRows.reduce((s, r) => s + r.impressions, 0);
    const earlyFast = earlyRows.reduce((s, r) => s + r.impr_fast, 0);
    // Fast delivery: at least 1,000 same-day / 1-day impressions a week before, and either their share of the product's
    // impressions fell by 25% or more, or their number fell by 40% or more while the share fell by 15% or more.
    const lateFast = (byAsin.get(a.asin) ?? []).filter((r) => lateEnds.includes(r.period_end)).reduce((s, r) => s + r.impr_fast, 0);
    if (recentEnds.length >= 2 && a.fastShareBefore != null && a.fastShareAfter != null && earlyFast / half >= 1000
      && (a.fastShareAfter <= a.fastShareBefore * 0.75 || (lateFast <= earlyFast * 0.6 && a.fastShareAfter <= a.fastShareBefore * 0.85)))
      asinIssues.push({ asin: a.asin, name: a.name, kind: "fast_drop", weight: earlyFast, detail: `Same-day / 1-day delivery shown in ${pct(a.fastShareAfter)} of its search results, down from ${pct(a.fastShareBefore)}. Usually low FBA stock at some warehouses, or a lost delivery badge.` });
    // Click rate fell by 25% or more between the two halves, on 3,000+ impressions a week.
    if (recentEnds.length >= 2 && a.ctrBefore != null && a.ctrAfter != null && earlyImpr / half >= 3000 && a.ctrAfter <= a.ctrBefore * 0.75) {
      const price = a.priceBefore != null && a.priceAfter != null && a.priceAfter !== a.priceBefore ? ` Price in search moved from ₹${a.priceBefore} to ₹${a.priceAfter}.` : "";
      asinIssues.push({ asin: a.asin, name: a.name, kind: "ctr_drop", weight: a.impressions, detail: `Click rate fell from ${pct(a.ctrBefore, 2)} to ${pct(a.ctrAfter, 2)} while it was shown more.${price}` });
    } else if (a.impressions >= 5000 && a.ctr != null && medCtr > 0 && a.ctr < 0.6 * medCtr)
      // Click rate under 60% of the brand's typical product, on 5,000+ impressions.
      asinIssues.push({ asin: a.asin, name: a.name, kind: "low_ctr", weight: a.impressions, detail: `Shown ${a.impressions.toLocaleString("en-IN")} times but clicked ${pct(a.ctr, 2)} of the time, against ${pct(medCtr, 2)} for the brand's typical product.` });
    // Conversion under 60% of the brand's typical product, on 50+ clicks.
    if (a.clicks >= 50 && a.conversion != null && medConv > 0 && a.conversion < 0.6 * medConv)
      asinIssues.push({ asin: a.asin, name: a.name, kind: "low_conversion", weight: a.clicks, detail: `${a.clicks} clicks but ${pct(a.conversion, 1)} bought, against ${pct(medConv, 1)} for the brand's typical product.` });
  }
  asinIssues.sort((x, y) => y.weight - x.weight);

  // ---------- Bundles: our own products bought in the same order (latest month, 20%+ of 10+ orders) ----------
  const own = new Set(args.asins.map((r) => r.asin).concat(args.basket.map((r) => r.asin)));
  const lastMonth = args.basket.map((r) => r.period_end).sort().pop();
  const pairs = new Map<string, Bundle>();
  for (const r of args.basket.filter((x) => x.period_end === lastMonth && x.orders >= 10)) {
    for (const i of [1, 2, 3] as const) {
      const b = r[`with_asin_${i}`], p = r[`with_pct_${i}`];
      if (!b || p < 0.2 || !own.has(b)) continue;
      const key = [r.asin, b].sort().join("|");
      const prev = pairs.get(key);
      if (!prev || prev.pct < p) pairs.set(key, { a: r.asin, aName: nameOf(r.asin), b, bName: nameOf(b) === b ? r[`with_title_${i}`].slice(0, 60) : nameOf(b), pct: p, orders: r.orders, month: lastMonth! });
    }
  }
  const bundles = [...pairs.values()].sort((x, y) => y.pct * y.orders - x.pct * x.orders).slice(0, 6);

  // ---------- Progress since tracking began ----------
  let progress: SearchResult["progress"] = null;
  if (ends.length >= 2) {
    const k = Math.min(4, Math.floor(ends.length / 2));
    const be = ends.slice(0, k), ce = ends.slice(-k);
    const per = (sel: string[], f: (w: Week) => number) => weeks.filter((w) => sel.includes(w.end)).reduce((s, w) => s + f(w), 0) / sel.length;
    const ratio = (sel: string[], f: (w: Week) => number, g: (w: Week) => number) => { const ws = weeks.filter((w) => sel.includes(w.end)); const d = ws.reduce((s, w) => s + g(w), 0); return d ? ws.reduce((s, w) => s + f(w), 0) / d : 0; };
    // Search-term figures only from weeks whose search-term report was uploaded.
    const qw = (sel: string[]) => weeks.filter((w) => sel.includes(w.end) && w.hasQueries);
    const perQ = (sel: string[], f: (w: Week) => number) => { const ws = qw(sel); return ws.length ? ws.reduce((s, w) => s + f(w), 0) / ws.length : NaN; };
    const ratioQ = (sel: string[], f: (w: Week) => number, g: (w: Week) => number) => { const ws = qw(sel); const d = ws.reduce((s, w) => s + g(w), 0); return d ? ws.reduce((s, w) => s + f(w), 0) / d : NaN; };
    const metrics: Metric[] = [
      { label: "Purchases from Amazon search, per week", before: per(be, (w) => w.purchases), after: per(ce, (w) => w.purchases), unit: "count", higherIsBetter: true },
      { label: "Sales from Amazon search, per week (incl. GST)", before: per(be, (w) => w.sales), after: per(ce, (w) => w.sales), unit: "rupees", higherIsBetter: true },
      { label: "New-customer purchases (non-brand searches), per week", before: perQ(be, (w) => w.genericPurch), after: perQ(ce, (w) => w.genericPurch), unit: "count", higherIsBetter: true },
      { label: "Share of non-brand search purchases won", before: ratioQ(be, (w) => w.genericPurch, (w) => w.genericMarketPurch), after: ratioQ(ce, (w) => w.genericPurch, (w) => w.genericMarketPurch), unit: "pct", higherIsBetter: true },
      { label: "Times shown in search, per week", before: per(be, (w) => w.impressions), after: per(ce, (w) => w.impressions), unit: "count", higherIsBetter: true },
      { label: "Click rate from search", before: ratio(be, (w) => w.clicks, (w) => w.impressions), after: ratio(ce, (w) => w.clicks, (w) => w.impressions), unit: "pct", higherIsBetter: true },
      { label: "Conversion (purchases ÷ clicks)", before: ratio(be, (w) => w.purchases, (w) => w.clicks), after: ratio(ce, (w) => w.purchases, (w) => w.clicks), unit: "pct", higherIsBetter: true },
    ];
    // Products and searches that moved, per week, between the two periods. Wins need a real change, not noise.
    const asinPer = (sel: string[]) => { const m = new Map<string, { p: number; c: number; i: number }>(); for (const r of args.asins.filter((x) => sel.includes(x.period_end))) { const a = m.get(r.asin) ?? { p: 0, c: 0, i: 0 }; a.p += r.purchases / sel.length; a.c += r.clicks / sel.length; a.i += r.impressions / sel.length; m.set(r.asin, a); } return m; };
    const ab = asinPer(be), ac = asinPer(ce);
    const wins: Win[] = [], slips: Win[] = [];
    for (const [asin, c] of ac) {
      const b = ab.get(asin) ?? { p: 0, c: 0, i: 0 };
      const d = c.p - b.p;
      if (Math.abs(d) >= 2 && (b.p === 0 || Math.abs(d) / b.p >= 0.25)) {
        const w = { label: nameOf(asin), detail: `${b.p.toFixed(1)} → ${c.p.toFixed(1)} purchases a week from search` };
        (d > 0 ? wins : slips).push(w);
      }
    }
    const qb = aggQueries(args.queries.filter((r) => be.includes(r.period_end))), qc = aggQueries(args.queries.filter((r) => ce.includes(r.period_end)));
    for (const [q, c] of qc) {
      const b = qb.get(q);
      if (!b || isBranded(q) || b.pt < 10 * k / 2 || c.pt < 10 * k / 2) continue;
      const sb = share(b.pb, b.pt), sc = share(c.pb, c.pt);
      if (Math.abs(sc - sb) >= 0.03) (sc > sb ? wins : slips).push({ label: `“${q}”`, detail: `won ${pct(sb, 1)} → ${pct(sc, 1)} of purchases on this search` });
    }
    progress = { baseline: { from: minusDays(be[0], 6), to: be[be.length - 1] }, current: { from: minusDays(ce[0], 6), to: ce[ce.length - 1] }, weeksEach: k, early: ends.length < 8, metrics: metrics.filter((m) => Number.isFinite(m.before) && Number.isFinite(m.after)), wins: wins.slice(0, 8), slips: slips.slice(0, 8) };
  }

  // ---------- This month's actions: at most five, the most valuable first ----------
  const actions: Action[] = [];
  const fastAll = asinIssues.filter((x) => x.kind === "fast_drop");
  const fast = fastAll[0];
  const brandFast = (sel: string[]) => { const ws = weeks.filter((w) => sel.includes(w.end)); const i = ws.reduce((s, w) => s + w.impressions, 0); return i ? ws.reduce((s, w) => s + (w.fastImprShare ?? 0) * w.impressions, 0) / i : null; };
  const bfB = brandFast(earlyEnds), bfA = brandFast(lateEnds);
  if (fast && fastAll.length >= 3 && bfB != null && bfA != null)
    actions.push({ owner: "Seller + Pexeta", title: `Check FBA stock and delivery speed: fast delivery fell on ${fastAll.length} products, most on ${fast.name}`, why: `Across the brand, same-day / 1-day delivery was shown in ${pct(bfA)} of search results, down from ${pct(bfB)}. ${fast.name}: ${fast.detail.split(". ")[0].replace("Same-day / 1-day delivery shown in", "shown in")}.` });
  else if (fast) actions.push({ owner: "Seller + Pexeta", title: `Check FBA stock and delivery speed for ${fast.name}`, why: fast.detail });
  if (opportunities.length) {
    const top = opportunities.slice(0, 3);
    actions.push({ owner: "Pexeta", title: `Show up more on ${top.map((o) => `“${o.query}”`).join(", ")}`, why: `When shown, we win ${top.map((o) => pct(o.purchShare)).join(" / ")} of buyers but appear in only ${top.map((o) => pct(o.imprShare, 1)).join(" / ")} of results. Plan: ads and listing keywords on these searches.` });
  }
  const click = asinIssues.find((x) => x.kind === "ctr_drop" || x.kind === "low_ctr");
  if (click) actions.push({ owner: click.detail.includes("Price") ? "Seller + Pexeta" : "Pexeta", title: `Make ${click.name} more clickable: main image, title, price`, why: click.detail });
  const conv = asinIssues.find((x) => x.kind === "low_conversion");
  if (conv) actions.push({ owner: "Pexeta", title: `Improve the product page for ${conv.name}: images, A+ content, reviews`, why: conv.detail });
  if (bundles.length && actions.length < 5) {
    const b = bundles[0];
    actions.push({ owner: "Seller", title: `Consider a combo pack: ${b.aName} + ${b.bName}`, why: `Bought together in ${pct(b.pct)} of ${b.aName}'s ${b.orders} orders in ${b.month.slice(0, 7)}.` });
  }

  return { weeks, recent, brandedShare, opportunities, queryIssues, asins, asinIssues, bundles, progress, actions: actions.slice(0, 5), topQueries: topQueries.slice(0, 60) };
}

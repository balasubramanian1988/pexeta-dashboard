// Amazon Search & listings, from Brand Analytics. Sellers see this month's actions, what Pexeta has improved and
// where sales come from; the team also sees the detail behind every action.
import { notFound } from "next/navigation";
import { Empty, Kpi, PageHeader, Section, StatusPill } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getSearch } from "@/lib/data";
import type { AsinIssue, Metric, SearchResult } from "@/lib/engine/search";
import { compactRupees, count, dateLabel, percent } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Search & listings" };

const ISSUE_LABEL: Record<AsinIssue["kind"], { label: string; tone: "red" | "amber" }> = {
  fast_drop: { label: "Fast delivery fell", tone: "red" },
  ctr_drop: { label: "Click rate fell", tone: "red" },
  low_ctr: { label: "Seen, rarely clicked", tone: "amber" },
  low_conversion: { label: "Clicked, rarely bought", tone: "amber" },
};

function fmt(m: Metric, v: number) {
  return m.unit === "rupees" ? compactRupees(v) : m.unit === "pct" ? percent(v, v < 0.01 ? 2 : 1) : count(Math.round(v));
}
function change(m: Metric) {
  if (m.unit === "pct") { const d = (m.after - m.before) * 100; return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(m.after < 0.01 ? 2 : 1)} pts`; }
  if (!m.before) return m.after ? "new" : "–";
  const d = m.after / m.before - 1;
  return `${d >= 0 ? "+" : "−"}${percent(Math.abs(d), 0)}`;
}
const better = (m: Metric) => (m.after === m.before ? null : (m.after > m.before) === m.higherIsBetter);

function Progress({ p, team }: { p: NonNullable<SearchResult["progress"]>; team: boolean }) {
  return (
    <Section title="What Pexeta has improved"
      sub={<>Average week in {dateLabel(p.baseline.from)} – {dateLabel(p.baseline.to)} (when tracking began) against {dateLabel(p.current.from)} – {dateLabel(p.current.to)}. Every figure is Amazon&apos;s own, from Brand Analytics.{p.early ? " Early days: comparisons become reliable after about eight weeks of reports." : ""}</>}>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Measure</th><th className="num">Then</th><th className="num">Now</th><th className="num">Change</th></tr></thead>
          <tbody>
            {p.metrics.map((m) => {
              const b = better(m);
              return (
                <tr key={m.label}><td>{m.label}</td><td className="num text-muted">{fmt(m, m.before)}</td><td className="num font-semibold">{fmt(m, m.after)}</td>
                  <td className={`num font-semibold ${b == null ? "text-faint" : b ? "text-emerald-700" : "text-red-700"}`}>{b == null ? "–" : `${b ? "▲" : "▼"} ${change(m)}`}</td></tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 border-t border-line px-4 py-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-emerald-800">Gains</h3>
          {!p.wins.length ? <p className="mt-1 text-xs text-muted">No product or search has moved clearly up yet.</p> : (
            <ul className="mt-1 space-y-1.5 text-sm">{p.wins.slice(0, team ? 8 : 5).map((w) => <li key={w.label}><b>{w.label}</b><span className="text-xs text-muted">: {w.detail}</span></li>)}</ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-bold text-amber-800">To watch</h3>
          {!p.slips.length ? <p className="mt-1 text-xs text-muted">Nothing has moved clearly down.</p> : (
            <ul className="mt-1 space-y-1.5 text-sm">{p.slips.slice(0, team ? 8 : 3).map((w) => <li key={w.label}><b>{w.label}</b><span className="text-xs text-muted">: {w.detail}</span></li>)}</ul>
          )}
        </div>
      </div>
    </Section>
  );
}

export default async function SearchPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  if (account.marketplace !== "Amazon") notFound();
  const team = viewer.kind === "team";
  const { result: r, hasData, hasQueries, hasAsins, hasBasket } = await getSearch(account);
  const trend = r.weeks.filter((w) => w.hasQueries).slice(-12);
  const maxP = Math.max(1, ...trend.map((w) => w.brandedPurch + w.genericPurch));

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Search & listings"
        sub={r.recent ? <>From Amazon Brand Analytics weekly reports. Findings use the latest {r.recent.weeks} week{r.recent.weeks > 1 ? "s" : ""}: {dateLabel(r.recent.from)} to {dateLabel(r.recent.to)}. Search sales include GST.</> : "From Amazon Brand Analytics weekly reports."} />

      {!hasData ? (
        <div className="card"><Empty>No Brand Analytics reports yet.{team ? <> <Link href={`/a/${account.id}/uploads`} className="font-semibold text-brand underline">Upload</Link> Search Query Performance (brand view) and Search Catalogue Performance, weekly.</> : " Pexeta uploads them weekly."}</Empty></div>
      ) : (
        <>
          {team && (!hasQueries || !hasAsins || !hasBasket) && (
            <p className="mb-4 text-xs text-muted"><StatusPill tone="amber">Missing</StatusPill> {[!hasQueries && "Search Query Performance (brand view, weekly)", !hasAsins && "Search Catalogue Performance (weekly)", !hasBasket && "Market Basket Analysis (monthly)"].filter(Boolean).join(", ")}.</p>
          )}

          <Section title="This month's actions" sub="The most valuable things to do next, worked out from the reports. Owner shows who acts.">
            {!r.actions.length ? <Empty>Nothing needs action from these weeks.</Empty> : (
              <ol className="divide-y divide-line">
                {r.actions.map((a, i) => (
                  <li key={a.title} className="flex gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                    <div>
                      <div className="text-sm font-semibold">{a.title} <StatusPill tone={a.owner === "Pexeta" ? "blue" : a.owner === "Seller" ? "amber" : "grey"}>{a.owner}</StatusPill></div>
                      <div className="mt-0.5 text-xs text-muted">{a.why}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {r.progress ? <Progress p={r.progress} team={team} /> : (
            <Section title="What Pexeta has improved"><Empty>Progress appears once two or more weeks of reports are uploaded: the first weeks become the starting point.</Empty></Section>
          )}

          {trend.length > 0 && (
            <Section title="Where search sales come from" sub="Purchases from Amazon search each week: people who searched for the brand, and new customers who searched for the product type.">
              <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-3">
                <Kpi label="From brand searches (latest weeks)" value={r.brandedShare == null ? "–" : percent(r.brandedShare, 0)} sub="Customers who already know the brand" />
                <Kpi label="From other searches (latest weeks)" value={r.brandedShare == null ? "–" : percent(1 - r.brandedShare, 0)} sub="New customers: where growth comes from" />
                <Kpi label="Share of non-brand search purchases" value={(() => { const w = trend.slice(-4); const m = w.reduce((s, x) => s + x.genericMarketPurch, 0); return m ? percent(w.reduce((s, x) => s + x.genericPurch, 0) / m, 2) : "–"; })()} sub="Of everyone buying on those searches" />
              </div>
              <table className="tbl">
                <thead><tr><th>Week ending</th><th className="num">Brand searches</th><th className="num">New customers</th><th className="w-1/2"></th></tr></thead>
                <tbody>
                  {trend.map((w) => (
                    <tr key={w.end}><td>{dateLabel(w.end)}</td><td className="num">{count(w.brandedPurch)}</td><td className="num">{count(w.genericPurch)}</td>
                      <td><div className="flex h-2.5 overflow-hidden rounded-full bg-ice-dim" style={{ width: `${((w.brandedPurch + w.genericPurch) / maxP) * 100}%` }}>
                        <span style={{ width: `${(w.brandedPurch / Math.max(1, w.brandedPurch + w.genericPurch)) * 100}%`, background: "#0b2a4a" }} />
                        <span className="flex-1" style={{ background: "#f2871e" }} />
                      </div></td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {team && (
            <>
              <Section title="Opportunities: searches to show up on more" sub="Non-brand searches where we win buyers at 1.5× or more the rate we are shown. More visibility here (ads, keywords) should turn into sales. Latest four weeks.">
                {!r.opportunities.length ? <Empty>No clear opportunities in these weeks.</Empty> : (
                  <div className="overflow-x-auto"><table className="tbl">
                    <thead><tr><th>Search</th><th className="num">Purchases (all brands)</th><th className="num">Our share shown</th><th className="num">Our share clicked</th><th className="num">Our share bought</th><th className="num">Our purchases</th></tr></thead>
                    <tbody>{r.opportunities.map((o) => <tr key={o.query}><td>{o.query}</td><td className="num">{count(o.marketPurch)}</td><td className="num">{percent(o.imprShare, 1)}</td><td className="num">{percent(o.clickShare, 1)}</td><td className="num font-semibold text-emerald-700">{percent(o.purchShare, 1)}</td><td className="num">{count(o.ourPurch)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </Section>

              <Section title="Products in search" sub="Latest four weeks. Fast delivery = share of search results showing same-day or 1-day delivery, first half of the weeks → second half.">
                <div className="overflow-x-auto"><table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Shown</th><th className="num">Click rate</th><th className="num">Bought ÷ clicks</th><th className="num">Purchases</th><th className="num">Search sales</th><th className="num">Fast delivery</th><th>Flags</th></tr></thead>
                  <tbody>{r.asins.map((a) => {
                    const flags = r.asinIssues.filter((i) => i.asin === a.asin);
                    return (
                      <tr key={a.asin}><td className="max-w-72">{a.name}<div className="text-[11px] text-faint">{a.asin}</div></td><td className="num">{count(a.impressions)}</td><td className="num">{a.ctr == null ? "–" : percent(a.ctr, 2)}</td><td className="num">{a.conversion == null ? "–" : percent(a.conversion, 1)}</td><td className="num">{count(a.purchases)}</td><td className="num">{compactRupees(a.sales)}</td>
                        <td className="num">{a.fastShareBefore == null || a.fastShareAfter == null ? "–" : `${percent(a.fastShareBefore, 0)} → ${percent(a.fastShareAfter, 0)}`}</td>
                        <td>{flags.map((f) => <span key={f.kind} className="mr-1" title={f.detail}><StatusPill tone={ISSUE_LABEL[f.kind].tone}>{ISSUE_LABEL[f.kind].label}</StatusPill></span>)}</td></tr>
                    );
                  })}</tbody>
                </table></div>
              </Section>

              {r.asinIssues.length > 0 && (
                <Section title="Product problems, in detail" sub="Compared with the brand's typical product, or with the first half of the latest weeks.">
                  <ul className="divide-y divide-line text-sm">{r.asinIssues.slice(0, 20).map((i) => <li key={`${i.asin}-${i.kind}`} className="px-4 py-2.5"><StatusPill tone={ISSUE_LABEL[i.kind].tone}>{ISSUE_LABEL[i.kind].label}</StatusPill> <b>{i.name}</b><div className="mt-0.5 text-xs text-muted">{i.detail}</div></li>)}</ul>
                </Section>
              )}

              {r.queryIssues.length > 0 && (
                <Section title="Searches where we are seen but not clicked" sub="Shown in 5%+ of results but clicked at under 60% of that rate: check main image, title, price and rating against the products shoppers click instead.">
                  <div className="overflow-x-auto"><table className="tbl">
                    <thead><tr><th>Search</th><th className="num">Purchases (all brands)</th><th className="num">Our share shown</th><th className="num">Our share clicked</th><th className="num">Our share bought</th></tr></thead>
                    <tbody>{r.queryIssues.map((o) => <tr key={o.query}><td>{o.query}</td><td className="num">{count(o.marketPurch)}</td><td className="num">{percent(o.imprShare, 1)}</td><td className="num text-red-700">{percent(o.clickShare, 1)}</td><td className="num">{percent(o.purchShare, 1)}</td></tr>)}</tbody>
                  </table></div>
                </Section>
              )}

              {r.bundles.length > 0 && (
                <Section title="Bought together" sub="Our own products in the same order, from Market Basket Analysis (latest month). Ideas for combo packs and for ads on each other's pages.">
                  <table className="tbl">
                    <thead><tr><th>Product</th><th>Also bought</th><th className="num">Share of its orders</th><th className="num">Its orders</th></tr></thead>
                    <tbody>{r.bundles.map((b) => <tr key={`${b.a}-${b.b}`}><td>{b.aName}</td><td>{b.bName}</td><td className="num font-semibold">{percent(b.pct, 0)}</td><td className="num">{count(b.orders)}</td></tr>)}</tbody>
                  </table>
                </Section>
              )}

              <Section title="Top searches" sub="Latest four weeks, by purchases across all brands. Brand searches are marked.">
                <div className="overflow-x-auto"><table className="tbl">
                  <thead><tr><th>Search</th><th className="num">Purchases (all brands)</th><th className="num">Shown</th><th className="num">Clicked</th><th className="num">Bought</th><th className="num">Our purchases</th></tr></thead>
                  <tbody>{r.topQueries.slice(0, 40).map((o) => <tr key={o.query}><td>{o.query}{o.branded && <span className="ml-1.5"><StatusPill tone="grey">brand</StatusPill></span>}</td><td className="num">{count(o.marketPurch)}</td><td className="num">{percent(o.imprShare, 1)}</td><td className="num">{percent(o.clickShare, 1)}</td><td className="num">{percent(o.purchShare, 1)}</td><td className="num">{count(o.ourPurch)}</td></tr>)}</tbody>
                </table></div>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}

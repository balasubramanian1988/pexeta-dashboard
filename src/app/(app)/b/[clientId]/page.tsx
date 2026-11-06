// All marketplaces for one brand: headline numbers, a scorecard per marketplace, findings and daily sales.
import Link from "next/link";
import PeriodPicker from "@/components/PeriodPicker";
import { Empty, Kpi, KpiRupees, PageHeader, PeriodNote, Section } from "@/components/ui";
import { getBrandAccounts, getViewer } from "@/lib/auth";
import { getBrand, getClientWork, getReturns, getReturnsMoney, getSearch } from "@/lib/data";
import { brandTotals, findings, type MarketSummary } from "@/lib/engine/brand";
import { eachDay } from "@/lib/engine/summaries";
import { compactRupees, count, dateLabel, percent } from "@/lib/format";
import { getBrandPeriod } from "@/lib/period";
import { THEME_LABEL } from "@/lib/engine/returns";

export const metadata = { title: "All marketplaces" };

// Told apart by lightness as well as hue.
const COLOR: Record<string, string> = { Amazon: "#0b2a4a", Flipkart: "#1d6fb8", Myntra: "#f2871e", FirstCry: "#8fbde6" };
const colorOf = (m: string) => COLOR[m] ?? "#94a3b8";

function Swatch({ m }: { m: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(m) }} />;
}

/** Best (▲) and weakest (▼) mark for a scorecard column. */
function mark(rows: MarketSummary[], r: MarketSummary, f: (x: MarketSummary) => number | null, higherIsBetter: boolean) {
  const vals = rows.map(f).filter((v): v is number => v != null);
  const v = f(r);
  if (vals.length < 2 || v == null) return "";
  const best = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  const worst = higherIsBetter ? Math.min(...vals) : Math.max(...vals);
  return v === best ? " ▲" : v === worst ? " ▼" : "";
}

function StackedDaily({ rows, from, to }: { rows: MarketSummary[]; from: string; to: string }) {
  const days = eachDay(from, to);
  const totals = days.map((d) => rows.reduce((s, r) => s + Math.max(0, r.daily.get(d) ?? 0), 0));
  const max = Math.max(...totals, 1);
  const W = 720, H = 170, pad = 28, bw = (W - pad) / days.length;
  return (
    <figure className="px-4 py-4">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label="Net sales by day, stacked by marketplace">
        <line x1={pad} x2={W} y1={H} y2={H} stroke="var(--line)" />
        {days.map((d, i) => {
          let y = H;
          return (
            <g key={d}>
              {rows.map((r) => {
                const v = Math.max(0, r.daily.get(d) ?? 0);
                const h = (v / max) * (H - 12);
                y -= h;
                return h > 0 ? <rect key={r.accountId} x={pad + i * bw + bw * 0.15} y={y} width={bw * 0.7} height={h} fill={colorOf(r.marketplace)}><title>{`${dateLabel(d)} · ${r.marketplace}: ${compactRupees(v)}`}</title></rect> : null;
              })}
              {(days.length <= 16 || i % Math.ceil(days.length / 12) === 0) && <text x={pad + i * bw + bw / 2} y={H + 15} textAnchor="middle" fontSize="10" fill="var(--muted)">{Number(d.slice(8))}</text>}
            </g>
          );
        })}
        <text x={0} y={10} fontSize="10" fill="var(--muted)">{compactRupees(max)}</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        {rows.map((r) => <span key={r.accountId} className="inline-flex items-center gap-1.5"><Swatch m={r.marketplace} />{r.marketplace}</span>)}
      </figcaption>
    </figure>
  );
}

function SplitBar({ parts }: { parts: { m: string; w: number }[] }) {
  const sum = parts.reduce((s, p) => s + p.w, 0) || 1;
  return <div aria-hidden className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-ice-dim">{parts.map((p) => <span key={p.m} style={{ width: `${(p.w / sum) * 100}%`, background: colorOf(p.m) }} />)}</div>;
}

export default async function BrandPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { clientId } = await params;
  const [viewer, { clientName, accounts }] = await Promise.all([getViewer(), getBrandAccounts(clientId)]);
  const period = await getBrandPeriod(accounts.map((a) => a.id), await searchParams);
  const amazon = accounts.find((a) => a.marketplace === "Amazon");
  const [{ markets, extra, prevFrom, prevTo }, search, returns, work] = await Promise.all([getBrand(accounts, period.from, period.to, period.days), amazon ? getSearch(amazon) : Promise.resolve(null), getReturns(accounts, period.from, period.to), getClientWork(clientId, period.from, period.to)]);
  const money = await getReturnsMoney(accounts, period.from, period.to);
  const live = markets.filter((m) => m.hasData);
  const t = brandTotals(markets);
  const found = findings(markets, extra);
  const good = found.filter((f) => f.tone === "good"), bad = found.filter((f) => f.tone === "bad");
  const share = (m: MarketSummary) => (t.sales ? m.sales / t.sales : 0);
  const q = `?from=${period.from}&to=${period.to}`;
  const split = (f: (m: MarketSummary) => number) => live.map((m) => ({ m: m.marketplace, w: Math.max(0, f(m)) })).filter((x) => x.w > 0);

  return (
    <>
      <PageHeader eyebrow={`${clientName} · All marketplaces`} title="How the brand is doing"
        sub={<><PeriodNote from={period.from} to={period.to} />, compared with {dateLabel(prevFrom)} to {dateLabel(prevTo)}. Sales exclude GST. Amazon is by settlement date; FirstCry, Myntra and Flipkart by order date. Growth is shown only where uploads cover the whole previous period.</>}
        action={<div className="flex flex-wrap items-center gap-2">
          <PeriodPicker period={period} basePath={`/b/${clientId}`} />
          {live.length > 0 && <a href={`/api/b/${clientId}/report${q}`} download className="btn btn-outline whitespace-nowrap">Download Excel report</a>}
        </div>} />

      {!live.length ? <div className="card"><Empty>No marketplace data for these dates yet.{viewer.kind === "team" ? " Upload reports from each marketplace account." : ""}</Empty></div> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="card px-4 py-3.5">
              <div className="text-xs font-medium text-muted">Net sales (excl. GST)</div>
              <div className="tabular mt-1 text-xl font-bold text-navy">{compactRupees(t.sales)}</div>
              <div className={`mt-0.5 text-xs ${t.change == null ? "text-faint" : t.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{t.change == null ? "no full previous period uploaded" : `${t.change >= 0 ? "▲" : "▼"} ${percent(Math.abs(t.change), 0)} vs previous`}</div>
              <SplitBar parts={split((m) => m.sales)} />
            </div>
            <div className="card px-4 py-3.5">
              <div className="text-xs font-medium text-muted">Net profit</div>
              <div className={`tabular mt-1 text-xl font-bold ${t.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{compactRupees(t.profit)}</div>
              <div className="mt-0.5 text-xs text-faint">{percent(t.margin)} margin</div>
              <SplitBar parts={split((m) => m.profit)} />
            </div>
            <KpiRupees label="Marketplace fees" value={t.fees} sub={`${percent(t.sales ? t.fees / t.sales : 0)} of sales`} />
            <KpiRupees label="Ad spend" value={t.ads} sub={t.adsMissing.length ? `not incl. ${t.adsMissing.join(", ")}` : `${percent(t.sales ? t.ads / t.sales : 0)} of sales`} />
            <KpiRupees label="Product cost" value={t.productCost} sub={`${percent(t.sales ? t.productCost / t.sales : 0)} of sales`} />
            <Kpi label="Units sold" value={count(t.units)} sub="after returns" />
          </div>

          <Section title="Marketplace scorecard" sub="Where the money is made and where it leaks. ▲ best, ▼ weakest in each column. Fees, ads and returns as a share of sales.">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Marketplace</th><th className="num">Net sales</th><th>Share</th><th className="num">Units</th><th className="num">Returns</th><th className="num">Fees</th><th className="num">Ads</th><th className="num">Product cost</th><th className="num">Profit</th><th className="num">Margin</th><th className="num">Sales vs previous</th></tr></thead>
                <tbody>
                  {markets.map((m) => {
                    const ch = m.prevSales ? m.sales / m.prevSales - 1 : null;
                    return (
                      <tr key={m.accountId}>
                        <td className="whitespace-nowrap font-medium"><Link href={`/a/${m.accountId}${q}`} className="inline-flex items-center gap-2 text-brand hover:underline"><Swatch m={m.marketplace} />{m.marketplace}</Link>
                          {m.notes.map((n) => <div key={n} className="max-w-56 whitespace-normal text-[11px] font-normal text-faint">{n}</div>)}</td>
                        {!m.hasData ? <td colSpan={10} className="text-muted">{m.supported ? "No data for these dates." : "Reports from this marketplace are not read yet."}</td> : (
                          <>
                            <td className="num">{compactRupees(m.sales)}</td>
                            <td><span className="inline-flex items-center gap-2"><span className="inline-block h-1.5 w-16 rounded-full bg-ice-dim"><span className="block h-1.5 rounded-full" style={{ width: `${share(m) * 100}%`, background: colorOf(m.marketplace) }} /></span><span className="tabular text-xs text-muted">{percent(share(m), 0)}</span></span></td>
                            <td className="num">{count(m.units)}</td>
                            <td className="num">{m.returnRate == null ? "–" : percent(m.returnRate)}{mark(live, m, (x) => x.returnRate, false)}</td>
                            <td className="num">{percent(m.sales ? m.fees / m.sales : 0)}{mark(live, m, (x) => (x.sales ? x.fees / x.sales : null), false)}</td>
                            <td className="num">{m.ads == null ? <span className="text-faint">no data</span> : <>{percent(m.sales ? m.ads / m.sales : 0)}{mark(live.filter((x) => x.ads != null), m, (x) => (x.sales && x.ads != null ? x.ads / x.sales : null), false)}</>}</td>
                            <td className="num">{percent(m.sales ? m.productCost / m.sales : 0)}</td>
                            <td className={`num font-semibold ${m.profit < 0 ? "text-red-700" : ""}`}>{compactRupees(m.profit)}</td>
                            <td className="num font-semibold">{percent(m.margin)}{mark(live, m, (x) => x.margin, true)}</td>
                            <td className={`num ${ch == null ? "text-faint" : ch >= 0 ? "text-emerald-700" : "text-red-700"}`}>{ch == null ? "–" : `${ch >= 0 ? "+" : "−"}${percent(Math.abs(ch), 0)}`}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td>All marketplaces</td><td className="num">{compactRupees(t.sales)}</td><td className="text-xs text-muted">100%</td><td className="num">{count(t.units)}</td><td></td>
                    <td className="num">{percent(t.sales ? t.fees / t.sales : 0)}</td><td className="num">{percent(t.sales ? t.ads / t.sales : 0)}</td><td className="num">{percent(t.sales ? t.productCost / t.sales : 0)}</td>
                    <td className="num">{compactRupees(t.profit)}</td><td className="num">{percent(t.margin)}</td>
                    <td className={`num ${t.change == null ? "" : t.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{t.change == null ? "–" : `${t.change >= 0 ? "+" : "−"}${percent(Math.abs(t.change), 0)}`}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Profit = net sales − marketplace fees − ads − product cost. Product cost uses each product&apos;s cost entered under Product costs, or the default %.</p>
          </Section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <section className="card px-4 py-4">
              <h2 className="text-base font-bold text-emerald-800">What&apos;s working</h2>
              {!good.length ? <p className="mt-2 text-sm text-muted">Nothing stands out yet for these dates.</p> : (
                <ul className="mt-2 divide-y divide-ice-dim">{good.map((f) => <li key={f.title} className="py-2.5"><div className="text-sm font-semibold">{f.title}</div><div className="text-xs text-muted">{f.detail}</div></li>)}</ul>
              )}
            </section>
            <section className="card px-4 py-4">
              <h2 className="text-base font-bold text-red-800">Needs attention</h2>
              {!bad.length ? <p className="mt-2 text-sm text-muted">Nothing needs attention for these dates.</p> : (
                <ul className="mt-2 divide-y divide-ice-dim">{bad.map((f) => <li key={f.title} className="py-2.5"><div className="text-sm font-semibold">{f.title}</div><div className="text-xs text-muted">{f.detail}</div></li>)}</ul>
              )}
            </section>
          </div>

          {work.available && (work.waiting.length + work.inProgress.length + work.completed.length) > 0 && (
            <Section title="Pexeta's work" sub="From Pexeta's task tracker." action={<Link href={`/b/${clientId}/work${q}`} className="text-xs font-semibold text-brand hover:underline">All work</Link>}>
              <div className="grid gap-6 px-4 py-4 md:grid-cols-3">
                {([["Waiting on you", work.waiting, "text-amber-800"], ["In progress", work.inProgress, "text-navy"], ["Completed in these dates", work.completed, "text-emerald-800"]] as const).map(([label, items, cls]) => (
                  <div key={label}>
                    <h3 className={`text-sm font-bold ${cls}`}>{label} <span className="tabular">({items.length})</span></h3>
                    <ul className="mt-1 space-y-1 text-sm">{items.slice(0, 4).map((t) => <li key={t.ref}>{t.title}</li>)}{items.length > 4 && <li className="text-xs text-muted">and {items.length - 4} more</li>}</ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {search?.hasData && amazon && (search.result.actions.length > 0 || search.result.progress) && (
            <Section title="Amazon search: actions and progress" sub="From Amazon Brand Analytics, weekly." action={<Link href={`/a/${amazon.id}/search`} className="text-xs font-semibold text-brand hover:underline">Search & listings</Link>}>
              <div className="grid gap-6 px-4 py-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-bold text-navy">This month&apos;s actions</h3>
                  <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-sm">{search.result.actions.slice(0, 3).map((a) => <li key={a.title}><b>{a.title}</b> <span className="text-xs text-muted">({a.owner})</span></li>)}</ol>
                </div>
                {search.result.progress && (
                  <div>
                    <h3 className="text-sm font-bold text-navy">What Pexeta has improved <span className="text-xs font-normal text-muted">({dateLabel(search.result.progress.baseline.from)} → {dateLabel(search.result.progress.current.to)})</span></h3>
                    <ul className="mt-1 space-y-1 text-sm">{search.result.progress.metrics.filter((m) => m.unit !== "rupees").slice(0, 4).map((m) => {
                      const up = m.after > m.before, good = m.after === m.before ? null : up === m.higherIsBetter;
                      const v = (x: number) => (m.unit === "pct" ? percent(x, x < 0.01 ? 2 : 1) : count(Math.round(x)));
                      return <li key={m.label} className="flex justify-between gap-3"><span className="text-muted">{m.label}</span><span className={`tabular font-semibold ${good == null ? "" : good ? "text-emerald-700" : "text-red-700"}`}>{v(m.before)} → {v(m.after)}</span></li>;
                    })}</ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {returns.total > 0 && (
            <Section title={`Returns: ${count(returns.total)} units came back`} sub="Refused or undelivered orders included. Amounts include GST." action={<Link href={`/b/${clientId}/returns${q}`} className="text-xs font-semibold text-brand hover:underline">Returns & reimbursements</Link>}>
              <div className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
                <div><div className="text-xs text-muted">Sales reversed</div><div className="tabular font-bold text-navy">{compactRupees(money.total.reversed)}</div></div>
                <div><div className="text-xs text-muted">Money lost</div><div className="tabular font-bold text-red-700">{compactRupees(money.total.lost)}</div></div>
                <div><div className="text-xs text-muted">Recovered from Amazon</div><div className="tabular font-bold text-emerald-700">{compactRupees(money.amazon?.recovered ?? 0)}</div></div>
                <div><div className="text-xs text-muted">To claim from Amazon</div><div className="tabular font-bold text-emerald-700">{compactRupees(money.total.recoverable)}</div></div>
              </div>
              <div className="grid gap-6 px-4 py-4 lg:grid-cols-2">
                <ul className="space-y-1 text-sm">{returns.byTheme.slice(0, 4).map((t) => <li key={t.theme} className="flex justify-between gap-3"><span className="text-muted">{THEME_LABEL[t.theme]}</span><span className="tabular font-semibold">{count(t.units)} · {percent(t.share, 0)}</span></li>)}</ul>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm">{returns.actions.slice(0, 3).map((a) => <li key={a.title}><b>{a.title}</b> <span className="text-xs text-muted">({a.owner})</span></li>)}</ol>
              </div>
            </Section>
          )}

          <Section title="Net sales by day" sub="Stacked by marketplace, excluding GST.">
            <StackedDaily rows={live} from={period.from} to={period.to} />
          </Section>

          <p className="text-xs text-muted">Coming next: products compared across marketplaces. Root and Soil uses different SKU codes on Amazon and FirstCry, so each product needs linking once in a product master before they can be lined up.</p>
        </>
      )}
    </>
  );
}

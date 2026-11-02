// Why customers return products, across the brand's marketplaces: themes, actions and the customers' own words.
import PeriodPicker from "@/components/PeriodPicker";
import { Empty, PageHeader, PeriodNote, Section, StatusPill } from "@/components/ui";
import { getBrandAccounts, getViewer } from "@/lib/auth";
import { getReturns } from "@/lib/data";
import { THEME_LABEL, type ReturnTheme } from "@/lib/engine/returns";
import { count, percent } from "@/lib/format";
import { getBrandPeriod } from "@/lib/period";

export const metadata = { title: "Returns insights" };

const THEME_COLOR: Record<ReturnTheme, string> = { refused: "#0b2a4a", damaged: "#c2410c", quality: "#f2871e", wrong_item: "#1d6fb8", price_or_mind: "#8fbde6", other: "#94a3b8" };
const THEMES = Object.keys(THEME_LABEL) as ReturnTheme[];

export default async function ReturnsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { clientId } = await params;
  const [viewer, { clientName, accounts }] = await Promise.all([getViewer(), getBrandAccounts(clientId)]);
  const period = await getBrandPeriod(accounts.map((a) => a.id), await searchParams);
  const r = await getReturns(accounts, period.from, period.to);
  const team = viewer.kind === "team";

  return (
    <>
      <PageHeader eyebrow={`${clientName} · All marketplaces`} title="Returns insights"
        sub={<><PeriodNote from={period.from} to={period.to} />. Every returned or undelivered unit, put into one theme from the marketplace&apos;s reason and the customer&apos;s own words.</>}
        action={<PeriodPicker period={period} basePath={`/b/${clientId}/returns`} />} />

      {!r.total ? <div className="card"><Empty>No returns recorded for these dates.{team ? " Upload each marketplace's returns report (Amazon FBA Customer Returns, FirstCry Sale Return data, Myntra Returns report)." : ""}</Empty></div> : (
        <>
          <Section title="What to do about returns" sub="Worked out from the returns in this period. Owner shows who acts.">
            {!r.actions.length ? <Empty>No pattern stands out: returns are spread across reasons and products.</Empty> : (
              <ol className="divide-y divide-line">
                {r.actions.map((a, i) => (
                  <li key={a.title} className="flex gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                    <div><div className="text-sm font-semibold">{a.title} <StatusPill tone={a.owner === "Pexeta" ? "blue" : a.owner === "Seller" ? "amber" : "grey"}>{a.owner}</StatusPill></div><div className="mt-0.5 text-xs text-muted">{a.why}</div></div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title={`Why ${count(r.total)} units came back`}>
            <div className="px-4 py-4">
              <div className="flex h-3 overflow-hidden rounded-full">{r.byTheme.map((t) => <span key={t.theme} style={{ width: `${t.share * 100}%`, background: THEME_COLOR[t.theme] }} title={`${THEME_LABEL[t.theme]}: ${t.units}`} />)}</div>
              <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {r.byTheme.map((t) => <li key={t.theme} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: THEME_COLOR[t.theme] }} />{THEME_LABEL[t.theme]}<span className="tabular ml-auto font-semibold">{count(t.units)} · {percent(t.share, 0)}</span></li>)}
              </ul>
            </div>
            <div className="overflow-x-auto border-t border-line">
              <table className="tbl">
                <thead><tr><th>Marketplace</th><th className="num">Units</th>{THEMES.map((t) => <th key={t} className="num">{THEME_LABEL[t]}</th>)}</tr></thead>
                <tbody>{r.byMarketplace.map((m) => <tr key={m.marketplace}><td className="font-medium">{m.marketplace}</td><td className="num">{count(m.total)}</td>{THEMES.map((t) => <td key={t} className="num">{m.byTheme[t] ? count(m.byTheme[t]!) : <span className="text-faint">–</span>}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </Section>

          <Section title="By product" sub="Most returned first, with what customers wrote (Amazon collects comments; FirstCry and Myntra give a reason only).">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th>Marketplace</th><th className="num">Units</th><th>Main reasons</th><th className="w-2/5">Customers said</th></tr></thead>
                <tbody>{r.products.slice(0, team ? 60 : 20).map((p) => (
                  <tr key={`${p.marketplace}-${p.product}`}>
                    <td className="max-w-64">{p.name}{p.name !== p.product && <div className="text-[11px] text-faint">{p.product}</div>}</td>
                    <td>{p.marketplace}</td><td className="num">{count(p.total)}</td>
                    <td className="text-xs">{THEMES.filter((t) => p.byTheme[t]).sort((a, b) => (p.byTheme[b] ?? 0) - (p.byTheme[a] ?? 0)).map((t) => `${THEME_LABEL[t]} ${p.byTheme[t]}`).join(" · ")}</td>
                    <td className="text-xs text-muted">{p.comments.slice(0, 3).map((c) => <div key={c}>“{c.length > 140 ? `${c.slice(0, 140)}…` : c}”</div>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

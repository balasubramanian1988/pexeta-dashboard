// Why customers return products, across the brand's marketplaces: themes, actions and the customers' own words.
import PeriodPicker from "@/components/PeriodPicker";
import { Empty, Kpi, PageHeader, PeriodNote, Section, StatusPill } from "@/components/ui";
import { getBrandAccounts, getViewer } from "@/lib/auth";
import { getReturns, getReturnsMoney } from "@/lib/data";
import { THEME_LABEL, type ReturnTheme } from "@/lib/engine/returns";
import { WAREHOUSE_WAIT_DAYS, reimbursementReason } from "@/lib/engine/warehouseClaims";
import { compactRupees, count, dateLabel, percent, rupees } from "@/lib/format";
import { getBrandPeriod } from "@/lib/period";

export const metadata = { title: "Returns & reimbursements" };

const THEME_COLOR: Record<ReturnTheme, string> = { refused: "#0b2a4a", damaged: "#c2410c", quality: "#f2871e", wrong_item: "#1d6fb8", price_or_mind: "#8fbde6", other: "#94a3b8" };
const THEMES = Object.keys(THEME_LABEL) as ReturnTheme[];

export default async function ReturnsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { clientId } = await params;
  const [viewer, { clientName, accounts }] = await Promise.all([getViewer(), getBrandAccounts(clientId)]);
  const period = await getBrandPeriod(accounts.map((a) => a.id), await searchParams);
  const [r, money] = await Promise.all([getReturns(accounts, period.from, period.to), getReturnsMoney(accounts, period.from, period.to)]);
  const a = money.amazon;
  const now = a?.claims.filter((c) => c.status === "claim_now") ?? [];
  const team = viewer.kind === "team";
  const w = money.warehouse ?? null;
  const wNow = w?.claims.filter((c) => c.status === "claim_now") ?? [];
  const claimNow = (a?.claimable ?? 0) + (w?.claimable ?? 0);
  const claimLater = (a?.pending ?? 0) + (w?.pending ?? 0);
  const casesNow = now.length + wNow.length;

  return (
    <>
      <PageHeader eyebrow={`${clientName} · All marketplaces`} title="Returns & reimbursements"
        sub={<><PeriodNote from={period.from} to={period.to} />. Every returned or undelivered unit, put into one theme from the marketplace&apos;s reason and the customer&apos;s own words.</>}
        action={<PeriodPicker period={period} basePath={`/b/${clientId}/returns`} />} />

      {(a || w || money.firstcry || money.myntra || money.flipkart) && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Sales reversed by returns" value={compactRupees(money.total.reversed)} sub="Refunds, debit notes and return deductions" />
            <Kpi label="Money lost to returns" value={compactRupees(money.total.lost)} tone={money.total.lost > 0 ? "bad" : undefined} sub="Fees not refunded, return shipping, stock written off" />
            <Kpi label="Recovered from Amazon" value={compactRupees(a?.recovered ?? 0)} tone={(a?.recovered ?? 0) > 0 ? "good" : undefined} sub={`${a?.recoveredItems.length ?? 0} reimbursements in these dates`} />
            <Kpi label="To claim from Amazon" value={compactRupees(claimNow)} tone={claimNow > 0 ? "good" : undefined} sub={`${casesNow} case${casesNow === 1 ? "" : "s"} now${claimLater ? ` · ${compactRupees(claimLater)} more after the waiting period` : ""}`} />
          </div>
          <p className="mb-6 text-xs text-muted">Amounts include GST. Claim values are estimates of the item value refunded; Pexeta checks each case in Seller Central before raising it, and Amazon decides the final amount.</p>

          <Section title="Where the money went" sub="By marketplace, for returns in these dates.">
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Marketplace</th><th className="num">Sales reversed</th><th className="num">Fees not refunded</th><th className="num">Return shipping</th><th className="num">Stock written off</th><th className="num">Recovered</th><th className="num">To claim</th></tr></thead>
              <tbody>
                {a && <tr><td className="font-medium">Amazon</td><td className="num">{rupees(a.refundedToCustomers)}<div className="text-[11px] text-faint">{count(a.refunds)} refunds</div></td><td className="num">{rupees(a.feesKept)}</td><td className="num text-faint">–</td><td className="num">{rupees(a.stockLost)}<div className="text-[11px] text-faint">{count(a.stockLostUnits)} units</div></td><td className="num text-emerald-700">{rupees(a.recovered)}</td><td className="num font-semibold text-emerald-700">{rupees(a.claimable + a.pending)}</td></tr>}
                {money.firstcry && <tr><td className="font-medium">FirstCry</td><td className="num">{rupees(money.firstcry.debited)}<div className="text-[11px] text-faint">RTO {rupees(money.firstcry.rtoDebited)} · returns {rupees(money.firstcry.returnDebited)}</div></td><td className="num text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td></tr>}
                {money.flipkart && <tr><td className="font-medium">Flipkart</td><td className="num">{rupees(money.flipkart.reversed)}<div className="text-[11px] text-faint">RTO {rupees(money.flipkart.rtoReversed)} ({count(money.flipkart.rtoUnits)}) · returns {rupees(money.flipkart.returnReversed)} ({count(money.flipkart.returnUnits)})</div></td><td className="num text-faint">–</td><td className="num">{rupees(money.flipkart.returnShipping)}</td><td className="num text-faint">–</td><td className={`num ${money.flipkart.protection ? "text-emerald-700" : "text-faint"}`}>{money.flipkart.protection ? rupees(money.flipkart.protection) : "–"}</td><td className="num text-faint">–</td></tr>}
                {money.myntra && <tr><td className="font-medium">Myntra</td><td className="num">{rupees(money.myntra.deducted)}</td><td className="num text-faint">–</td><td className="num">{rupees(money.myntra.reverseLogistics)}</td><td className="num text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td></tr>}
              </tbody>
            </table></div>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">FirstCry, Myntra and Flipkart take back their payout on returned units by debit note or deduction; reimbursement claims apply to Amazon FBA. Flipkart is by payout date; its &quot;Recovered&quot; is Seller Protection Fund payments for damaged or lost returns. Stock written off uses each product&apos;s cost from Product costs, or the default %.</p>
          </Section>

          {a && a.claims.length > 0 && (
            <Section title="Amazon reimbursement claims" sub={<>Items refunded to customers that never came back to Amazon&apos;s warehouse after {45} days, and items Amazon&apos;s warehouse or courier damaged, with no reimbursement yet. Upload FBA Customer Returns weekly so items that did come back are not claimed.</>}>
              <div className="overflow-x-auto"><table className="tbl">
                <thead><tr><th>Status</th><th>Product</th><th>Order</th><th>Why</th><th className="num">Est. value</th></tr></thead>
                <tbody>{a.claims.slice(0, team ? 200 : 15).map((c) => (
                  <tr key={`${c.kind}-${c.order_id}-${c.sku}`}>
                    <td>{c.status === "claim_now" ? <StatusPill tone="green">Claim now</StatusPill> : <StatusPill tone="grey">From {dateLabel(c.claimFrom)}</StatusPill>}</td>
                    <td className="max-w-56">{c.name}<div className="text-[11px] text-faint">{c.sku}</div></td>
                    <td className="whitespace-nowrap text-xs">{c.order_id}</td>
                    <td className="text-xs text-muted">{c.kind === "not_returned" ? "Refunded, not returned" : "Damaged by Amazon / courier"}<div className="text-[11px]">{c.detail}</div></td>
                    <td className="num font-semibold">{rupees(c.value)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {!team && a.claims.length > 15 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">and {a.claims.length - 15} more, handled by Pexeta.</p>}
            </Section>
          )}

          {w && w.claims.length > 0 && (
            <Section title="Lost or damaged in Amazon's warehouses" sub={<>From the Inventory Ledger: units Amazon lost or damaged that it has not found or paid for. Amazon usually searches for about {WAREHOUSE_WAIT_DAYS} days first. Value is Amazon&apos;s own reimbursement rate for the product where it has paid before, otherwise the average selling price.</>}>
              <div className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
                <div><div className="text-xs text-muted">Claim now</div><div className="tabular font-bold text-emerald-700">{compactRupees(w.claimable)}</div></div>
                <div><div className="text-xs text-muted">Amazon still searching</div><div className="tabular font-bold text-navy">{compactRupees(w.pending)}</div></div>
                <div><div className="text-xs text-muted">To check (carrier damage)</div><div className="tabular font-bold text-amber-700">{compactRupees(w.toCheck)}</div></div>
                <div><div className="text-xs text-muted">Units</div><div className="tabular font-bold text-navy">{count(w.lostUnits)} lost · {count(w.damagedUnits)} damaged</div></div>
              </div>
              <div className="overflow-x-auto"><table className="tbl">
                <thead><tr><th>Status</th><th>Product</th><th>Warehouse · date</th><th>What happened</th><th className="num">Units</th><th className="num">Est. value</th></tr></thead>
                <tbody>{w.claims.slice(0, team ? 200 : 15).map((c, i) => (
                  <tr key={`${c.kind}-${c.fnsku}-${c.reference_id}-${c.date}-${i}`}>
                    <td>{c.status === "claim_now" ? <StatusPill tone="green">Claim now</StatusPill> : c.status === "wait" ? <StatusPill tone="grey">Amazon searching</StatusPill> : <StatusPill tone="amber">Check</StatusPill>}</td>
                    <td className="max-w-56">{c.name}<div className="text-[11px] text-faint">{c.sku} · {c.fnsku}</div></td>
                    <td className="whitespace-nowrap text-xs">{c.fc} · {dateLabel(c.date)}{c.reference_id && <div className="text-[11px] text-faint">Ref {c.reference_id}</div>}</td>
                    <td className="text-xs text-muted">{c.kind === "lost" ? "Lost in warehouse" : c.kind === "damaged" ? "Damaged in warehouse" : "Received damaged"}<div className="text-[11px]">{c.detail}</div></td>
                    <td className="num">{count(c.units)}</td>
                    <td className="num font-semibold">{rupees(c.value)}{team && <div className="text-[11px] font-normal text-faint">{c.valueBasis === "amazon_rate" ? "Amazon rate" : "selling price"}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {!team && w.claims.length > 15 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">and {w.claims.length - 15} more, handled by Pexeta.</p>}
            </Section>
          )}

          {w && w.reimbursedByReason.length > 0 && (
            <Section title={`Amazon paid ${compactRupees(w.reimbursedTotal)} in these dates`} sub="From the Reimbursements report, by reason. Customer-return reimbursements cover refunded items that did not come back.">
              <table className="tbl">
                <thead><tr><th>Reason</th><th className="num">Reimbursements</th><th className="num">Amount</th></tr></thead>
                <tbody>{w.reimbursedByReason.map((x) => <tr key={x.reason}><td>{reimbursementReason(x.reason)}</td><td className="num">{count(x.count)}</td><td className="num text-emerald-700">{rupees(x.amount)}</td></tr>)}</tbody>
              </table>
            </Section>
          )}

          {a && a.recoveredItems.length > 0 && (
            <Section title="Recovered from Amazon" sub="Reimbursements Amazon paid in these dates.">
              <table className="tbl">
                <thead><tr><th>Date</th><th>What for</th><th>Order</th><th className="num">Amount</th></tr></thead>
                <tbody>{a.recoveredItems.slice(0, team ? 100 : 20).map((x, i) => <tr key={`${x.order_id}-${i}`}><td>{dateLabel(x.date)}</td><td className="text-xs">{x.description}</td><td className="text-xs">{x.order_id}</td><td className="num text-emerald-700">{rupees(x.amount)}</td></tr>)}</tbody>
              </table>
            </Section>
          )}
        </>
      )}

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

          <Section title="By product" sub="Most returned first, with what customers wrote (Amazon collects comments; FirstCry, Myntra and Flipkart give a reason only).">
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

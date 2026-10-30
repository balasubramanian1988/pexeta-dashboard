import PeriodPicker from "@/components/PeriodPicker";
import { Bar, DailyBars, KpiRupees, Kpi, NoData, PageHeader, PeriodNote, Section } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { fetchAll, getProfit } from "@/lib/data";
import { dailyNetSales } from "@/lib/engine/summaries";
import { compactRupees, count, percent, rupees } from "@/lib/format";
import { getPeriod } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import FcOrders from "../_firstcry/Orders";
import MyOrders from "../_myntra/Orders";

export const metadata = { title: "Revenue" };

type OrderLine = { order_status: string; quantity: number; item_price: number; item_tax: number };

export default async function RevenuePage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  const period = await getPeriod(account.id, await searchParams);
  if (account.marketplace === "Myntra") return <MyOrders account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  if (account.marketplace === "FirstCry") return <FcOrders account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  const sb = await createClient();
  const [{ result, txns }, orders] = await Promise.all([
    getProfit(account, period.from, period.to),
    fetchAll<OrderLine>((f, t) => sb.from("sd_orders").select("order_status, quantity, item_price, item_tax").eq("account_id", account.id).gte("purchase_date", period.from).lte("purchase_date", period.to).order("order_item_key").range(f, t)),
  ]);
  const t = result.totals;
  const status = new Map<string, { lines: number; units: number; value: number }>();
  for (const o of orders) {
    const s = status.get(o.order_status) ?? { lines: 0, units: 0, value: 0 };
    s.lines++; s.units += Number(o.quantity); s.value += Number(o.item_price);
    status.set(o.order_status, s);
  }

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Revenue" sub={<><PeriodNote from={period.from} to={period.to} />. Settled sales exclude GST.</>} action={<PeriodPicker period={period} basePath={`/a/${account.id}/revenue`} />} />
      {!txns.length ? <div className="card"><NoData accountId={account.id} what="settled sales" team={viewer.kind === "team"} /></div> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiRupees label="Gross sales" value={t.grossSales} />
            <KpiRupees label="Refunds" value={t.refunds} sub={percent(t.grossSales ? t.refunds / t.grossSales : 0)} />
            <KpiRupees label="Promotions" value={-t.promotions} />
            <KpiRupees label="Net sales" value={t.netSales} />
            <Kpi label="Net units" value={count(t.units)} sub={`${count(t.unitsSold)} sold, ${count(t.unitsRefunded)} refunded`} />
          </div>

          <Section title="Net sales by day">
            <DailyBars data={dailyNetSales(txns, period.from, period.to)} format={(n) => compactRupees(n)} label="Net sales by day" />
          </Section>

          <Section title="By marketplace" sub="Flipkart, Myntra, FirstCry and quick commerce accounts appear here as they are connected.">
            <table className="tbl">
              <thead><tr><th>Marketplace</th><th className="num">Net units</th><th className="num">Net sales</th><th className="num">Share</th></tr></thead>
              <tbody><tr><td>{account.marketplace}</td><td className="num">{count(t.units)}</td><td className="num">{rupees(t.netSales)}</td><td className="num">100%</td></tr></tbody>
            </table>
          </Section>

          <Section title="By product">
            <div className="max-h-[70vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units sold</th><th className="num">Refunded</th><th className="num">Gross sales</th><th className="num">Refunds</th><th className="num">Promotions</th><th className="num">Net sales</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.asin}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.asin}</div></td>
                      <td className="num">{count(r.unitsSold)}</td><td className="num">{count(r.unitsRefunded)}</td>
                      <td className="num">{rupees(r.grossSales)}</td><td className="num">{rupees(r.refunds)}</td><td className="num">{rupees(-r.promotions)}</td>
                      <td className="num font-semibold">{rupees(r.netSales)}</td>
                      <td className="num">{percent(t.netSales ? r.netSales / t.netSales : 0)} <Bar share={t.netSales ? r.netSales / t.netSales : 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Section title="Orders placed" sub="From the All Orders report, by purchase date. Includes orders not yet settled; values include GST.">
        {orders.length === 0 ? <NoData accountId={account.id} what="orders" team={viewer.kind === "team"} /> : (
          <table className="tbl">
            <thead><tr><th>Status</th><th className="num">Order lines</th><th className="num">Units</th><th className="num">Value incl. GST</th></tr></thead>
            <tbody>{[...status.entries()].sort((a, b) => b[1].lines - a[1].lines).map(([s, v]) => <tr key={s}><td>{s || "–"}</td><td className="num">{count(v.lines)}</td><td className="num">{count(v.units)}</td><td className="num">{rupees(v.value)}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </>
  );
}

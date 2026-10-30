import SettingForm from "@/components/SettingForm";
import { Kpi, Section, StatusPill } from "@/components/ui";
import { getFcStock, getMyStock } from "@/lib/data";
import { FC_STOCK_LABEL } from "@/lib/engine/firstcry";
import { count } from "@/lib/format";
import { FcHeader, FcNoData, type FcPageProps } from "./common";

const TONE = { urgent: "red", make: "amber", enough: "green", no_sales: "grey", count_needed: "blue" } as const;

export default async function FcStock({ account, period, team, canEdit }: FcPageProps) {
  const rows = await (account.marketplace === "Myntra" ? getMyStock : getFcStock)(account, period.from, period.to, period.days);
  const cover = account.plan_horizon_days + account.default_lead_time_days + account.default_safety_days;
  const needed = rows.reduce((s, r) => s + Math.ceil(r.needed), 0);
  return (
    <>
      <FcHeader account={account} period={period} title={`${account.plan_horizon_days}-day stock plan`} slug="stock"
        sub={<>{account.marketplace} orders ship from your own warehouse, so this plan is built from demand: daily sales rate × ({account.plan_horizon_days} days + lead time + {account.default_safety_days} safety days), {cover} days at the default lead time. Enter your warehouse stock to see how many to make.</>} />
      {!rows.length ? <FcNoData accountId={account.id} team={team} /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Units to keep ready" value={count(needed)} sub="all products" />
            <Kpi label="Urgent" value={count(rows.filter((r) => r.status === "urgent").length)} sub="runs out before a new batch" tone={rows.some((r) => r.status === "urgent") ? "bad" : undefined} />
            <Kpi label="Make now" value={count(rows.reduce((s, r) => s + (r.warehouse != null ? r.toMake : 0), 0))} sub="units, where stock is entered" />
            <Kpi label="Stock not entered" value={count(rows.filter((r) => r.status === "count_needed").length)} sub="products" />
          </div>
          <Section title="Plan by product" sub="Warehouse stock is optional. Without it the plan shows the units to keep ready for this marketplace's demand.">
            <div className="max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units sold</th><th className="num">Per day</th><th className="num">Units to keep ready</th><th className="num min-w-52">Your warehouse · lead time</th><th className="num">Days left</th><th className="num">Make now</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.id}</div></td>
                      <td className="num">{count(r.unitsSold)}</td>
                      <td className="num">{r.perDay.toFixed(1)}</td>
                      <td className="num font-semibold">{count(Math.ceil(r.needed))}</td>
                      <td>
                        <SettingForm accountId={account.id} asin={r.id} disabled={!canEdit} fields={[
                          { name: "warehouse_stock", label: "Units in your warehouse", value: r.warehouse, placeholder: "–" },
                          { name: "lead_time_days", label: "Lead time (days)", value: r.leadTimeOverridden ? r.leadTime : null, placeholder: String(account.default_lead_time_days), width: "!w-16" },
                        ]} />
                      </td>
                      <td className="num">{r.daysLeft == null ? "–" : Math.floor(r.daysLeft)}</td>
                      <td className="num font-semibold">{r.warehouse != null && r.toMake ? count(r.toMake) : "–"}</td>
                      <td><StatusPill tone={TONE[r.status]}>{FC_STOCK_LABEL[r.status]}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <p className="text-xs text-muted">Next step: one combined warehouse plan per brand, adding demand from every marketplace that ships from your warehouse (Amazon self-ship, Flipkart, Myntra, FirstCry).</p>
        </>
      )}
    </>
  );
}

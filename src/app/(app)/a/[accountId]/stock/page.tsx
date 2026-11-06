import PeriodPicker from "@/components/PeriodPicker";
import SettingForm from "@/components/SettingForm";
import { Kpi, NoData, PageHeader, Section, StatusPill } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getStock } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/engine/stock";
import { count, dateLabel } from "@/lib/format";
import { getPeriod } from "@/lib/period";
import FcStock from "../_firstcry/Stock";

export const metadata = { title: "45-day stock plan" };

const TONE = { urgent: "red", make: "amber", enough: "green", no_sales: "grey", count_needed: "blue" } as const;

export default async function StockPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  const period = await getPeriod(account.id, await searchParams);
  if (["FirstCry", "Myntra", "Flipkart"].includes(account.marketplace)) return <FcStock account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  const { rows, inventoryDate, listingsDate } = await getStock(account, period.from, period.to, period.days);
  const toMake = rows.reduce((s, r) => s + r.toMake, 0);
  const cover = account.plan_horizon_days + account.default_lead_time_days + account.default_safety_days;

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title={`${account.plan_horizon_days}-day stock plan`}
        sub={<>How many units to make now so stock lasts {account.plan_horizon_days} days after a new batch arrives. Daily sales rate from {dateLabel(period.from)} to {dateLabel(period.to)} ({period.days} days). Each product needs cover for {account.plan_horizon_days} + lead time + {account.default_safety_days} safety days ({cover} days at the default lead time).</>}
        action={<PeriodPicker period={period} basePath={`/a/${account.id}/stock`} />} />
      {!rows.length ? <div className="card"><NoData accountId={account.id} what="sales or FBA stock" team={viewer.kind === "team"} /></div> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Urgent" value={count(rows.filter((r) => r.status === "urgent").length)} sub="Runs out before a new batch" tone={rows.some((r) => r.status === "urgent") ? "bad" : undefined} />
            <Kpi label="Make now" value={count(rows.filter((r) => r.status === "make").length)} sub="products" />
            <Kpi label="Units to make" value={count(toMake)} sub="all products" />
            <Kpi label="FBA stock as of" value={dateLabel(inventoryDate)} sub={inventoryDate ? "Manage FBA Inventory" : "Upload FBA inventory"} />
          </div>
          <Section title="Plan by product" sub={<><b>Urgent</b>: stock runs out before a new batch can be made. <b>Enter your stock</b>: sold through Easy Ship with no FBA stock, so the plan needs your warehouse count. Enter stock in your own warehouse so it counts towards cover. Easy Ship quantities on Amazon are shown for reference only (as listed {dateLabel(listingsDate)}), because they are usually typed-in round numbers, not counted stock.</>}>
            <div className="max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Units sold</th><th className="num">Per day</th><th className="num">FBA stock</th><th className="num">FBA inbound</th><th className="num min-w-52">Your warehouse · lead time</th><th className="num">Total stock</th><th className="num">Days left</th><th className="num">Make now</th><th>Status</th><th className="num">Easy Ship listed</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.asin}>
                      <td className="min-w-56">{r.name}<div className="text-[11px] text-faint">{r.asin}</div></td>
                      <td className="num">{count(r.unitsSold)}</td>
                      <td className="num">{r.perDay.toFixed(1)}</td>
                      <td className="num">{count(r.fbaStock)}</td>
                      <td className="num">{count(r.fbaInbound)}</td>
                      <td>
                        <SettingForm accountId={account.id} asin={r.asin} disabled={!viewer.canEditCosts} fields={[
                          { name: "warehouse_stock", label: "Units in your warehouse", value: r.warehouse, placeholder: "0" },
                          { name: "lead_time_days", label: "Lead time (days)", value: r.leadTimeOverridden ? r.leadTime : null, placeholder: String(account.default_lead_time_days), width: "!w-16" },
                        ]} />
                      </td>
                      <td className="num">{count(r.totalStock)}</td>
                      <td className="num">{r.daysLeft == null ? "–" : Math.floor(r.daysLeft)}</td>
                      <td className="num font-semibold">{r.toMake ? count(r.toMake) : "–"}</td>
                      <td><StatusPill tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill></td>
                      <td className="num text-faint">{r.easyShipListed ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

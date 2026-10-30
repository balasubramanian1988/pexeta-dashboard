import SettingForm from "@/components/SettingForm";
import { Empty, PageHeader, Section } from "@/components/ui";
import { getAccount, getViewer } from "@/lib/auth";
import { getFirstCry, getMaster, getMyntra, getProfit } from "@/lib/data";
import { percent, rupees } from "@/lib/format";
import { addDays, latestDataDate } from "@/lib/period";
import DefaultsForm from "./DefaultsForm";

export const metadata = { title: "Product costs" };

export default async function CostsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  const latest = await latestDataDate(account.id);
  // Average selling price over the last 90 days of data, to show what a cost % means in rupees.
  const fc = account.marketplace === "FirstCry";
  // FirstCry: costs are a % of MRP (FirstCry's files have no customer selling price), and units come from FirstCry orders.
  const [{ result }, master] = await Promise.all([
    !latest ? Promise.resolve({ result: { rows: [] as { asin: string; avgPriceInclGst: number; units: number }[] } })
      : fc ? getFirstCry(account, addDays(latest, -89), latest).then(({ result: r }) => ({ result: { rows: r.rows.map((x) => ({ asin: x.id, avgPriceInclGst: x.units ? x.mrpValue / x.units : 0, units: x.units })) } }))
      : account.marketplace === "Myntra" ? getMyntra(account, addDays(latest, -89), latest).then(({ result: r }) => ({ result: { rows: r.rows.map((x) => ({ asin: x.sku, avgPriceInclGst: x.avgPrice, units: x.units })) } }))
      : getProfit(account, addDays(latest, -89), latest),
    getMaster(account.id),
  ]);
  const price = new Map(result.rows.map((r) => [r.asin, r]));
  const settings = new Map(master.settings.map((s) => [s.asin, s]));
  const products = [...master.products].sort((a, b) => (price.get(b.asin)?.units ?? 0) - (price.get(a.asin)?.units ?? 0));
  const team = viewer.kind === "team";

  return (
    <>
      <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title="Product costs"
        sub={<>Enter what each product costs you to make, either as a percentage of the {fc ? "MRP" : "selling price"} or in rupees per unit. Rupees win if both are filled. Blank uses the default of {percent(account.default_cost_pct, 0)}. Costs are only visible to you and the Pexeta team.</>} />

      {team && (
        <Section title="Account defaults" sub="Used for products where the seller has not entered a value.">
          <DefaultsForm accountId={account.id} costPct={account.default_cost_pct} lead={account.default_lead_time_days} safety={account.default_safety_days} horizon={account.plan_horizon_days} />
        </Section>
      )}

      <Section title="Products" sub={!viewer.canEditCosts ? "Your login can view these values but not change them." : "Lead time overrides the default for the stock plan."}>
        {!products.length ? <Empty>Products appear here after the first {fc ? "FirstCry All Product data or sales report" : "Active Listings"} upload.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="num">{fc ? "MRP" : "Avg price incl. GST (90 days)"}</th><th className="num">Cost used / unit</th><th className="num">{team ? "Short name · " : ""}Cost % · Cost ₹ / unit · Lead time (days)</th></tr></thead>
              <tbody>
                {products.map((p) => {
                  const s = settings.get(p.asin);
                  const avg = price.get(p.asin)?.avgPriceInclGst ?? 0;
                  const used = s?.cost_per_unit != null ? Number(s.cost_per_unit) : (s?.cost_pct != null ? Number(s.cost_pct) : account.default_cost_pct) * avg;
                  return (
                    <tr key={p.asin}>
                      <td className="min-w-64">{p.short_name || p.title}<div className="text-[11px] text-faint">{p.asin}</div></td>
                      <td className="num">{avg ? rupees(avg) : "–"}</td>
                      <td className="num">{avg || s?.cost_per_unit != null ? rupees(used) : "–"}</td>
                      <td>
                        <SettingForm accountId={account.id} asin={p.asin} disabled={!viewer.canEditCosts} fields={[
                          ...(team ? [{ name: "short_name" as const, label: "Short name", value: p.short_name, text: true, width: "!w-44" }] : []),
                          { name: "cost_pct", label: fc ? "Cost % of MRP" : "Cost % of selling price", value: s?.cost_pct != null ? Math.round(Number(s.cost_pct) * 1000) / 10 : null, placeholder: `${Math.round(account.default_cost_pct * 100)}%` },
                          { name: "cost_per_unit", label: "Cost per unit (₹)", value: s?.cost_per_unit != null ? Number(s.cost_per_unit) : null, placeholder: "₹" },
                          { name: "lead_time_days", label: "Lead time (days)", value: s?.lead_time_days ?? null, placeholder: String(account.default_lead_time_days), width: "!w-16" },
                        ]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

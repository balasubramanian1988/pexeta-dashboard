import Link from "next/link";
import { Empty, PageHeader, Section, StatusPill } from "@/components/ui";
import { requireTeam } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { addDays, todayIst } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { setAccountActive } from "../team/actions";
import { AddMarketplaceForm, NewBrandForm } from "../team/forms";

export const metadata = { title: "Brands" };

type Row = { id: string; name: string; seller_id: string; active: boolean; client_id: string; marketplace_id: string; clients: unknown; marketplaces: unknown };

export default async function AccountsPage() {
  await requireTeam();
  const sb = await createClient();
  const [{ data: accounts }, { data: clients }, { data: markets }, { data: uploads }] = await Promise.all([
    sb.from("sd_accounts").select("id, name, seller_id, active, client_id, marketplace_id, clients(name), marketplaces(name, sort_order)").order("name"),
    sb.from("clients").select("id, name").order("name"),
    sb.from("marketplaces").select("id, name, active").order("sort_order"),
    sb.from("sd_uploads").select("account_id, period_end, created_at").eq("status", "done").order("period_end", { ascending: false }).limit(1000),
  ]);
  const latest = new Map<string, string>();
  for (const u of uploads ?? []) if (u.period_end && !latest.has(u.account_id)) latest.set(u.account_id, u.period_end);
  const due = addDays(todayIst(), -2);
  const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as { name?: string; sort_order?: number } | null;
  const marketList = (markets ?? []).filter((m) => m.active !== false);

  // Group accounts by brand.
  const brands = new Map<string, { id: string; name: string; rows: Row[] }>();
  for (const a of (accounts ?? []) as Row[]) {
    const b = brands.get(a.client_id) ?? { id: a.client_id, name: one(a.clients)?.name ?? "", rows: [] };
    b.rows.push(a);
    brands.set(a.client_id, b);
  }
  for (const b of brands.values()) b.rows.sort((x, y) => (one(x.marketplaces)?.sort_order ?? 99) - (one(y.marketplaces)?.sort_order ?? 99));
  const list = [...brands.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader eyebrow="Pexeta team" title="Brands" sub="Each brand shows only the marketplaces it is opted into. Hide a marketplace to take it off the brand's dashboard without losing its data." />

      {!list.length && <div className="card mb-6"><Empty>No brands yet. Add one below.</Empty></div>}

      {list.map((b) => {
        const have = new Set(b.rows.filter((r) => r.active).map((r) => r.marketplace_id));
        const canAdd = marketList.filter((m) => !have.has(m.id));
        const shown = b.rows.filter((r) => r.active).length;
        return (
          <Section key={b.id} title={b.name} sub={`${shown} marketplace${shown === 1 ? "" : "s"} on the dashboard`}
            action={shown > 0 ? <Link href={`/b/${b.id}`} className="btn btn-primary !py-1.5 !text-xs">All marketplaces dashboard</Link> : undefined}>
            <table className="tbl">
              <thead><tr><th>Marketplace</th><th>Seller ID</th><th>Data up to</th><th>On dashboard</th><th></th></tr></thead>
              <tbody>
                {b.rows.map((a) => {
                  const l = latest.get(a.id);
                  return (
                    <tr key={a.id} className={a.active ? "" : "opacity-60"}>
                      <td className="font-medium">
                        {a.active ? <Link href={`/a/${a.id}`} className="text-brand hover:underline">{one(a.marketplaces)?.name}</Link> : one(a.marketplaces)?.name}
                      </td>
                      <td className="font-mono text-xs">{a.seller_id || "–"}</td>
                      <td>{l ? dateLabel(l) : "–"} {a.active && (!l || l < due) && <StatusPill tone="amber">Upload due</StatusPill>}</td>
                      <td>
                        <form action={setAccountActive} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="active" value={a.active ? "false" : "true"} />
                          {a.active ? <StatusPill tone="green">Shown</StatusPill> : <StatusPill tone="grey">Hidden</StatusPill>}
                          <button className="text-xs font-semibold text-brand hover:underline">{a.active ? "Hide" : "Show again"}</button>
                        </form>
                      </td>
                      <td>{a.active && <Link href={`/a/${a.id}/uploads`} className="text-xs font-semibold text-brand hover:underline">Upload</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand">+ Add marketplace</summary>
              <AddMarketplaceForm clientId={b.id} marketplaces={canAdd.map((m) => ({ id: m.id, name: m.name }))} />
            </details>
          </Section>
        );
      })}

      <Section title="Add a brand" sub="Tick only the marketplaces the brand sells on. You can add more later from the brand's card.">
        <NewBrandForm clients={clients ?? []} marketplaces={marketList.map((m) => ({ id: m.id, name: m.name }))} />
      </Section>
    </>
  );
}

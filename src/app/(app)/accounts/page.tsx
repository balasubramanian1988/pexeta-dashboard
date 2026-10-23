import Link from "next/link";
import { Empty, PageHeader, Section, StatusPill } from "@/components/ui";
import { requireTeam } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { addDays, todayIst } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { NewAccountForm } from "../team/forms";

export const metadata = { title: "All accounts" };

export default async function AccountsPage() {
  await requireTeam();
  const sb = await createClient();
  const [{ data: accounts }, { data: clients }, { data: markets }, { data: uploads }] = await Promise.all([
    sb.from("sd_accounts").select("id, name, seller_id, active, clients(name), marketplaces(name)").order("name"),
    sb.from("clients").select("id, name").order("name"),
    sb.from("marketplaces").select("id, name").order("name"),
    sb.from("sd_uploads").select("account_id, report_type, period_end, created_at").eq("status", "done").eq("report_type", "unified_transactions").order("period_end", { ascending: false }).limit(500),
  ]);
  const latest = new Map<string, string>();
  for (const u of uploads ?? []) if (u.period_end && !latest.has(u.account_id)) latest.set(u.account_id, u.period_end);
  const due = addDays(todayIst(), -2);
  const name = (x: unknown) => (Array.isArray(x) ? x[0]?.name : (x as { name?: string } | null)?.name) ?? "";

  return (
    <>
      <PageHeader eyebrow="Pexeta team" title="All accounts" sub="Every seller marketplace account on the dashboard." />
      <Section title="Accounts">
        {!accounts?.length ? <Empty>No accounts yet. Add one below.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Account</th><th>Client</th><th>Marketplace</th><th>Seller ID</th><th>Settled data up to</th><th></th></tr></thead>
            <tbody>
              {accounts.map((a) => {
                const l = latest.get(a.id);
                return (
                  <tr key={a.id}>
                    <td className="font-medium"><Link href={`/a/${a.id}`} className="text-brand hover:underline">{a.name}</Link></td>
                    <td>{name(a.clients)}</td><td>{name(a.marketplaces)}</td><td className="font-mono text-xs">{a.seller_id || "–"}</td>
                    <td>{l ? dateLabel(l) : "–"} {(!l || l < due) && <StatusPill tone="amber">Upload due</StatusPill>}</td>
                    <td><Link href={`/a/${a.id}/uploads`} className="text-xs font-semibold text-brand hover:underline">Upload</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Add an account" sub="One per seller per marketplace. Clients and marketplaces come from Pexeta Ops.">
        <NewAccountForm clients={clients ?? []} marketplaces={markets ?? []} />
      </Section>
    </>
  );
}

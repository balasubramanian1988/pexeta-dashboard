import { PageHeader, Section, StatusPill, Empty } from "@/components/ui";
import { requireTeam } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { updateSellerLogin } from "../actions";
import { NewSellerForm, ResetPasswordButton } from "../forms";

export const metadata = { title: "Seller logins" };

export default async function SellersPage() {
  await requireTeam();
  const sb = await createClient();
  const [{ data: clients }, { data: logins }] = await Promise.all([
    sb.from("clients").select("id, name").order("name"),
    sb.from("sd_client_users").select("id, email, full_name, client_id, can_edit_costs, active, created_at").order("created_at", { ascending: false }),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const toggle = (id: string, field: string, value: boolean, label: string) => (
    <form action={updateSellerLogin} className="inline">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="field" value={field} /><input type="hidden" name="value" value={String(value)} />
      <button className="text-xs font-semibold text-brand hover:underline">{label}</button>
    </form>
  );

  return (
    <>
      <PageHeader eyebrow="Pexeta team" title="Seller logins" sub="Sellers sign in at dashboard.pexeta.in with email and password and see only their own brand." />
      <Section title="New seller login"><NewSellerForm clients={clients ?? []} /></Section>
      <Section title="Logins">
        {!logins?.length ? <Empty>No seller logins yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Seller</th><th>Client</th><th>Costs</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {logins.map((l) => (
                <tr key={l.id}>
                  <td>{l.full_name || "–"}<div className="text-xs text-muted">{l.email}</div></td>
                  <td>{clientName.get(l.client_id) ?? "–"}</td>
                  <td className="space-x-2">{l.can_edit_costs ? <StatusPill tone="green">Can edit</StatusPill> : <StatusPill tone="grey">View only</StatusPill>} {toggle(l.id, "can_edit_costs", !l.can_edit_costs, l.can_edit_costs ? "Make view only" : "Allow editing")}</td>
                  <td className="space-x-2">{l.active ? <StatusPill tone="green">Active</StatusPill> : <StatusPill tone="red">Switched off</StatusPill>} {toggle(l.id, "active", !l.active, l.active ? "Switch off" : "Switch on")}</td>
                  <td className="text-muted">{dateLabel(l.created_at)}</td>
                  <td><ResetPasswordButton id={l.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

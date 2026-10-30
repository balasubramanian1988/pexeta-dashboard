// Who is signed in: a Pexeta team member (Google, listed in team_members) or a seller user
// (email + password, listed in sd_client_users). Everything else goes to /not-authorised.
import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

export type Viewer =
  | { kind: "team"; email: string; name: string; memberId: string; role: string; canEditCosts: true }
  | { kind: "seller"; email: string; name: string; userId: string; clientId: string; canEditCosts: boolean };

export type Account = {
  id: string; client_id: string; name: string; seller_id: string; client_name: string; marketplace: string;
  default_cost_pct: number; default_lead_time_days: number; default_safety_days: number; plan_horizon_days: number;
};

export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) redirect("/login");
  const admin = createAdminClient();

  const { data: member, error } = await admin.from("team_members").select("id, email, full_name, role, active").ilike("email", user.email).maybeSingle();
  if (error) console.error("[pexeta-dashboard] team_members lookup failed:", error.message);
  // Team access only through Google, so a seller password account can never pass as team.
  const providers: string[] = user.app_metadata?.providers ?? [user.app_metadata?.provider ?? ""];
  if (member?.active && providers.includes("google")) {
    return { kind: "team", email: user.email, name: member.full_name, memberId: member.id, role: member.role, canEditCosts: true };
  }
  const { data: seller } = await admin.from("sd_client_users").select("client_id, full_name, can_edit_costs, active").eq("user_id", user.id).maybeSingle();
  if (seller?.active) {
    return { kind: "seller", email: user.email, name: seller.full_name || user.email, userId: user.id, clientId: seller.client_id, canEditCosts: seller.can_edit_costs };
  }
  redirect("/not-authorised");
});

export async function requireTeam() {
  const v = await getViewer();
  if (v.kind !== "team") notFound();
  return v;
}

/** Loads an account the viewer may see, or 404s. Reads use the signed-in user's session, so row-level security applies too. */
export const getAccount = cache(async (accountId: string): Promise<Account> => {
  const v = await getViewer();
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("sd_accounts")
    .select("id, client_id, name, seller_id, active, default_cost_pct, default_lead_time_days, default_safety_days, plan_horizon_days, clients(name), marketplaces(name)")
    .eq("id", accountId)
    .maybeSingle();
  if (!data) notFound();
  if (v.kind === "seller" && (data.client_id !== v.clientId || !data.active)) notFound(); // hidden marketplaces are off the seller's dashboard
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  return {
    id: data.id, client_id: data.client_id, name: data.name, seller_id: data.seller_id,
    client_name: one(data.clients as { name: string } | { name: string }[] | null)?.name ?? "",
    marketplace: one(data.marketplaces as { name: string } | { name: string }[] | null)?.name ?? "",
    default_cost_pct: Number(data.default_cost_pct), default_lead_time_days: data.default_lead_time_days,
    default_safety_days: data.default_safety_days, plan_horizon_days: data.plan_horizon_days,
  };
});

/** Accounts the viewer may see, for navigation. */
export async function listAccounts(): Promise<{ id: string; name: string; client_id: string; client_name: string; marketplace: string }[]> {
  const v = await getViewer();
  const supabase = await createClient();
  let q = supabase.from("sd_accounts").select("id, name, client_id, clients(name), marketplaces(name)").eq("active", true).order("name");
  if (v.kind === "seller") q = q.eq("client_id", v.clientId);
  const { data } = await q;
  const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as { name?: string } | null;
  return (data ?? []).map((a) => ({ id: a.id, name: a.name, client_id: a.client_id, client_name: one(a.clients)?.name ?? "", marketplace: one(a.marketplaces)?.name ?? "" }));
}

const MARKET_ORDER = ["Amazon", "Flipkart", "Myntra", "FirstCry", "Blinkit", "Zepto", "Swiggy Instamart", "BigBasket"];

/** A brand's active marketplace accounts the viewer may see (404 otherwise), in a fixed marketplace order. */
export const getBrandAccounts = cache(async (clientId: string): Promise<{ clientName: string; accounts: Account[] }> => {
  const v = await getViewer();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) notFound();
  if (v.kind === "seller" && v.clientId !== clientId) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("sd_accounts").select("id").eq("client_id", clientId).eq("active", true);
  if (!data?.length) notFound();
  const accounts = await Promise.all(data.map((a) => getAccount(a.id)));
  const rank = (m: string) => { const i = MARKET_ORDER.indexOf(m); return i < 0 ? 99 : i; };
  accounts.sort((a, b) => rank(a.marketplace) - rank(b.marketplace) || a.marketplace.localeCompare(b.marketplace));
  return { clientName: accounts[0].client_name, accounts };
});

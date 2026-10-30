"use server";
// Team-only admin: marketplace accounts and seller logins.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok: boolean; message: string; password?: string } | null;

// ---------- Brands and their marketplaces ----------
// A brand is a client (shared with Pexeta Ops). Each marketplace the brand is opted into is one sd_accounts row.
// Only active accounts show on the dashboard; hiding one keeps its data.

type Admin = ReturnType<typeof createAdminClient>;

async function marketplaceName(admin: Admin, id: string) {
  const { data } = await admin.from("marketplaces").select("name").eq("id", id).maybeSingle();
  return data?.name ?? "";
}

/** Adds the brand to one marketplace, or shows it again if it was hidden. */
async function optIn(admin: Admin, clientId: string, brand: string, marketplaceId: string, sellerId: string) {
  const { data: existing } = await admin.from("sd_accounts").select("id, active").eq("client_id", clientId).eq("marketplace_id", marketplaceId).maybeSingle();
  if (existing) {
    const { error } = await admin.from("sd_accounts").update({ active: true, ...(sellerId ? { seller_id: sellerId } : {}) }).eq("id", existing.id);
    return error?.message ?? null;
  }
  const market = await marketplaceName(admin, marketplaceId);
  const { error } = await admin.from("sd_accounts").insert({ client_id: clientId, marketplace_id: marketplaceId, name: `${brand} — ${market}`, seller_id: sellerId });
  return error?.message ?? null;
}

export async function createBrand(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeam();
  const brand = String(form.get("brand") ?? "").trim();
  const marketIds = form.getAll("marketplace_id").map(String).filter(Boolean);
  if (!brand) return { ok: false, message: "Enter the brand name." };
  if (!marketIds.length) return { ok: false, message: "Tick at least one marketplace the brand sells on." };
  const admin = createAdminClient();

  // Reuse the client if Pexeta Ops already has it, so tasks and dashboard stay linked.
  let { data: client } = await admin.from("clients").select("id, name").ilike("name", brand).maybeSingle();
  if (!client) {
    const { data, error } = await admin.from("clients").insert({ name: brand }).select("id, name").single();
    if (error || !data) return { ok: false, message: error?.message ?? "Could not add the brand." };
    client = data;
  }
  for (const m of marketIds) {
    const err = await optIn(admin, client.id, client.name, m, String(form.get(`seller_${m}`) ?? "").trim());
    if (err) return { ok: false, message: err };
  }
  revalidatePath("/accounts");
  return { ok: true, message: `${client.name} added on ${marketIds.length} marketplace${marketIds.length > 1 ? "s" : ""}.` };
}

export async function addBrandMarketplace(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeam();
  const clientId = String(form.get("client_id") ?? "");
  let marketplaceId = String(form.get("marketplace_id") ?? "");
  const newMarket = String(form.get("new_marketplace") ?? "").trim();
  const sellerId = String(form.get("seller_id") ?? "").trim();
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Brand not found." };

  if (marketplaceId === "new") {
    if (!newMarket) return { ok: false, message: "Enter the new marketplace's name." };
    const { data: found } = await admin.from("marketplaces").select("id").ilike("name", newMarket).maybeSingle();
    if (found) marketplaceId = found.id;
    else {
      const { data, error } = await admin.from("marketplaces").insert({ name: newMarket, sort_order: 50 }).select("id").single();
      if (error || !data) return { ok: false, message: error?.message ?? "Could not add the marketplace." };
      marketplaceId = data.id;
    }
  }
  if (!marketplaceId) return { ok: false, message: "Choose a marketplace." };
  const err = await optIn(admin, client.id, client.name, marketplaceId, sellerId);
  if (err) return { ok: false, message: err };
  revalidatePath("/accounts");
  return { ok: true, message: `Added. ${client.name} now shows this marketplace on the dashboard.` };
}

/** Show or hide a marketplace for a brand. Hiding keeps every upload; showing again brings it all back. */
export async function setAccountActive(form: FormData) {
  await requireTeam();
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";
  await createAdminClient().from("sd_accounts").update({ active }).eq("id", id);
  revalidatePath("/accounts");
  revalidatePath("/", "layout");
}

function tempPassword() {
  // 14 characters, no look-alikes; the seller changes it after first sign-in.
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(14)].map((b) => abc[b % abc.length]).join("");
}

export async function createSellerLogin(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeam();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const fullName = String(form.get("full_name") ?? "").trim();
  const clientId = String(form.get("client_id") ?? "");
  const canEdit = form.get("can_edit_costs") === "on";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !clientId) return { ok: false, message: "Enter a valid email and choose the client." };
  if (/@pexeta\.in$/.test(email)) return { ok: false, message: "Pexeta team members sign in with Google; they do not need a seller login." };
  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) return { ok: false, message: error?.message.includes("already") ? "A login with this email already exists." : error?.message ?? "Could not create the login." };
  const { error: e2 } = await admin.from("sd_client_users").insert({ user_id: data.user.id, client_id: clientId, email, full_name: fullName, can_edit_costs: canEdit });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, message: e2.message };
  }
  revalidatePath("/team/sellers");
  return { ok: true, message: `Login created for ${email}. Share this temporary password with them privately; they can change it under Login after signing in.`, password };
}

export async function updateSellerLogin(form: FormData) {
  await requireTeam();
  const id = String(form.get("id") ?? "");
  const field = String(form.get("field") ?? "");
  const value = form.get("value") === "true";
  if (!["active", "can_edit_costs"].includes(field)) return;
  await createAdminClient().from("sd_client_users").update({ [field]: value }).eq("id", id);
  revalidatePath("/team/sellers");
}

export async function resetSellerPassword(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeam();
  const admin = createAdminClient();
  const { data: row } = await admin.from("sd_client_users").select("user_id, email").eq("id", String(form.get("id") ?? "")).maybeSingle();
  if (!row) return { ok: false, message: "Login not found." };
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(row.user_id, { password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `New temporary password for ${row.email}:`, password };
}

"use server";
// Team-only admin: marketplace accounts and seller logins.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok: boolean; message: string; password?: string } | null;

export async function createAccount(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeam();
  const clientId = String(form.get("client_id") ?? "");
  const marketplaceId = String(form.get("marketplace_id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const sellerId = String(form.get("seller_id") ?? "").trim();
  if (!clientId || !marketplaceId || !name) return { ok: false, message: "Choose the client and marketplace, and give the account a name." };
  const { error } = await createAdminClient().from("sd_accounts").insert({ client_id: clientId, marketplace_id: marketplaceId, name, seller_id: sellerId });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/accounts");
  return { ok: true, message: `${name} added.` };
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

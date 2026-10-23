"use server";
// Step 1 of an upload: a short-lived signed URL so the browser sends the file straight to private storage
// (avoids the hosting request-size limit).
import { getAccount, requireTeam } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createUploadTarget(accountId: string, fileName: string): Promise<{ path: string; token: string } | { error: string }> {
  await requireTeam();
  const account = await getAccount(accountId);
  if (!/\.(csv|txt|tsv|xlsx|zip|pdf)$/i.test(fileName)) return { error: "Use CSV, TXT, XLSX, ZIP or PDF files." };
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${account.id}/uploads/${stamp.slice(0, 10)}/${stamp}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
  const { data, error } = await createAdminClient().storage.from("sd-files").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Could not prepare the upload." };
  return { path: data.path, token: data.token };
}

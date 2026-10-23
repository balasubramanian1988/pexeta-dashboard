// Download one stored file (MTR report or invoice PDF) after checking the viewer may see this account.
import { NextResponse } from "next/server";
import { getAccount } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const account = await getAccount(accountId);
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith(`${account.id}/`) || path.includes("..")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = path.split("/").pop()!.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}-/, "");
  const { data, error } = await createAdminClient().storage.from("sd-files").createSignedUrl(path, 120, { download: name });
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

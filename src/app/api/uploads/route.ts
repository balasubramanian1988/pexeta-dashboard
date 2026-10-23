// Step 2 of an upload: the browser has put the file in private storage; read it, recognise each report, save it.
import { NextResponse } from "next/server";
import { getAccount, getViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUpload, REPORT_LABEL } from "@/lib/parsers";
import { saveParsed } from "@/lib/save";

export const runtime = "nodejs";
export const maxDuration = 300;

export type UploadOutcome = { fileName: string; ok: boolean; label: string; rows: number; message: string; period: string };

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (viewer.kind !== "team") return NextResponse.json({ error: "Only the Pexeta team can upload reports." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { accountId?: string; path?: string; fileName?: string; reportDate?: string | null } | null;
  if (!body?.accountId || !body.path || !body.fileName) return NextResponse.json({ error: "Missing file details." }, { status: 400 });
  const account = await getAccount(body.accountId);
  if (!body.path.startsWith(`${account.id}/uploads/`) || body.path.includes("..")) return NextResponse.json({ error: "Bad file path." }, { status: 400 });
  const reportDate = body.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(body.reportDate) ? body.reportDate : null;

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from("sd-files").download(body.path);
  if (error || !blob) return NextResponse.json({ error: `Could not read the uploaded file: ${error?.message ?? "missing"}` }, { status: 500 });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let results;
  try {
    results = await parseUpload(body.fileName, bytes, reportDate);
  } catch (e) {
    results = [{ ok: false as const, fileName: body.fileName, reason: `The file could not be opened (${(e as Error).message}).` }];
  }

  const outcomes: UploadOutcome[] = [];
  for (const r of results) {
    if (!r.ok) {
      await admin.from("sd_uploads").insert({ account_id: account.id, report_type: "unknown", file_name: r.fileName, storage_path: body.path, status: "failed", message: r.reason, uploaded_by: viewer.memberId });
      outcomes.push({ fileName: r.fileName, ok: false, label: "Not recognised", rows: 0, message: r.reason, period: "" });
      continue;
    }
    const { data: up } = await admin.from("sd_uploads").insert({
      account_id: account.id, report_type: r.type, file_name: r.fileName, storage_path: body.path, report_date: reportDate,
      period_start: r.periodStart, period_end: r.periodEnd, rows_parsed: r.rows.length, status: "processing", uploaded_by: viewer.memberId,
    }).select("id").single();
    try {
      if (!r.rows.length) throw new Error(r.warnings.join(" ") || "No data rows in this report.");
      const { saved, warnings } = await saveParsed(admin, account.id, r);
      const message = warnings.join(" ");
      if (up) await admin.from("sd_uploads").update({ status: "done", rows_saved: saved, message }).eq("id", up.id);
      outcomes.push({ fileName: r.fileName, ok: true, label: REPORT_LABEL[r.type], rows: saved, message, period: [r.periodStart, r.periodEnd].filter(Boolean).join(" to ") });
    } catch (e) {
      const message = (e as Error).message;
      if (up) await admin.from("sd_uploads").update({ status: "failed", message }).eq("id", up.id);
      outcomes.push({ fileName: r.fileName, ok: false, label: REPORT_LABEL[r.type], rows: 0, message, period: "" });
    }
  }
  return NextResponse.json({ outcomes });
}

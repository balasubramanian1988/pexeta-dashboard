"use client";
// Drop several Amazon reports at once. Each file goes straight to private storage, then the server reads it.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { createUploadTarget } from "./actions";
import type { UploadOutcome } from "@/app/api/uploads/route";

type Item = { file: File; state: "waiting" | "uploading" | "reading" | "done" | "failed"; outcomes: UploadOutcome[]; error?: string };

export default function Uploader({ accountId, defaultDate }: { accountId: string; defaultDate: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [reportDate, setReportDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function run(files: File[]) {
    if (!files.length) return;
    const start = items.length;
    setItems((xs) => [...xs, ...files.map((file) => ({ file, state: "waiting" as const, outcomes: [] }))]);
    setBusy(true);
    const supabase = createClient();
    for (let k = 0; k < files.length; k++) {
      const i = start + k, file = files[k];
      try {
        update(i, { state: "uploading" });
        const target = await createUploadTarget(accountId, file.name);
        if ("error" in target) throw new Error(target.error);
        const { error } = await supabase.storage.from("sd-files").uploadToSignedUrl(target.path, target.token, file);
        if (error) throw new Error(error.message);
        update(i, { state: "reading" });
        const res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, path: target.path, fileName: file.name, reportDate }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
        const outcomes = body.outcomes as UploadOutcome[];
        update(i, { state: outcomes.every((o) => o.ok) ? "done" : "failed", outcomes });
      } catch (e) {
        update(i, { state: "failed", error: (e as Error).message });
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label>
          <span className="label">Report date (for Business Report, FBA Inventory and Active Listings)</span>
          <input type="date" className="field !w-auto" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </label>
        <p className="max-w-md text-xs text-muted">These three reports have no date inside them. Use the day the Business Report covers, and the download day for inventory and listings. Upload them separately if the dates differ.</p>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) run([...e.dataTransfer.files]); }}
        onClick={() => !busy && input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center ${drag ? "border-brand bg-sky-50" : "border-line bg-ice hover:bg-ice-dim"}`}
      >
        <UploadCloud size={28} className="text-brand" />
        <p className="mt-2 text-sm font-semibold text-navy">{busy ? "Working…" : "Drop Amazon reports here, or click to choose"}</p>
        <p className="mt-1 text-xs text-muted">CSV, TXT, XLSX, ZIP or PDF. Several at once is fine; each report is recognised from its columns.</p>
        <input ref={input} type="file" multiple hidden accept=".csv,.txt,.tsv,.xlsx,.zip,.pdf" onChange={(e) => { run([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {items.length > 0 && (
        <table className="tbl mt-4">
          <thead><tr><th>File</th><th>Recognised as</th><th className="num">Rows saved</th><th>Result</th></tr></thead>
          <tbody>
            {items.flatMap((it, i) =>
              it.outcomes.length
                ? it.outcomes.map((o, j) => (
                    <tr key={`${i}-${j}`}>
                      <td className="break-all text-xs">{j === 0 ? it.file.name : ""}{o.fileName !== it.file.name && <div className="text-faint">{o.fileName}</div>}</td>
                      <td>{o.label}{o.period && <div className="text-[11px] text-faint">{o.period}</div>}</td>
                      <td className="num">{o.rows ? o.rows.toLocaleString("en-IN") : "–"}</td>
                      <td className={`text-xs ${o.ok ? "text-emerald-700" : "text-red-700"}`}>{o.ok ? "Saved" : "Not saved"}{o.message && <div className={o.ok ? "text-amber-800" : ""}>{o.message}</div>}</td>
                    </tr>
                  ))
                : [<tr key={i}><td className="break-all text-xs">{it.file.name}</td><td colSpan={2} className="text-muted">{({ waiting: "Waiting", uploading: "Uploading…", reading: "Reading…", done: "", failed: "" } as const)[it.state]}</td><td className="text-xs text-red-700">{it.error}</td></tr>]
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function PasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setMsg({ ok: false, text: "Use at least 10 characters." });
    if (pw !== pw2) return setMsg({ ok: false, text: "The two passwords do not match." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw(""); setPw2("");
    setMsg({ ok: true, text: "Password changed." });
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-3">
      <div>
        <label className="label" htmlFor="pw">New password</label>
        <input id="pw" type="password" autoComplete="new-password" className="field" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="pw2">Type it again</label>
        <input id="pw2" type="password" autoComplete="new-password" className="field" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      <button disabled={busy} className="btn btn-dark">{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}

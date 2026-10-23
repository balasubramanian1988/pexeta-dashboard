"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function LoginForms() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: "Email or password is not right." });
    router.replace("/");
    router.refresh();
  }

  async function forgot() {
    if (!email.trim()) return setMsg({ tone: "error", text: "Enter your email first, then choose Forgot password." });
    setBusy(true);
    await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/auth/callback?next=/account` });
    setBusy(false);
    setMsg({ tone: "ok", text: "If that email has a login, a reset link is on its way." });
  }

  async function google() {
    await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  return (
    <>
      <form onSubmit={signIn} className="mt-6 space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</p>}
        <button disabled={busy} className="btn btn-primary w-full">{busy ? "Please wait…" : "Sign in"}</button>
        <button type="button" onClick={forgot} disabled={busy} className="w-full text-center text-xs font-semibold text-brand hover:underline">Forgot password?</button>
      </form>
      <div className="mt-6 border-t border-line pt-5 text-center">
        <p className="text-xs text-muted">Pexeta team</p>
        <button onClick={google} className="btn btn-outline mt-2 w-full">Sign in with Google</button>
      </div>
    </>
  );
}

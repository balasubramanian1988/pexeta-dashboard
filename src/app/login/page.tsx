import type { Metadata } from "next";
import Logo from "@/components/Logo";
import LoginForms from "./LoginForms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  const { error, reset } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-5 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="text-center">
          <Logo dark />
          <div className="eyebrow mt-5">Seller dashboard</div>
          <h1 className="mt-2 text-2xl font-bold text-navy">Your marketplace business, in one place</h1>
          <p className="mt-2 text-sm text-muted">Profit, sales, ads, stock and GST documents.</p>
        </div>
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">That link has expired or sign-in didn&apos;t complete. Try again.</p>}
        {reset && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password updated. Sign in with your new password.</p>}
        <LoginForms />
      </div>
    </main>
  );
}

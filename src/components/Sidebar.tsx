"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BadgeIndianRupee, BarChart3, Boxes, Building2, FileText, Gauge, LayoutGrid, Megaphone, ListChecks, Menu, Search, Store, Undo2, Tags, Upload, Users, Wallet, X, LogOut, KeyRound } from "lucide-react";
import Logo from "./Logo";

type Props = { name: string; team: boolean; accounts: { id: string; name: string; marketplace: string; client_id: string; client_name: string }[] };

// FirstCry, Myntra and Flipkart (seller-shipped marketplaces) share one set of tabs; Amazon has its own.
const DROPSHIP_TABS = [
  { slug: "", label: "Overview", icon: Gauge },
  { slug: "profit", label: "Profitability", icon: BadgeIndianRupee },
  { slug: "revenue", label: "Orders & returns", icon: BarChart3 },
  { slug: "payments", label: "Payments", icon: Wallet },
  { slug: "ads", label: "Ads", icon: Megaphone, only: ["FirstCry", "Flipkart"] },
  { slug: "gst", label: "GST & documents", icon: FileText, only: ["Flipkart"] },
  { slug: "stock", label: "45-day stock plan", icon: Boxes },
  { slug: "costs", label: "Product costs", icon: Tags },
];

const TABS = [
  { slug: "", label: "Overview", icon: Gauge },
  { slug: "profit", label: "Profitability", icon: BadgeIndianRupee },
  { slug: "revenue", label: "Revenue", icon: BarChart3 },
  { slug: "ads", label: "Ads", icon: Megaphone },
  { slug: "search", label: "Search & listings", icon: Search },
  { slug: "stock", label: "45-day stock plan", icon: Boxes },
  { slug: "gst", label: "GST & documents", icon: FileText },
  { slug: "costs", label: "Product costs", icon: Tags },
];

export default function Sidebar({ name, team, accounts }: Props) {
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const current = path.match(/^\/a\/([0-9a-f-]{36})/i)?.[1] ?? (accounts.length === 1 ? accounts[0].id : null);
  const account = accounts.find((a) => a.id === current);
  // The brand in view: from /b/<client> or the open marketplace account; a seller has only one brand.
  const brandId = path.match(/^\/b\/([0-9a-f-]{36})/i)?.[1] ?? account?.client_id ?? (!team ? accounts[0]?.client_id : undefined);
  const brandAccounts = accounts.filter((a) => a.client_id === brandId);
  // Keep the chosen dates when moving between tabs.
  const range = sp.get("from") && sp.get("to") ? `?from=${sp.get("from")}&to=${sp.get("to")}` : "";

  const item = (href: string, label: string, Icon: typeof Gauge, active: boolean) => (
    <Link key={href} href={href} onClick={() => setOpen(false)}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
      <Icon size={17} className={active ? "text-amber" : ""} />
      {label}
    </Link>
  );

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo />
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber">Seller dashboard</div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3">
        {team && item("/accounts", "Brands", Building2, path === "/accounts")}
        {team && item("/team/sellers", "Seller logins", Users, path.startsWith("/team/sellers"))}
        {brandId && brandAccounts.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{brandAccounts[0].client_name}</div>
            {item(`/b/${brandId}${range}`, "All marketplaces", LayoutGrid, path === `/b/${brandId}`)}
            {item(`/b/${brandId}/returns${range}`, "Returns & reimbursements", Undo2, path === `/b/${brandId}/returns`)}
            {item(`/b/${brandId}/work${range}`, "Pexeta's work", ListChecks, path === `/b/${brandId}/work`)}
            {brandAccounts.map((a) => (
              <div key={a.id}>
                {item(`/a/${a.id}${range}`, a.marketplace || a.name, Store, a.id === account?.id && path === `/a/${a.id}`)}
                {a.id === account?.id && (
                  <div className="ml-5 space-y-0.5 border-l border-white/10 pl-2">
                    {(["FirstCry", "Myntra", "Flipkart"].includes(a.marketplace) ? DROPSHIP_TABS : TABS).filter((t) => t.slug && (!("only" in t) || (t.only as string[]).includes(a.marketplace))).map((t) => {
                      const href = `/a/${a.id}/${t.slug}`;
                      return item(`${href}${t.slug === "costs" || t.slug === "gst" || t.slug === "search" ? "" : range}`, t.label, t.icon, path.startsWith(href));
                    })}
                    {team && item(`/a/${a.id}/uploads`, "Upload reports", Upload, path.startsWith(`/a/${a.id}/uploads`))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="border-t border-white/10 px-5 py-4">
        <div className="text-sm font-semibold text-white">{name}</div>
        <div className="text-xs text-slate-400">{team ? "Pexeta team" : "Seller"}</div>
        <div className="mt-3 flex items-center gap-4">
          <Link href="/account" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"><KeyRound size={13} /> Login</Link>
          <form action="/auth/signout" method="post">
            <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"><LogOut size={13} /> Sign out</button>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-navy lg:block">{nav}</aside>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-navy px-4 lg:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-white"><Menu size={22} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-navy">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 text-white"><X size={20} /></button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

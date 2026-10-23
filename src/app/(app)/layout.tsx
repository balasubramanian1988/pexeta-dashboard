import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import { getViewer, listAccounts } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [viewer, accounts] = await Promise.all([getViewer(), listAccounts()]);
  return (
    <div className="min-h-screen">
      <Suspense>
        <Sidebar name={viewer.name} team={viewer.kind === "team"} accounts={accounts} />
      </Suspense>
      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}

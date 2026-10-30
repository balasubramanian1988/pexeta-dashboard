import { notFound } from "next/navigation";
import { getAccount, getViewer } from "@/lib/auth";
import { getPeriod } from "@/lib/period";
import FcPayments from "../_firstcry/Payments";
import MyPayments from "../_myntra/Payments";

export const metadata = { title: "Payments" };

// FirstCry and Myntra: Amazon payments are covered by its Profitability and GST pages.
export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const [viewer, account] = await Promise.all([getViewer(), getAccount(accountId)]);
  if (account.marketplace !== "FirstCry" && account.marketplace !== "Myntra") notFound();
  const period = await getPeriod(account.id, await searchParams);
  if (account.marketplace === "Myntra") return <MyPayments account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
  return <FcPayments account={account} period={period} team={viewer.kind === "team"} canEdit={viewer.canEditCosts} />;
}

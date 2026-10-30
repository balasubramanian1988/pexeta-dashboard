import { redirect } from "next/navigation";
import { getViewer, listAccounts } from "@/lib/auth";

export default async function Home() {
  const v = await getViewer();
  if (v.kind === "team") redirect("/accounts");
  const accounts = await listAccounts();
  // One marketplace: straight to it. Several: the brand's all-marketplaces view.
  if (accounts.length === 1) redirect(`/a/${accounts[0].id}`);
  if (accounts[0]) redirect(`/b/${accounts[0].client_id}`);
  redirect("/not-authorised");
}

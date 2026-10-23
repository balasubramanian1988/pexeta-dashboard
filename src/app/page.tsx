import { redirect } from "next/navigation";
import { getViewer, listAccounts } from "@/lib/auth";

export default async function Home() {
  const v = await getViewer();
  if (v.kind === "team") redirect("/accounts");
  const accounts = await listAccounts();
  if (accounts[0]) redirect(`/a/${accounts[0].id}`);
  redirect("/not-authorised");
}

import { PageHeader } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import PasswordForm from "./PasswordForm";

export const metadata = { title: "Your login" };

export default async function AccountPage() {
  const v = await getViewer();
  return (
    <>
      <PageHeader eyebrow="Your login" title={v.name} sub={v.email} />
      {v.kind === "seller" ? (
        <div className="card max-w-md p-5">
          <h2 className="text-base font-bold text-navy">Change password</h2>
          <p className="mt-1 text-sm text-muted">Use at least 10 characters. You stay signed in on this device.</p>
          <PasswordForm />
        </div>
      ) : (
        <p className="text-sm text-muted">Pexeta team members sign in with Google, so there is no password to manage here.</p>
      )}
    </>
  );
}

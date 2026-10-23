import Logo from "@/components/Logo";

export const metadata = { title: "No access" };

export default function NotAuthorised() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <Logo dark />
        <h1 className="mt-6 text-xl font-bold text-navy">This login has no dashboard access</h1>
        <p className="mt-2 text-sm text-muted">Ask your Pexeta account manager to set up your login, then sign in again.</p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="btn btn-outline w-full">Sign out</button>
        </form>
      </div>
    </main>
  );
}

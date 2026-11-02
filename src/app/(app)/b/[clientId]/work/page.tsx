// Pexeta's work for the brand, from Pexeta Ops: what is waiting on the seller, what is in progress, what was completed.
// Only tasks the team marked "Show to client" appear; completed means closed by the VP.
import PeriodPicker from "@/components/PeriodPicker";
import { Empty, PageHeader, PeriodNote, Section, StatusPill } from "@/components/ui";
import { getBrandAccounts, getViewer } from "@/lib/auth";
import { getClientWork, type WorkItem } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import { getBrandPeriod } from "@/lib/period";

export const metadata = { title: "Pexeta's work" };

function List({ items, kind }: { items: WorkItem[]; kind: "waiting" | "progress" | "done" }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => (
        <li key={t.ref} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold">{t.title}{t.marketplace && <span className="ml-2"><StatusPill tone="grey">{t.marketplace}</StatusPill></span>}</div>
            {kind === "waiting" && t.need && <div className="mt-0.5 text-xs text-amber-800">What we need: {t.need}</div>}
          </div>
          <div className="shrink-0 text-xs text-muted">{kind === "done" ? `Completed ${dateLabel(t.done_at)}` : `Due ${dateLabel(t.due_date)}`} · PX-{t.ref}</div>
        </li>
      ))}
    </ul>
  );
}

export default async function WorkPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { clientId } = await params;
  const [viewer, { clientName, accounts }] = await Promise.all([getViewer(), getBrandAccounts(clientId)]);
  const period = await getBrandPeriod(accounts.map((a) => a.id), await searchParams);
  const w = await getClientWork(clientId, period.from, period.to);
  const team = viewer.kind === "team";

  return (
    <>
      <PageHeader eyebrow={`${clientName} · Pexeta`} title="Pexeta's work"
        sub={<>What Pexeta is doing for {clientName}, from the team&apos;s task tracker. Completed items: <PeriodNote from={period.from} to={period.to} />; items waiting or in progress are shown whatever their date.</>}
        action={<PeriodPicker period={period} basePath={`/b/${clientId}/work`} />} />
      {!w.available ? <div className="card"><Empty>The work list is not switched on yet. {team ? "Run supabase/007_client_work.sql in Supabase." : ""}</Empty></div> : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="card px-4 py-3.5"><div className="text-xs font-medium text-muted">Waiting on you</div><div className={`tabular mt-1 text-xl font-bold ${w.waiting.length ? "text-amber-700" : "text-navy"}`}>{w.waiting.length}</div></div>
            <div className="card px-4 py-3.5"><div className="text-xs font-medium text-muted">In progress</div><div className="tabular mt-1 text-xl font-bold text-navy">{w.inProgress.length}</div></div>
            <div className="card px-4 py-3.5"><div className="text-xs font-medium text-muted">Completed in these dates</div><div className="tabular mt-1 text-xl font-bold text-emerald-700">{w.completed.length}</div></div>
          </div>
          {w.waiting.length > 0 && <Section title="Waiting on you" sub="Pexeta needs something from you before these can move.">{<List items={w.waiting} kind="waiting" />}</Section>}
          <Section title="In progress">{w.inProgress.length ? <List items={w.inProgress} kind="progress" /> : <Empty>Nothing in progress right now.</Empty>}</Section>
          <Section title="Completed" sub="Checked and closed by Pexeta's VP.">{w.completed.length ? <List items={w.completed} kind="done" /> : <Empty>No work completed in these dates yet.</Empty>}</Section>
          {team && <p className="text-xs text-muted">Only tasks marked &quot;Show to client&quot; in Pexeta Ops appear here, under their client-facing title.</p>}
        </>
      )}
    </>
  );
}

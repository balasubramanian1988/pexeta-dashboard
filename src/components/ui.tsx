// Small presentational pieces shared across pages.
import Link from "next/link";
import { compactRupees, dateLabel } from "@/lib/format";

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-bold text-navy">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`tabular mt-1 text-xl font-bold ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-navy"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function KpiRupees({ label, value, sub, signed }: { label: string; value: number; sub?: string; signed?: boolean }) {
  return <Kpi label={label} value={compactRupees(value)} sub={sub} tone={signed ? (value >= 0 ? "good" : "bad") : undefined} />;
}

export function Section({ title, sub, children, action }: { title: string; sub?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-navy">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function NoData({ accountId, what, team }: { accountId: string; what: string; team: boolean }) {
  return (
    <Empty>
      No {what} for these dates yet.{" "}
      {team ? <Link className="font-semibold text-brand underline" href={`/a/${accountId}/uploads`}>Upload reports</Link> : "Pexeta uploads Amazon reports daily; check back soon."}
    </Empty>
  );
}

export function PeriodNote({ from, to }: { from: string; to: string }) {
  return <span className="tabular">{dateLabel(from)} to {dateLabel(to)}</span>;
}

/** Horizontal share bar for tables. */
export function Bar({ share, tone = "brand" }: { share: number; tone?: "brand" | "amber" }) {
  const w = Math.max(0, Math.min(1, share)) * 100;
  return (
    <span className="inline-block h-1.5 w-20 rounded-full bg-ice-dim align-middle">
      <span className={`block h-1.5 rounded-full ${tone === "amber" ? "bg-amber" : "bg-brand"}`} style={{ width: `${w}%` }} />
    </span>
  );
}

/** Simple daily column chart (server-rendered SVG). */
export function DailyBars({ data, format, label }: { data: { date: string; value: number }[]; format: (n: number) => string; label: string }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 720, H = 160, pad = 24, bw = (W - pad) / data.length;
  return (
    <figure className="px-4 py-4">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label={label}>
        <line x1={pad} x2={W} y1={H} y2={H} stroke="var(--line)" />
        {data.map((d, i) => {
          const h = (Math.max(0, d.value) / max) * (H - 10);
          return (
            <g key={d.date}>
              <rect x={pad + i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx={2} fill="var(--blue)">
                <title>{`${dateLabel(d.date)}: ${format(d.value)}`}</title>
              </rect>
              {(data.length <= 16 || i % Math.ceil(data.length / 12) === 0) && (
                <text x={pad + i * bw + bw / 2} y={H + 15} textAnchor="middle" fontSize="10" fill="var(--muted)">{Number(d.date.slice(8))}</text>
              )}
            </g>
          );
        })}
        <text x={0} y={10} fontSize="10" fill="var(--muted)">{format(max)}</text>
      </svg>
    </figure>
  );
}

export function StatusPill({ tone, children }: { tone: "red" | "amber" | "green" | "grey" | "blue"; children: React.ReactNode }) {
  const cls = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800", green: "bg-emerald-50 text-emerald-700", grey: "bg-slate-100 text-slate-600", blue: "bg-sky-50 text-sky-800" }[tone];
  return <span className={`pill ${cls}`}>{children}</span>;
}

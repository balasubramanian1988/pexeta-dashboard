// Date range control: preset links plus a custom from/to form (plain GET, works without JavaScript).
import Link from "next/link";
import { presets, type Period } from "@/lib/period";
import { dateLabel } from "@/lib/format";

export default function PeriodPicker({ period, basePath }: { period: Period; basePath: string }) {
  const list = period.latest ? presets(period.latest) : [];
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-1.5">
        {list.map((p) => {
          const active = p.from === period.from && p.to === period.to;
          return (
            <Link key={p.label} href={`${basePath}?from=${p.from}&to=${p.to}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-navy text-white" : "border border-line bg-white text-ink hover:bg-ice-dim"}`}>
              {p.label}
            </Link>
          );
        })}
      </div>
      <form action={basePath} className="flex items-center gap-1.5 text-xs">
        <input type="date" name="from" defaultValue={period.from} className="field !w-auto !py-1 !text-xs" aria-label="From" />
        <span className="text-muted">to</span>
        <input type="date" name="to" defaultValue={period.to} className="field !w-auto !py-1 !text-xs" aria-label="To" />
        <button className="btn btn-outline !px-2.5 !py-1 !text-xs">Show</button>
      </form>
      {period.latest && <div className="text-[11px] text-faint">Data up to {dateLabel(period.latest)}</div>}
    </div>
  );
}

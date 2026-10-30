// Shared bits for the FirstCry and Myntra pages.
import Link from "next/link";
import PeriodPicker from "@/components/PeriodPicker";
import { Empty, PageHeader, PeriodNote } from "@/components/ui";
import type { Account } from "@/lib/auth";
import type { Period } from "@/lib/period";

export type FcPageProps = { account: Account; period: Period; team: boolean; canEdit: boolean };

export function FcHeader({ account, period, title, slug, sub }: { account: Account; period: Period; title: string; slug: string; sub?: React.ReactNode }) {
  return (
    <PageHeader eyebrow={`${account.client_name} · ${account.marketplace}`} title={title}
      sub={<><PeriodNote from={period.from} to={period.to} /> (by order date). {sub}</>}
      action={<PeriodPicker period={period} basePath={`/a/${account.id}${slug ? `/${slug}` : ""}`} />} />
  );
}

export function FcNoData({ accountId, team, what = "orders", marketplace = "FirstCry" }: { accountId: string; team: boolean; what?: string; marketplace?: string }) {
  return (
    <div className="card">
      <Empty>
        No {what} for these dates yet.{" "}
        {team ? <Link className="font-semibold text-brand underline" href={`/a/${accountId}/uploads`}>Upload {marketplace} reports</Link> : `Pexeta uploads ${marketplace} reports regularly; check back soon.`}
      </Empty>
    </div>
  );
}

/** One-line explanation of how FirstCry figures are worked out, shown under the KPI tiles. */
export function HowItWorks() {
  return (
    <p className="mb-6 text-xs text-muted">
      FirstCry pays a fixed <b>base cost</b> per delivered unit, plus GST. There are no separate commission or shipping lines: FirstCry keeps the rest of the MRP.
      Revenue below is that base cost, excluding GST, minus undelivered (RTO) units and customer returns, which FirstCry recovers by debit note.
      Orders not yet in a Vendor Reconciliation file are estimated at the product&apos;s latest base cost until the file arrives.
    </p>
  );
}

// Excel report of the All marketplaces view, for the team to present to the seller.
import { NextResponse } from "next/server";
import { getBrandAccounts } from "@/lib/auth";
import { getBrand, getSearch } from "@/lib/data";
import { getBrandPeriod } from "@/lib/period";
import { buildBrandWorkbook } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { clientName, accounts } = await getBrandAccounts(clientId);
  const sp = new URL(req.url).searchParams;
  const period = await getBrandPeriod(accounts.map((a) => a.id), { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const amazon = accounts.find((a) => a.marketplace === "Amazon");
  const [{ markets, extra, prevFrom, prevTo }, search] = await Promise.all([getBrand(accounts, period.from, period.to, period.days), amazon ? getSearch(amazon) : Promise.resolve(null)]);
  const wb = buildBrandWorkbook({ clientName, period, prevFrom, prevTo, markets, extra, search: search?.hasData ? search.result : null });
  const buf = await wb.xlsx.writeBuffer();
  const name = `${clientName.replace(/[^A-Za-z0-9]+/g, "-")}-All-marketplaces-${period.from}-to-${period.to}.xlsx`;
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

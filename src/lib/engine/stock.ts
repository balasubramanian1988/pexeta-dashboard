// 45-day stock plan, same method as the Root and Soil workbook of 23 Oct 2026.
//  daily rate   = units ordered in the sales period ÷ days in the period
//  total stock  = FBA fulfillable + reserved + FBA inbound + seller warehouse stock (seller input)
//  units to make = max(0, ceil(daily rate × (horizon + lead time + safety days) − total stock))
//  Easy Ship listed quantity is shown for reference only: sellers usually type a round number (often 300).
import type { AccountDefaults, InventoryRow, ListingRow, ProductRow, ProductSetting } from "./types";

export type StockStatus = "urgent" | "make" | "enough" | "no_sales" | "count_needed";
export type StockRow = {
  asin: string; name: string;
  unitsSold: number; perDay: number;
  fbaStock: number; fbaInbound: number; warehouse: number | null;
  leadTime: number; leadTimeOverridden: boolean;
  totalStock: number; daysLeft: number | null;
  needed: number; toMake: number; status: StockStatus;
  easyShipListed: number | null;
};

export const STATUS_LABEL: Record<StockStatus, string> = {
  urgent: "Urgent",
  make: "Make now",
  enough: "Enough stock",
  no_sales: "No recent sales",
  count_needed: "Enter your stock",
};

export function computeStock(args: {
  unitsByAsin: Map<string, number>;   // units ordered in the period
  periodDays: number;
  inventory: InventoryRow[];          // latest FBA snapshot
  listings: ListingRow[];             // latest active listings snapshot
  products: ProductRow[];
  settings: ProductSetting[];
  defaults: AccountDefaults;
}): StockRow[] {
  const { unitsByAsin, periodDays, inventory, listings, products, settings, defaults } = args;
  const fba = new Map<string, { stock: number; inbound: number }>();
  for (const i of inventory) {
    const x = fba.get(i.asin) ?? { stock: 0, inbound: 0 };
    x.stock += i.fulfillable + i.reserved;
    x.inbound += i.inbound_working + i.inbound_shipped + i.inbound_receiving;
    fba.set(i.asin, x);
  }
  const easyShip = new Map<string, number>();
  for (const l of listings) if (l.channel === "DEFAULT" && l.quantity != null) easyShip.set(l.asin, (easyShip.get(l.asin) ?? 0) + l.quantity);
  const setting = new Map(settings.map((s) => [s.asin, s]));
  const name = new Map(products.map((p) => [p.asin, p.short_name || p.title || p.asin]));
  const asins = new Set([...unitsByAsin.keys(), ...fba.keys()]);
  const rows: StockRow[] = [];
  for (const asin of asins) {
    const sold = unitsByAsin.get(asin) ?? 0;
    const perDay = periodDays > 0 ? sold / periodDays : 0;
    const f = fba.get(asin) ?? { stock: 0, inbound: 0 };
    const s = setting.get(asin);
    const warehouse = s?.warehouse_stock ?? null;
    const leadTime = s?.lead_time_days ?? defaults.default_lead_time_days;
    const totalStock = f.stock + f.inbound + (warehouse ?? 0);
    const daysLeft = perDay > 0 ? totalStock / perDay : null;
    const needed = perDay * (defaults.plan_horizon_days + leadTime + defaults.default_safety_days);
    const toMake = Math.max(0, Math.ceil(needed - totalStock - 1e-9));
    // Sold through Easy Ship with nothing at FBA: the real stock is in the seller's warehouse, which only they can count.
    const easyShipOnly = f.stock + f.inbound === 0 && warehouse == null && easyShip.has(asin);
    const status: StockStatus = perDay === 0 ? "no_sales" : easyShipOnly ? "count_needed" : daysLeft! < leadTime ? "urgent" : toMake > 0 ? "make" : "enough";
    rows.push({
      asin, name: name.get(asin) ?? asin, unitsSold: sold, perDay,
      fbaStock: f.stock, fbaInbound: f.inbound, warehouse, leadTime, leadTimeOverridden: s?.lead_time_days != null,
      totalStock, daysLeft, needed, toMake, status, easyShipListed: easyShip.get(asin) ?? null,
    });
  }
  const rank: Record<StockStatus, number> = { urgent: 0, make: 1, count_needed: 2, enough: 3, no_sales: 4 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || b.toMake - a.toMake || b.unitsSold - a.unitsSold);
}

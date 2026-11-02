// Why customers send products back, across marketplaces: each return is put into one plain theme from the
// marketplace's reason code and the customer's own words, then turned into actions. Pure functions, no AI:
// the same files always give the same result, and every action quotes its numbers.

export type ReturnTheme = "refused" | "damaged" | "quality" | "wrong_item" | "price_or_mind" | "other";
export const THEME_LABEL: Record<ReturnTheme, string> = {
  refused: "Refused or not delivered",
  damaged: "Damaged, leaking or opened",
  quality: "Quality or authenticity doubt",
  wrong_item: "Wrong item or bought by mistake",
  price_or_mind: "Found cheaper or changed mind",
  other: "Other or no reason",
};

export type ReturnLine = {
  marketplace: string; date: string; product: string; name: string;
  quantity: number; reason: string; detail: string; comment: string;
};
export type ThemedLine = ReturnLine & { theme: ReturnTheme };
export type ProductReturns = { marketplace: string; product: string; name: string; total: number; byTheme: Partial<Record<ReturnTheme, number>>; comments: string[] };
export type ReturnAction = { owner: "Seller" | "Pexeta" | "Seller + Pexeta"; title: string; why: string };
export type ReturnsResult = {
  total: number;
  byTheme: { theme: ReturnTheme; units: number; share: number }[];
  byMarketplace: { marketplace: string; total: number; byTheme: Partial<Record<ReturnTheme, number>> }[];
  products: ProductReturns[];
  actions: ReturnAction[];
  lines: ThemedLine[];
};

const has = (s: string, words: RegExp) => words.test(s.toLowerCase());
const DAMAGE = /\b(damag|broken|leak|spill|crack|open(ed)?|reseal|seal|tamper|dirty|spoil|torn|dent)/;
const QUALITY = /\b(genuine|fake|duplicate|quality|smell|expir|rash|allerg|reaction|irritat|defect|not good|bad product)/;
const WRONG = /\b(wrong|mistake|different item|not ordered|ordered wrong|size)/;
const PRICE = /\b(price|cheaper|less|discount|offer|prime day|no longer|don'?t want|not required|changed my mind)/;

/** One theme per return. The customer's words decide where they are specific (a "quality" return whose comment
 *  says the seal was broken is a packaging problem); otherwise the marketplace's reason code. */
export function themeOf(l: Pick<ReturnLine, "reason" | "detail" | "comment">): ReturnTheme {
  const code = `${l.reason} ${l.detail}`.toLowerCase();
  const text = l.comment.toLowerCase();
  if (/undeliverable|refused|\brto\b|return to origin|not delivered|rejected at door/.test(code) || code.trim() === "rto") return "refused";
  if (text && has(text, DAMAGE)) return "damaged";
  if (text && has(text, QUALITY)) return "quality";
  if (text && has(text, WRONG)) return "wrong_item";
  if (text && has(text, PRICE)) return "price_or_mind";
  if (/damag|leak|spill|missing.?part|broken|carrier/.test(code)) return "damaged";
  if (/quality|defect|not.?as.?described|expired|fake|genuine/.test(code)) return "quality";
  if (/wrong|mistake|ordered_wrong|different/.test(code)) return "wrong_item";
  if (/better.?price|unwanted|no.?longer|changed|not.?required|late/.test(code)) return "price_or_mind";
  return "other";
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function computeReturns(lines: ReturnLine[]): ReturnsResult {
  const themed: ThemedLine[] = lines.map((l) => ({ ...l, theme: themeOf(l) }));
  const total = themed.reduce((s, l) => s + l.quantity, 0);
  const tally = (xs: ThemedLine[]) => { const m: Partial<Record<ReturnTheme, number>> = {}; for (const l of xs) m[l.theme] = (m[l.theme] ?? 0) + l.quantity; return m; };
  const all = tally(themed);
  const byTheme = (Object.keys(THEME_LABEL) as ReturnTheme[]).map((theme) => ({ theme, units: all[theme] ?? 0, share: total ? (all[theme] ?? 0) / total : 0 })).filter((x) => x.units > 0).sort((a, b) => b.units - a.units);
  const markets = [...new Set(themed.map((l) => l.marketplace))];
  const byMarketplace = markets.map((marketplace) => { const xs = themed.filter((l) => l.marketplace === marketplace); return { marketplace, total: xs.reduce((s, l) => s + l.quantity, 0), byTheme: tally(xs) }; });

  const pm = new Map<string, ThemedLine[]>();
  for (const l of themed) pm.set(`${l.marketplace}|${l.product}`, [...(pm.get(`${l.marketplace}|${l.product}`) ?? []), l]);
  const products: ProductReturns[] = [...pm.values()].map((xs) => ({
    marketplace: xs[0].marketplace, product: xs[0].product, name: xs[0].name,
    total: xs.reduce((s, l) => s + l.quantity, 0), byTheme: tally(xs),
    comments: [...new Set(xs.map((l) => l.comment.trim()).filter((c) => c.length > 3))].slice(0, 6),
  })).sort((a, b) => b.total - a.total);

  // ---------- Actions ----------
  const actions: ReturnAction[] = [];
  const refused = all.refused ?? 0;
  // Refused at the door is 30%+ of returns and at least 10 units: usually cash-on-delivery orders.
  if (total && refused >= 10 && refused / total >= 0.3) {
    const where = byMarketplace.filter((m) => (m.byTheme.refused ?? 0) > 0).sort((a, b) => (b.byTheme.refused ?? 0) - (a.byTheme.refused ?? 0)).map((m) => `${m.marketplace} ${m.byTheme.refused}`).join(", ");
    actions.push({ owner: "Seller + Pexeta", title: "Cut refused deliveries", why: `${refused} of ${total} returned units (${pct(refused / total)}) were refused at the door or never delivered (${where}). These are usually cash-on-delivery orders: they cost shipping both ways and earn nothing. Options: prepaid offers, confirming COD orders by call or WhatsApp, and blocking repeat-refusal pincodes for self-shipped orders.` });
  }
  // Packaging, quality and wrong-item problems on one product: 3+ units, and at least a third of that product's returns.
  const flag = (theme: ReturnTheme, owner: ReturnAction["owner"], title: (n: string) => string, fix: string) => {
    const hit = products.filter((p) => (p.byTheme[theme] ?? 0) >= 3 && (p.byTheme[theme] ?? 0) / p.total >= 0.33).sort((a, b) => (b.byTheme[theme] ?? 0) - (a.byTheme[theme] ?? 0))[0];
    if (!hit) return;
    const quotes = themed.filter((l) => l.marketplace === hit.marketplace && l.product === hit.product && l.theme === theme && l.comment).map((l) => `“${l.comment.slice(0, 90)}${l.comment.length > 90 ? "…" : ""}”`).slice(0, 2).join(" ");
    actions.push({ owner, title: title(hit.name), why: `${hit.byTheme[theme]} of its ${hit.total} returned units on ${hit.marketplace}. ${quotes} ${fix}`.trim() });
  };
  flag("damaged", "Seller", (n) => `Check packaging for ${n}`, "Look at the seal, outer box and padding, and whether the warehouse or courier is damaging it.");
  flag("quality", "Seller", (n) => `Check batch quality and authenticity cues for ${n}`, "Check batch and expiry dates, and consider a tamper-evident seal and a 'how to check it's genuine' line on the listing.");
  flag("wrong_item", "Pexeta", (n) => `Make ${n}'s listing clearer`, "Customers expected something else: check title, size and variant names, and images.");
  // Customers returning because it was cheaper elsewhere or during a sale: 3+ units.
  const price = themed.filter((l) => l.theme === "price_or_mind" && /price|cheaper|less|prime|offer|discount/i.test(`${l.comment} ${l.reason}`));
  if (price.reduce((s, l) => s + l.quantity, 0) >= 3)
    actions.push({ owner: "Seller + Pexeta", title: "Keep prices steady around sale events", why: `${price.reduce((s, l) => s + l.quantity, 0)} units came back because the customer found a lower price (often during a sale). Matching the sale price, or a price-protection note, avoids paying shipping both ways.` });

  return { total, byTheme, byMarketplace, products, actions: actions.slice(0, 5), lines: themed };
}

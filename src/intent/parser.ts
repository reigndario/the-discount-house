import {
  BOUNDS,
  fieldSlot,
  splitFieldSlot,
  type Bound,
  type ParseContext,
  type SlotCandidate,
  type SlotKey,
  type Span,
} from "./types";
import type { PlainFieldName, PlainSide } from "../protocolSdk";

export type QuantityUnit = "percent" | "currency" | "days" | "tokens";

export type Quantity = {
  /** The number as written, with k and m applied. */
  raw: number;
  /** `raw` times the unit factor (weeks, months and years become days). */
  value: number;
  unitFactor: number;
  unit: QuantityUnit | null;
  span: Span;
};

const NUMBER_RE =
  "(\\$)?(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?(?:(k|m)\\b|\\s+(thousand|million)\\b)?" +
  "(?:\\s*(%|(?:percent|pct|apr|usdc|cusdc|usd|dollars?|days?|weeks?|months?|years?|yrs?|tokens?)\\b))?";

const DAY_FACTORS: Array<[RegExp, number]> = [
  [/^days?$/, 1],
  [/^weeks?$/, 7],
  [/^months?$/, 30],
  [/^(years?|yrs?)$/, 365],
];

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function buildQuantity(m: RegExpMatchArray | RegExpExecArray, offset: number): Quantity {
  const [text, dollar, whole, fraction, suffix, word, unitWord] = m;
  let raw = Number(whole.replace(/,/g, "") + (fraction ?? ""));
  const mult = (suffix ?? word ?? "").toLowerCase();
  if (mult === "k" || mult === "thousand") raw *= 1_000;
  if (mult === "m" || mult === "million") raw *= 1_000_000;
  raw = round(raw);

  let unit: QuantityUnit | null = null;
  let unitFactor = 1;
  const u = (unitWord ?? "").toLowerCase();
  if (u === "%" || /^(percent|pct|apr)$/.test(u)) unit = "percent";
  else if (/^(usdc|cusdc|usd|dollars?)$/.test(u)) unit = "currency";
  else if (/^tokens?$/.test(u)) unit = "tokens";
  else if (u) {
    unit = "days";
    unitFactor = DAY_FACTORS.find(([re]) => re.test(u))?.[1] ?? 1;
  }
  if (dollar && unit === null) unit = "currency";
  const start = (m.index ?? 0) + offset;
  return { raw, value: round(raw * unitFactor), unitFactor, unit, span: { start, end: start + text.length, text } };
}

/** Parse the first quantity in `text`, or null. The span verifier calls this on the cited span. */
export function parseQuantity(text: string): Quantity | null {
  const m = new RegExp(NUMBER_RE, "i").exec(text);
  return m ? buildQuantity(m, 0) : null;
}

export function findQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(new RegExp(NUMBER_RE, "gi"))) out.push(buildQuantity(m, 0));
  return out;
}

const BOUND_WORDS: Array<[Bound, RegExp]> = [
  ["max", /\b(?:at most|up to|no more than|not more than|less than|under|below|maximum|max|capped at)\b/gi],
  ["min", /\b(?:at least|no less than|not less than|more than|over|above|minimum|min)\b/gi],
  ["target", /\b(?:about|around|roughly|approximately|approx|near|ideally|targeting|target|aim(?:ing)? for)\b|~/gi],
];

/** The nearest bound word just before a quantity, if the words between them are few and contain no digits. */
function boundBefore(prefix: string): Bound | null {
  let best: { bound: Bound; end: number } | null = null;
  for (const [bound, re] of BOUND_WORDS) {
    for (const m of prefix.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length;
      const gap = prefix.slice(end);
      if (gap.length <= 20 && !/[\d.,;!?]/.test(gap) && (!best || end > best.end)) best = { bound, end };
    }
  }
  return best?.bound ?? null;
}

const UNIT_FIELD: Record<QuantityUnit, PlainFieldName | null> = {
  percent: "interestPercent",
  currency: "principal",
  tokens: "collateralAmount",
  days: "durationDays",
};

const RANGE_JOINER = /^\s*(?:-|–|—|to|and|through)\s*$/i;

type Group = { quantities: Quantity[] };

/** Pair adjacent quantities joined by "to", "and" or a dash into one range, unless their units clash. */
function groupQuantities(text: string, quantities: Quantity[]): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < quantities.length; i++) {
    const a = quantities[i];
    const b = quantities[i + 1];
    if (b && RANGE_JOINER.test(text.slice(a.span.end, b.span.start)) && (!a.unit || !b.unit || a.unit === b.unit)) {
      groups.push({ quantities: [a, b] });
      i++;
    } else {
      groups.push({ quantities: [a] });
    }
  }
  return groups;
}

function parseSide(text: string): SlotCandidate[] {
  const hits: SlotCandidate[] = [];
  const add = (re: RegExp, side: PlainSide) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      hits.push({
        slot: "side",
        value: side,
        span: { start, end: start + m[0].length, text: m[0] },
        unitFactor: 1,
      });
    }
  };
  add(/\b(?:borrow(?:er|ing|s)?|loan against|pledge)\b/gi, "borrower");
  add(/\b(?:lend(?:er|ing|s)?|earn yield)\b/gi, "lender");
  return hits;
}

export const SIDE_WORDS: Record<PlainSide, RegExp> = {
  borrower: /^(?:borrow(?:er|ing|s)?|loan against|pledge)$/i,
  lender: /^(?:lend(?:er|ing|s)?|earn yield)$/i,
};

export const INTENT_WORDS = {
  atp_deposit: /^deposit$/i,
  atp_withdraw: /^withdraw(?:al)?$/i,
} as const;

function parseIntent(text: string): SlotCandidate[] {
  const hits: SlotCandidate[] = [];
  const add = (re: RegExp, value: string) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      hits.push({ slot: "intent", value, span: { start, end: start + m[0].length, text: m[0] }, unitFactor: 1 });
    }
  };
  add(/\bdeposit\b/gi, "atp_deposit");
  add(/\bwithdraw(?:al)?\b/gi, "atp_withdraw");
  return hits;
}

/** Collapse repeated words and mark disagreeing readings of one slot as unresolved instead of picking one. */
function settleSingle(hits: SlotCandidate[], reason: "ambiguous_side" | "ambiguous_intent"): SlotCandidate[] {
  if (new Set(hits.map((h) => h.value)).size > 1) return hits.map((h) => ({ ...h, slot: null, reason }));
  return hits.slice(0, 1);
}

/**
 * Deterministic extraction. Reads numbers with units, ranges, targets ("about"), bounds ("at most", "under"),
 * durations and side keywords. Anything it cannot place comes back with `slot: null` and a reason.
 */
export function extract(text: string, context: ParseContext = {}): SlotCandidate[] {
  const out: SlotCandidate[] = [];
  out.push(...settleSingle(parseSide(text), "ambiguous_side"));
  const intentHits = settleSingle(parseIntent(text), "ambiguous_intent");
  out.push(...intentHits);

  const intent =
    intentHits.length === 1 && intentHits[0].slot === "intent" ? (intentHits[0].value as string) : context.intent;
  const atp = intent === "atp_deposit" || intent === "atp_withdraw";
  const expect = context.expecting ? splitFieldSlot(context.expecting) : null;

  const quantities = findQuantities(text);
  let prevEnd = 0;
  for (const group of groupQuantities(text, quantities)) {
    const first = group.quantities[0];
    const last = group.quantities[group.quantities.length - 1];
    const prefix = text.slice(Math.max(prevEnd, first.span.start - 30), first.span.start);
    prevEnd = last.span.end;

    const unit = group.quantities.find((q) => q.unit)?.unit ?? null;
    const factor = group.quantities.find((q) => q.unit)?.unitFactor ?? 1;
    const keyword = boundBefore(prefix);

    let field: PlainFieldName | "amount" | null = unit ? UNIT_FIELD[unit] : null;
    if (field === "durationDays" && /grace/i.test(text.slice(Math.max(0, first.span.start - 40), last.span.end + 20))) {
      field = "gracePeriodDays";
    }
    if (atp && (unit === null || unit === "currency")) field = "amount";
    if (field === null && expect) field = expect.field;
    if (field === null && context.expecting === "amount") field = "amount";

    const bounds: Bound[] =
      group.quantities.length === 2
        ? ["min", "max"]
        : [keyword ?? (expect && field === expect.field ? expect.bound : "target")];

    group.quantities.forEach((q, i) => {
      const value = round(q.raw * factor);
      const base = { value, span: q.span, unitFactor: factor };
      if (field === "amount") {
        out.push({ slot: "amount", ...base });
      } else if (field === null) {
        out.push({ slot: null, reason: "unknown_field", bound: bounds[i], ...base });
      } else {
        out.push({ slot: fieldSlot(field, bounds[i]), ...base });
      }
    });
  }

  return markConflicts(out);
}

function markConflicts(candidates: SlotCandidate[]): SlotCandidate[] {
  const bySlot = new Map<SlotKey, Set<string | number>>();
  for (const c of candidates) {
    if (c.slot) bySlot.set(c.slot, (bySlot.get(c.slot) ?? new Set()).add(c.value));
  }
  const seen = new Set<SlotKey>();
  return candidates.flatMap((c) => {
    if (!c.slot) return [c];
    if ((bySlot.get(c.slot)?.size ?? 0) > 1) return [{ ...c, slot: null, reason: "conflict" as const }];
    if (seen.has(c.slot)) return [];
    seen.add(c.slot);
    return [c];
  });
}

export { BOUNDS };

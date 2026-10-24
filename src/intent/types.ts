import type { PlainFieldName, PlainSide } from "../protocolSdk";

/** Where a slot's value came from. `stated` values always carry a `span` into the user's own text. */
export type SlotSource = "stated" | "default" | "derived" | "picked";

export type Span = { start: number; end: number; text: string };

export type Slot<T> = { value: T; source: SlotSource; span?: Span };

export type IntentKind = "atp_deposit" | "atp_withdraw";

export const BOUNDS = ["min", "max", "target"] as const;
export type Bound = (typeof BOUNDS)[number];

/** The four terms a user is asked about. Grace is defaulted, never asked. */
export const ASKED_FIELDS = ["principal", "collateralAmount", "interestPercent", "durationDays"] as const;
export const BUNDLE_FIELDS: readonly PlainFieldName[] = [...ASKED_FIELDS, "gracePeriodDays"];

export type FieldSlotKey = `${PlainFieldName}.${Bound}`;
export type SlotKey = "intent" | "side" | "amount" | FieldSlotKey;
export type SlotValue = number | string;

export type UnresolvedReason = "unknown_field" | "conflict" | "ambiguous_side" | "ambiguous_intent";

/**
 * Something the parser read in the user's text. `slot` is null when the parser refuses to guess; `reason` then says
 * why, and the dialogue policy asks instead.
 */
export type SlotCandidate = {
  slot: SlotKey | null;
  value: SlotValue;
  span: Span;
  /** Multiplier applied to the number in the span (weeks, months and years become days). 1 when none. */
  unitFactor: number;
  reason?: UnresolvedReason;
  /** For unknown_field: the bound the wording implied ("at most" is max), so a later pick keeps it. */
  bound?: Bound;
};

export type ParseContext = {
  side?: PlainSide;
  intent?: IntentKind;
  /** The slot the previous question asked about, so a bare number can be read as its answer. */
  expecting?: SlotKey;
};

export type DraftBundle = {
  slots: Partial<Record<SlotKey, Slot<SlotValue>>>;
  /** Candidates from the latest message that could not be placed. Replaced on every message. */
  unresolved: SlotCandidate[];
};

export function emptyDraft(): DraftBundle {
  return { slots: {}, unresolved: [] };
}

export function fieldSlot(field: PlainFieldName, bound: Bound): FieldSlotKey {
  return `${field}.${bound}`;
}

export function splitFieldSlot(key: SlotKey): { field: PlainFieldName; bound: Bound } | null {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  return { field: key.slice(0, dot) as PlainFieldName, bound: key.slice(dot + 1) as Bound };
}

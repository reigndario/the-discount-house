import { defaultsForSide } from "../protocolSdk";
import type { PlainSide } from "../protocolSdk";
import {
  BUNDLE_FIELDS,
  emptyDraft,
  fieldSlot,
  type Bound,
  type DraftBundle,
  type IntentKind,
  type SlotCandidate,
  type SlotKey,
  type SlotSource,
  type SlotValue,
} from "./types";

export type DraftEvent =
  | { type: "candidates"; candidates: SlotCandidate[] }
  | { type: "set"; slot: SlotKey; value: SlotValue; source?: SlotSource }
  | { type: "set_many"; entries: Array<{ slot: SlotKey; value: SlotValue }> }
  | { type: "assign_unresolved"; index: number; slot: SlotKey }
  | { type: "clear"; slot: SlotKey }
  | { type: "reset" };

function validValue(slot: SlotKey, value: SlotValue): boolean {
  if (slot === "side") return value === "borrower" || value === "lender";
  if (slot === "intent") return value === "atp_deposit" || value === "atp_withdraw";
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Fill derived targets and the grace default. Never overwrites a stated or picked value. */
function normalize(draft: DraftBundle): DraftBundle {
  const slots = { ...draft.slots };
  for (const field of BUNDLE_FIELDS) {
    const [min, max, target] = (["min", "max", "target"] as Bound[]).map((b) => slots[fieldSlot(field, b)]);
    if (min && max && (!target || target.source === "derived")) {
      const mid = Math.round(((Number(min.value) + Number(max.value)) / 2) * 1e4) / 1e4;
      slots[fieldSlot(field, "target")] = { value: mid, source: "derived" };
    } else if (target?.source === "derived" && !(min && max)) {
      delete slots[fieldSlot(field, "target")];
    }
  }
  const side = slots.side?.value as PlainSide | undefined;
  if (side && !slots.intent) {
    const grace = defaultsForSide(side).gracePeriodDays;
    for (const bound of ["min", "max", "target"] as Bound[]) {
      const key = fieldSlot("gracePeriodDays", bound);
      if (!slots[key] || slots[key]?.source === "default") slots[key] = { value: grace[bound], source: "default" };
    }
  }
  return { ...draft, slots };
}

/**
 * Pure state transition: `(draft, event) -> draft`. Never mutates its input, does no I/O and reads no clock.
 * Stated values must come with a span; the reducer drops a stated candidate that has none.
 */
export function reduce(draft: DraftBundle, event: DraftEvent): DraftBundle {
  switch (event.type) {
    case "reset":
      return emptyDraft();
    case "candidates": {
      const slots = { ...draft.slots };
      const unresolved: SlotCandidate[] = [];
      for (const c of event.candidates) {
        if (!c.slot) {
          unresolved.push(c);
        } else if (validValue(c.slot, c.value) && c.span) {
          slots[c.slot] = { value: c.value, source: c.unitFactor !== 1 ? "derived" : "stated", span: c.span };
        }
      }
      return normalize({ slots, unresolved });
    }
    case "set": {
      if (!validValue(event.slot, event.value)) return draft;
      const slots = { ...draft.slots, [event.slot]: { value: event.value, source: event.source ?? "picked" } };
      return normalize({ ...draft, slots });
    }
    case "set_many": {
      const slots = { ...draft.slots };
      for (const { slot, value } of event.entries) {
        if (validValue(slot, value)) slots[slot] = { value, source: "picked" };
      }
      return normalize({ ...draft, slots });
    }
    case "assign_unresolved": {
      const c = draft.unresolved[event.index];
      if (!c || typeof c.value !== "number" || !validValue(event.slot, c.value)) return draft;
      const slots = { ...draft.slots, [event.slot]: { value: c.value, source: "picked" as const, span: c.span } };
      return normalize({ slots, unresolved: draft.unresolved.filter((_, i) => i !== event.index) });
    }
    case "clear": {
      const slots = { ...draft.slots };
      delete slots[event.slot];
      return normalize({ ...draft, slots });
    }
  }
}

export function draftIntent(draft: DraftBundle): "bundle" | IntentKind | null {
  const intent = draft.slots.intent?.value as IntentKind | undefined;
  if (intent) return intent;
  return draft.slots.side ? "bundle" : null;
}

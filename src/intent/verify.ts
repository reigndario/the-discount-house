import { INTENT_WORDS, SIDE_WORDS, parseQuantity } from "./parser";
import { splitFieldSlot, type SlotCandidate } from "./types";
import type { PlainSide } from "../protocolSdk";

const FACTOR_WORDS: Record<number, RegExp> = {
  7: /^\s*weeks?\b/i,
  30: /^\s*months?\b/i,
  365: /^\s*(?:years?|yrs?)\b/i,
};

export type SpanCheck = { ok: true } | { ok: false; reason: string };

/**
 * Reject any candidate whose value does not appear in the user's text. The cited span must sit at the stated offsets,
 * and the value is recomputed from the span alone: a number must re-parse to the candidate's value, a side or intent
 * must be one of its own keywords. Candidates the parser left unresolved are checked the same way.
 */
export function verifySpan(text: string, candidate: SlotCandidate): SpanCheck {
  const { span } = candidate;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > text.length) {
    return { ok: false, reason: "span is outside the text" };
  }
  if (text.slice(span.start, span.end) !== span.text) return { ok: false, reason: "span does not match the text" };

  if (candidate.slot === "side" || candidate.reason === "ambiguous_side") {
    return SIDE_WORDS[candidate.value as PlainSide]?.test(span.text)
      ? { ok: true }
      : { ok: false, reason: "span is not a side keyword" };
  }
  if (candidate.slot === "intent" || candidate.reason === "ambiguous_intent") {
    const re = INTENT_WORDS[candidate.value as keyof typeof INTENT_WORDS];
    return re?.test(span.text) ? { ok: true } : { ok: false, reason: "span is not an intent keyword" };
  }

  if (typeof candidate.value !== "number") return { ok: false, reason: "expected a number" };
  const quantity = parseQuantity(span.text);
  if (!quantity || quantity.span.text !== span.text) return { ok: false, reason: "span is not a single number" };

  // A range's first number may take its unit from the second ("2 to 3 years"), so the factor can come from just
  // after the span. Without a unit word in the text it must be 1.
  const factor = quantity.unit === "days" ? quantity.unitFactor : candidate.unitFactor;
  if (factor !== 1) {
    const tail = text.slice(span.end, span.end + 12);
    const unitInSpan = quantity.unit === "days" && quantity.unitFactor === factor;
    if (!unitInSpan && !FACTOR_WORDS[factor]?.test(tail) && !/^\s*(?:-|–|to|and)\s*\d/.test(tail)) {
      return { ok: false, reason: "no unit word in the text justifies the conversion" };
    }
  }
  if (Math.abs(quantity.raw * factor - candidate.value) > 1e-6) {
    return { ok: false, reason: "value does not match the cited text" };
  }
  if (candidate.slot && candidate.slot !== "amount") {
    const parts = splitFieldSlot(candidate.slot);
    if (!parts) return { ok: false, reason: "unknown slot" };
  }
  return { ok: true };
}

/** Keep only candidates that pass `verifySpan`, returning the rejects with the reason for logging or tests. */
export function verifyAll(text: string, candidates: SlotCandidate[]) {
  const accepted: SlotCandidate[] = [];
  const rejected: Array<{ candidate: SlotCandidate; reason: string }> = [];
  for (const candidate of candidates) {
    const check = verifySpan(text, candidate);
    if (check.ok) accepted.push(candidate);
    else rejected.push({ candidate, reason: check.reason });
  }
  return { accepted, rejected };
}

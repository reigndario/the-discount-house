export * from "./types";
export { extract, parseQuantity, findQuantities } from "./parser";
export { verifySpan, verifyAll } from "./verify";
export { reduce, draftIntent, type DraftEvent } from "./reducer";
export { nextTurn, validateDraft, describeDraft, FIELD_LABELS, type Turn, type QuickReply } from "./policy";
export { toPlainBundle, toTerms, toAtpIntent, type BundleExtras, type BundleTerms, type AtpIntent } from "./bundle";

import { extract } from "./parser";
import { reduce } from "./reducer";
import { verifyAll } from "./verify";
import type { DraftBundle, ParseContext } from "./types";

/** Parse a user message, drop anything the span verifier rejects, and fold the rest into the draft. */
export function applyMessage(draft: DraftBundle, text: string, context: ParseContext = {}): DraftBundle {
  const { accepted } = verifyAll(text, extract(text, context));
  return reduce(draft, { type: "candidates", candidates: accepted });
}

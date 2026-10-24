import {
  defaultsForSide,
  type PlainBundle,
  type PlainField,
  type PlainFieldName,
  type PlainSide,
} from "../protocolSdk";
import { nextTurn } from "./policy";
import { draftIntent } from "./reducer";
import { ASKED_FIELDS, fieldSlot, type DraftBundle, type IntentKind } from "./types";

/** What a chat draft cannot know: picked from the wallet or generated at submission time. */
export type BundleExtras = {
  collateralToken: string;
  tokenOpsManager: string;
  backingId: string;
  expiryDays?: number;
};

function range(draft: DraftBundle, field: PlainFieldName): PlainField {
  const get = (b: "min" | "max" | "target") => Number(draft.slots[fieldSlot(field, b)]?.value);
  return { range: { min: get("min"), max: get("max"), target: get("target") } };
}

/** Build the SDK's `PlainBundle` from a finished draft. Throws if the dialogue policy is not done. */
export function toPlainBundle(draft: DraftBundle, extras: BundleExtras): PlainBundle {
  if (draftIntent(draft) !== "bundle") throw new Error("draft is not a bundle");
  const turn = nextTurn(draft);
  if (!turn.done) throw new Error(`draft is incomplete: ${turn.question}`);
  const side = draft.slots.side?.value as PlainSide;
  const [principal, collateralAmount, interestPercent, durationDays] = ASKED_FIELDS.map((f) => range(draft, f));
  return {
    side,
    collateralToken: extras.collateralToken,
    tokenOpsManager: extras.tokenOpsManager,
    backingId: extras.backingId,
    expiryDays: extras.expiryDays ?? defaultsForSide(side).expiryDays,
    collateralAmount,
    principal,
    interestPercent,
    durationDays,
    gracePeriodDays: range(draft, "gracePeriodDays"),
  };
}

export type AtpIntent = { kind: IntentKind; amount: number };

export function toAtpIntent(draft: DraftBundle): AtpIntent {
  const kind = draftIntent(draft);
  if (kind !== "atp_deposit" && kind !== "atp_withdraw") throw new Error("draft is not an ATP intent");
  const amount = draft.slots.amount?.value;
  if (typeof amount !== "number" || amount <= 0) throw new Error("ATP amount is missing");
  return { kind, amount };
}

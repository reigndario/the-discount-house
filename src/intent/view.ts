import {
  defaultsForSide,
  durationBucketLabel,
  principalBucketLabel,
  type PlainDirection,
  type PlainFieldName,
  type PlainPriority,
  type PlainSide,
} from "../protocolSdk";
import { validateDraft } from "./policy";
import { draftIntent } from "./reducer";
import { BUNDLE_FIELDS, fieldSlot, splitFieldSlot, type DraftBundle } from "./types";

/** What the diagram shows for one row. `empty` has no values; `default` has only defaults; otherwise `stated`. */
export type RowState = "empty" | "stated" | "default";

export type DiagramRow = {
  key: PlainFieldName | "side" | "amount";
  label: string;
  unit: string;
  /** Whether this value is public on-chain or encrypted. The exact range and target are always encrypted. */
  visibility: "public" | "encrypted";
  state: RowState;
  /** True when the values contradict each other (a minimum above the maximum, a target outside the range). */
  problem?: boolean;
  /** For a side or an amount row, the plain text value. */
  text?: string;
  min?: number;
  max?: number;
  target?: number;
  /** Public coarse bucket (principal and duration only), shown beside the encrypted range. */
  publicBucket?: string;
  direction?: PlainDirection;
  directionState?: "default";
  priority?: PlainPriority;
  priorityState?: "default";
};

const LABELS: Record<PlainFieldName, { label: string; unit: string }> = {
  principal: { label: "Loan amount", unit: "USDC" },
  collateralAmount: { label: "Collateral amount", unit: "tokens" },
  interestPercent: { label: "Interest rate", unit: "%" },
  durationDays: { label: "Duration", unit: "days" },
  gracePeriodDays: { label: "Grace period", unit: "days" },
};

function bucketOf(field: PlainFieldName, max: number | undefined) {
  if (max === undefined) return undefined;
  try {
    if (field === "principal") return principalBucketLabel(max);
    if (field === "durationDays") return durationBucketLabel(max);
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * One row per field for the draft diagram: the values so far, whether each is empty, stated or a default, and whether it
 * is public or encrypted. Pure data, so the UI only draws it. Direction and priority are the side's defaults until a
 * conversation can change them, and are labeled as defaults.
 */
export function diagramRows(draft: DraftBundle): DiagramRow[] {
  const intent = draftIntent(draft);
  if (intent === "atp_deposit" || intent === "atp_withdraw") {
    const amount = draft.slots.amount;
    return [
      {
        key: "amount",
        label: intent === "atp_deposit" ? "Deposit amount" : "Withdrawal amount",
        unit: "USDC",
        visibility: "encrypted",
        state: amount ? "stated" : "empty",
        text: amount ? String(amount.value) : undefined,
      },
    ];
  }

  const problems = new Set(validateDraft(draft).map((i) => splitFieldSlot(i.slot)?.field));
  const side = draft.slots.side?.value as PlainSide | undefined;
  const defaults = side ? defaultsForSide(side) : undefined;
  const rows: DiagramRow[] = [
    {
      key: "side",
      label: "Side",
      unit: "",
      visibility: "public",
      state: draft.slots.side ? "stated" : "empty",
      text: side,
    },
  ];
  for (const field of BUNDLE_FIELDS) {
    const slots = (["min", "max", "target"] as const).map((b) => draft.slots[fieldSlot(field, b)]);
    const present = slots.filter((s) => s !== undefined);
    const num = (i: number) => (slots[i] ? Number(slots[i]!.value) : undefined);
    const max = num(1);
    rows.push({
      key: field,
      label: LABELS[field].label,
      unit: LABELS[field].unit,
      visibility: "encrypted",
      problem: problems.has(field),
      state: present.length === 0 ? "empty" : present.every((s) => s!.source === "default") ? "default" : "stated",
      min: num(0),
      max,
      target: num(2),
      publicBucket: bucketOf(field, max),
      ...(defaults ? { direction: defaults.directions[field], directionState: "default" as const } : {}),
      ...(defaults ? { priority: defaults.priorities[field], priorityState: "default" as const } : {}),
    });
  }
  return rows;
}

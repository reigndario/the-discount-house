import type { PlainFieldName, PlainSide } from "../protocolSdk";
import { draftIntent, type DraftEvent } from "./reducer";
import { ASKED_FIELDS, BUNDLE_FIELDS, fieldSlot, type DraftBundle, type SlotKey } from "./types";

export type QuickReply = { label: string; event: DraftEvent };

export type Turn =
  | { done: false; slot: SlotKey | null; question: string; quickReplies: QuickReply[] }
  | { done: true; summary: string[] };

export const FIELD_LABELS: Record<PlainFieldName, { label: string; unit: string }> = {
  principal: { label: "loan amount", unit: "USDC" },
  collateralAmount: { label: "collateral amount", unit: "tokens" },
  interestPercent: { label: "interest rate", unit: "%" },
  durationDays: { label: "duration", unit: "days" },
  gracePeriodDays: { label: "grace period", unit: "days" },
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const num = (draft: DraftBundle, key: SlotKey) => {
  const v = draft.slots[key]?.value;
  return typeof v === "number" ? v : undefined;
};

export type DraftIssue = { slot: SlotKey; message: string };

/** Inconsistent values: a minimum above the maximum, or a target outside the range. */
export function validateDraft(draft: DraftBundle): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const field of BUNDLE_FIELDS) {
    const min = num(draft, fieldSlot(field, "min"));
    const max = num(draft, fieldSlot(field, "max"));
    const target = num(draft, fieldSlot(field, "target"));
    const { label } = FIELD_LABELS[field];
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({
        slot: fieldSlot(field, "min"),
        message: `The minimum ${label} (${fmt(min)}) is above the maximum (${fmt(max)}).`,
      });
    } else if (target !== undefined && ((min !== undefined && target < min) || (max !== undefined && target > max))) {
      issues.push({
        slot: fieldSlot(field, "target"),
        message: `The target ${label} (${fmt(target)}) is outside your range.`,
      });
    }
  }
  return issues;
}

function verb(side: PlainSide | undefined) {
  return side === "lender" ? "lend" : "borrow";
}

function ask(field: PlainFieldName, draft: DraftBundle, side: PlainSide | undefined): Turn | null {
  const { label, unit } = FIELD_LABELS[field];
  const min = fieldSlot(field, "min");
  const max = fieldSlot(field, "max");
  const target = fieldSlot(field, "target");
  const vMin = num(draft, min);
  const vMax = num(draft, max);
  const vTarget = num(draft, target);
  if (vMin !== undefined && vMax !== undefined) return null;

  const subject = field === "principal" ? `How much do you want to ${verb(side)}` : `What ${label} do you want`;
  if (vMin === undefined && vMax === undefined && vTarget === undefined) {
    return { done: false, slot: target, question: `${subject}? (${unit})`, quickReplies: [] };
  }
  if (vMin === undefined && vMax === undefined && vTarget !== undefined) {
    return {
      done: false,
      slot: min,
      question: `You said about ${fmt(vTarget)} for the ${label}. Is that exact, or is there a lowest and highest you would accept?`,
      quickReplies: [
        {
          label: `Exactly ${fmt(vTarget)}`,
          event: {
            type: "set_many",
            entries: [
              { slot: min, value: vTarget },
              { slot: max, value: vTarget },
            ],
          },
        },
      ],
    };
  }
  if (vMax !== undefined) {
    return {
      done: false,
      slot: min,
      question: `What is the lowest ${label} you would accept? (${unit})`,
      quickReplies: [{ label: `Same as the highest (${fmt(vMax)})`, event: { type: "set", slot: min, value: vMax } }],
    };
  }
  return {
    done: false,
    slot: max,
    question: `What is the highest ${label} you would accept? (${unit})`,
    quickReplies: [
      {
        label: `Same as the lowest (${fmt(vMin as number)})`,
        event: { type: "set", slot: max, value: vMin as number },
      },
    ],
  };
}

/** One line per slot, saying where each value came from, for the review recap. */
export function describeDraft(draft: DraftBundle): string[] {
  const intent = draftIntent(draft);
  const lines: string[] = [];
  if (intent === "atp_deposit" || intent === "atp_withdraw") {
    const amount = draft.slots.amount;
    lines.push(
      `${intent === "atp_deposit" ? "Deposit into" : "Withdraw from"} ATP: ${fmt(Number(amount?.value))} USDC (${amount?.source})`,
    );
    return lines;
  }
  lines.push(`Side: ${draft.slots.side?.value} (${draft.slots.side?.source})`);
  for (const field of BUNDLE_FIELDS) {
    const min = draft.slots[fieldSlot(field, "min")];
    const max = draft.slots[fieldSlot(field, "max")];
    const target = draft.slots[fieldSlot(field, "target")];
    if (!min || !max || !target) continue;
    const { label, unit } = FIELD_LABELS[field];
    const sources = new Set([min.source, max.source, target.source]);
    lines.push(
      `${label}: ${fmt(Number(min.value))} to ${fmt(Number(max.value))} ${unit}, target ${fmt(Number(target.value))} (${[...sources].join(", ")})`,
    );
  }
  return lines;
}

/**
 * Decide the next question and the quick replies that answer it. Never guesses: a missing or contradictory value
 * becomes a question. Returns `done` only when every asked term is fully set and consistent.
 */
export function nextTurn(draft: DraftBundle): Turn {
  const issue = validateDraft(draft)[0];
  if (issue) {
    return {
      done: false,
      slot: issue.slot,
      question: `${issue.message} Which one should change?`,
      quickReplies: [{ label: "Clear it and re-enter", event: { type: "clear", slot: issue.slot } }],
    };
  }

  const unknown = draft.unresolved.findIndex((c) => c.reason === "unknown_field");
  if (unknown >= 0) {
    const c = draft.unresolved[unknown];
    const bound = c.bound ?? "target";
    return {
      done: false,
      slot: null,
      question: `I read "${c.span.text}" as a number but could not tell which term it belongs to. Which is it?`,
      quickReplies: BUNDLE_FIELDS.map((field) => ({
        label: FIELD_LABELS[field].label,
        event: { type: "assign_unresolved" as const, index: unknown, slot: fieldSlot(field, bound) },
      })),
    };
  }

  const intent = draftIntent(draft);
  if (intent === null) {
    return {
      done: false,
      slot: "side",
      question: "What would you like to do?",
      quickReplies: [
        { label: "Borrow", event: { type: "set", slot: "side", value: "borrower" } },
        { label: "Lend", event: { type: "set", slot: "side", value: "lender" } },
        { label: "Deposit into ATP", event: { type: "set", slot: "intent", value: "atp_deposit" } },
        { label: "Withdraw from ATP", event: { type: "set", slot: "intent", value: "atp_withdraw" } },
      ],
    };
  }

  if (intent === "atp_deposit" || intent === "atp_withdraw") {
    if (num(draft, "amount") === undefined) {
      return {
        done: false,
        slot: "amount",
        question: `How much do you want to ${intent === "atp_deposit" ? "deposit" : "withdraw"}? (USDC)`,
        quickReplies: [],
      };
    }
    return { done: true, summary: describeDraft(draft) };
  }

  const side = draft.slots.side?.value as PlainSide | undefined;
  for (const field of ASKED_FIELDS) {
    const turn = ask(field, draft, side);
    if (turn) return turn;
  }
  return { done: true, summary: describeDraft(draft) };
}

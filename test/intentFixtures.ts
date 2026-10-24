import type { ParseContext, SlotKey } from "../src/intent";

/** Expected parse of one phrasing: slot -> value for resolved candidates, plus unresolved reasons. */
export type Fixture = {
  text: string;
  context?: ParseContext;
  expect: Partial<Record<SlotKey, number | string>>;
  unresolved?: string[];
  note?: string;
};

export const FIXTURES: Fixture[] = [
  { text: "I want to borrow", expect: { side: "borrower" } },
  { text: "looking to lend some cUSDC", expect: { side: "lender" } },
  { text: "borrow 100k USDC", expect: { side: "borrower", "principal.target": 100_000 } },
  { text: "about $80,000", expect: { "principal.target": 80_000 } },
  { text: "at most 120k usdc", expect: { "principal.max": 120_000 } },
  { text: "at least 50k usdc", expect: { "principal.min": 50_000 } },
  { text: "between 80k and 120k USDC", expect: { "principal.min": 80_000, "principal.max": 120_000 } },
  { text: "80,000 to 120,000 usdc", expect: { "principal.min": 80_000, "principal.max": 120_000 } },
  { text: "1.5m usdc", expect: { "principal.target": 1_500_000 } },
  { text: "under 8%", expect: { "interestPercent.max": 8 } },
  { text: "around 7 percent", expect: { "interestPercent.target": 7 } },
  { text: "5% to 8%", expect: { "interestPercent.min": 5, "interestPercent.max": 8 } },
  { text: "about 90 days", expect: { "durationDays.target": 90 } },
  { text: "up to 6 months", expect: { "durationDays.max": 180 } },
  { text: "2 to 3 years", expect: { "durationDays.min": 730, "durationDays.max": 1095 } },
  { text: "a 4 week loan", expect: { "durationDays.target": 28 } },
  { text: "grace period of 14 days", expect: { "gracePeriodDays.target": 14 } },
  { text: "100,000 tokens as collateral", expect: { "collateralAmount.target": 100_000 } },
  { text: "no more than 150k tokens", expect: { "collateralAmount.max": 150_000 } },
  {
    text: "borrow about 100k usdc at under 8% for up to 6 months",
    expect: { side: "borrower", "principal.target": 100_000, "interestPercent.max": 8, "durationDays.max": 180 },
  },
  { text: "deposit 5,000 usdc", expect: { intent: "atp_deposit", amount: 5_000 } },
  { text: "withdraw 250 usdc", expect: { intent: "atp_withdraw", amount: 250 } },
  // Bare numbers are read only as the answer to the question that was just asked.
  { text: "90", context: { expecting: "durationDays.max" }, expect: { "durationDays.max": 90 } },
  { text: "7.5", context: { expecting: "interestPercent.target" }, expect: { "interestPercent.target": 7.5 } },
  { text: "2500", context: { expecting: "amount", intent: "atp_deposit" }, expect: { amount: 2_500 } },
  // Deliberately ambiguous: the parser must refuse and say why.
  { text: "100k", expect: {}, unresolved: ["unknown_field"], note: "no unit, no question pending" },
  { text: "I want to borrow and lend", expect: {}, unresolved: ["ambiguous_side", "ambiguous_side"] },
  { text: "deposit or withdraw", expect: {}, unresolved: ["ambiguous_intent", "ambiguous_intent"] },
  { text: "7% or maybe 9%", expect: {}, unresolved: ["conflict", "conflict"], note: "two targets for one slot" },
  { text: "hello there", expect: {} },
];

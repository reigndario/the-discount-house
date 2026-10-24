import { expect } from "chai";
import {
  applyMessage,
  emptyDraft,
  extract,
  nextTurn,
  reduce,
  toAtpIntent,
  toPlainBundle,
  validateDraft,
  verifyAll,
  verifySpan,
  type DraftBundle,
  type SlotCandidate,
  type Turn,
} from "../src/intent";
import { canonicalBundleHash } from "../src/protocolSdk";
import { FIXTURES } from "./intentFixtures";

const EXTRAS = {
  collateralToken: "0x258F9D60dc023870e4E3109c894D834D5377361a",
  tokenOpsManager: "0xb32208BF362b48672cAf58C52Ee45908e3cc6333",
  backingId: "0x" + "ab".repeat(32),
};

function question(turn: Turn) {
  if (turn.done) throw new Error("expected a question");
  return turn;
}

describe("intent core", () => {
  describe("parser fixtures", () => {
    for (const fx of FIXTURES) {
      it(`reads: ${fx.text}${fx.note ? ` (${fx.note})` : ""}`, () => {
        const candidates = extract(fx.text, fx.context);
        const resolved: Record<string, number | string> = {};
        for (const c of candidates) if (c.slot) resolved[c.slot] = c.value;
        expect(resolved).to.deep.equal(fx.expect);
        expect(candidates.filter((c) => !c.slot).map((c) => c.reason)).to.deep.equal(fx.unresolved ?? []);
      });

      it(`cites real text for: ${fx.text}`, () => {
        const { rejected } = verifyAll(fx.text, extract(fx.text, fx.context));
        expect(rejected).to.deep.equal([]);
      });
    }
  });

  describe("span verifier", () => {
    const text = "borrow about 100k usdc";
    const good = extract(text).find((c) => c.slot === "principal.target") as SlotCandidate;

    it("accepts what the parser produced", () => {
      expect(verifySpan(text, good).ok).to.equal(true);
    });

    it("rejects a value that is not in the text", () => {
      expect(verifySpan(text, { ...good, value: 200_000 }).ok).to.equal(false);
    });

    it("rejects a span that does not match the text at its offsets", () => {
      expect(verifySpan("borrow about 90k usdc", good).ok).to.equal(false);
    });

    it("rejects a span outside the text", () => {
      expect(verifySpan(text, { ...good, span: { start: 0, end: 999, text } }).ok).to.equal(false);
    });

    it("rejects a unit conversion with no unit word", () => {
      const t = "about 6";
      const c: SlotCandidate = {
        slot: "durationDays.target",
        value: 180,
        unitFactor: 30,
        span: { start: 6, end: 7, text: "6" },
      };
      expect(verifySpan(t, c).ok).to.equal(false);
    });

    it("rejects a side that is not a side keyword", () => {
      const c: SlotCandidate = {
        slot: "side",
        value: "lender",
        unitFactor: 1,
        span: { start: 0, end: 6, text: "borrow" },
      };
      expect(verifySpan(text, c).ok).to.equal(false);
    });

    it("drops invented candidates in applyMessage", () => {
      const forged = { ...good, value: 999 };
      const { accepted } = verifyAll(text, [forged]);
      expect(accepted).to.deep.equal([]);
    });
  });

  describe("reducer", () => {
    it("does not mutate its input", () => {
      const draft = emptyDraft();
      const frozen = JSON.stringify(draft);
      reduce(draft, { type: "set", slot: "side", value: "borrower" });
      expect(JSON.stringify(draft)).to.equal(frozen);
    });

    it("marks parsed values stated with a span, and unit conversions derived", () => {
      const draft = applyMessage(emptyDraft(), "borrow up to 6 months");
      expect(draft.slots["durationDays.max"]).to.deep.include({ value: 180, source: "derived" });
      expect(draft.slots["durationDays.max"]?.span?.text).to.equal("6 months");
      expect(draft.slots.side).to.deep.include({ value: "borrower", source: "stated" });
    });

    it("derives a target from min and max, and drops it when one bound goes", () => {
      let draft = applyMessage(emptyDraft(), "between 80k and 120k usdc");
      expect(draft.slots["principal.target"]).to.deep.include({ value: 100_000, source: "derived" });
      draft = reduce(draft, { type: "clear", slot: "principal.max" });
      expect(draft.slots["principal.target"]).to.equal(undefined);
    });

    it("never overwrites a stated target with a derived one", () => {
      const draft = applyMessage(emptyDraft(), "about 90k usdc, between 80k and 120k usdc");
      expect(draft.slots["principal.target"]?.source).to.equal("stated");
    });

    it("applies the grace default once the side is known, and lets a stated grace win", () => {
      let draft = reduce(emptyDraft(), { type: "set", slot: "side", value: "borrower" });
      expect(draft.slots["gracePeriodDays.target"]).to.deep.include({ value: 7, source: "default" });
      draft = applyMessage(draft, "grace period of 14 days");
      expect(draft.slots["gracePeriodDays.target"]).to.deep.include({ value: 14, source: "stated" });
    });

    it("ignores invalid values", () => {
      const draft = emptyDraft();
      expect(reduce(draft, { type: "set", slot: "side", value: "banker" })).to.equal(draft);
      expect(reduce(draft, { type: "set", slot: "amount", value: -5 })).to.equal(draft);
    });

    it("keeps unresolved candidates until the next message replaces them", () => {
      let draft = applyMessage(emptyDraft(), "100k");
      expect(draft.unresolved).to.have.length(1);
      draft = applyMessage(draft, "thanks");
      expect(draft.unresolved).to.have.length(0);
    });
  });

  describe("dialogue policy", () => {
    it("asks what to do first, with quick replies for every path", () => {
      const turn = question(nextTurn(emptyDraft()));
      expect(turn.quickReplies.map((r) => r.label)).to.deep.equal([
        "Borrow",
        "Lend",
        "Deposit into ATP",
        "Withdraw from ATP",
      ]);
    });

    it("asks which term an unplaced number belongs to, and applies the pick", () => {
      let draft = applyMessage(emptyDraft(), "borrow 100k");
      const turn = question(nextTurn(draft));
      expect(turn.question).to.contain("100k");
      const pick = turn.quickReplies.find((r) => r.label === "loan amount");
      draft = reduce(draft, pick!.event);
      expect(draft.slots["principal.target"]).to.deep.include({ value: 100_000, source: "picked" });
    });

    it("offers Exactly X when only a target is known", () => {
      let draft = applyMessage(emptyDraft(), "borrow about 100k usdc");
      const turn = question(nextTurn(draft));
      expect(turn.slot).to.equal("principal.min");
      draft = reduce(draft, turn.quickReplies[0].event);
      expect(draft.slots["principal.min"]?.value).to.equal(100_000);
      expect(draft.slots["principal.max"]?.value).to.equal(100_000);
    });

    it("asks for the missing bound, not both", () => {
      const draft = applyMessage(emptyDraft(), "borrow at most 120k usdc");
      expect(question(nextTurn(draft)).slot).to.equal("principal.min");
    });

    it("flags an inverted range instead of proceeding", () => {
      const draft = applyMessage(emptyDraft(), "borrow at least 200k usdc and at most 100k usdc");
      expect(validateDraft(draft)).to.have.length.greaterThan(0);
      expect(question(nextTurn(draft)).question).to.contain("above the maximum");
    });

    it("asks the one-amount question for ATP, then finishes", () => {
      let draft = applyMessage(emptyDraft(), "I want to deposit");
      expect(question(nextTurn(draft)).slot).to.equal("amount");
      draft = applyMessage(draft, "2500", { expecting: "amount", intent: "atp_deposit" });
      expect(nextTurn(draft).done).to.equal(true);
      expect(toAtpIntent(draft)).to.deep.equal({ kind: "atp_deposit", amount: 2500 });
    });

    it("never calls a draft done while a term is missing", () => {
      const draft = applyMessage(emptyDraft(), "borrow about 100k usdc");
      expect(nextTurn(draft).done).to.equal(false);
      expect(() => toPlainBundle(draft, EXTRAS)).to.throw("incomplete");
    });
  });

  describe("full conversation", () => {
    it("drafts a borrower bundle that hashes through the SDK", () => {
      let draft: DraftBundle = emptyDraft();
      const say = (text: string) => {
        const turn = nextTurn(draft);
        draft = applyMessage(draft, text, { expecting: turn.done ? undefined : (turn.slot ?? undefined) });
      };
      say("I want to borrow between 80k and 120k usdc");
      say("between 100k and 175k tokens");
      say("5% to 8%");
      say("about 90 days");
      expect(nextTurn(draft).done).to.equal(false);
      draft = reduce(draft, question(nextTurn(draft)).quickReplies[0].event);
      expect(nextTurn(draft).done).to.equal(true);

      const bundle = toPlainBundle(draft, EXTRAS);
      expect(bundle.side).to.equal("borrower");
      expect(bundle.principal.range).to.deep.equal({ min: 80_000, max: 120_000, target: 100_000 });
      expect(bundle.gracePeriodDays.range).to.deep.equal({ min: 0, max: 15, target: 7 });
      expect(canonicalBundleHash(bundle)).to.match(/^0x[0-9a-f]{64}$/);
    });
  });
});

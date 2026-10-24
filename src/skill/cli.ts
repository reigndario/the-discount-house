import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  applyMessage,
  describeDraft,
  draftIntent,
  emptyDraft,
  extract,
  nextTurn,
  reduce,
  toAtpIntent,
  toTerms,
  verifyAll,
  type DraftBundle,
  type SlotKey,
  type Turn,
} from "../intent";
import { canonicalBundleHash, type PlainBundle } from "../protocolSdk";

/**
 * Command line wrapper around the intent core and the SDK, driven by an agent skill. It keeps the draft in a local
 * JSON file, reads nothing but its arguments and that file, and has no network code. It never sees a key and never
 * signs, encrypts or submits: the most it produces is a bundle JSON for the review page.
 */

export const BUNDLE_FORMAT = "cvc-bundle/1";
export const ATP_FORMAT = "cvc-atp-intent/1";

type State = { version: 1; draft: DraftBundle; expecting?: SlotKey };

export type CliResult = { code: 0 | 1 | 2; output: Record<string, unknown> };

const USAGE = `tdh-bundle: draft a Discount House bundle one question at a time.

  init   --draft FILE                       start a new draft
  say    --draft FILE --text "..."          apply the user's exact words, then print the next question
  reply  --draft FILE --index N             apply quick reply N (0-based) from the last question
  status --draft FILE                       print the next question or the recap
  emit   --draft FILE --out FILE            write the bundle JSON once the draft is complete
         [--collateral-token 0x.. --manager 0x.. --backing-id 0x..  [--expiry-days N]]

Exit codes: 0 ok, 1 usage or input error, 2 the draft is not complete yet.`;

function parseArgs(argv: string[]): { command?: string; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument "${arg}"`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    flags[arg.slice(2)] = value;
    i++;
  }
  return { command, flags };
}

function need(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function load(path: string): State {
  if (!existsSync(path)) throw new Error(`no draft at ${path}; run init first`);
  const state = JSON.parse(readFileSync(path, "utf8")) as State;
  if (state.version !== 1 || typeof state.draft?.slots !== "object" || !Array.isArray(state.draft.unresolved)) {
    throw new Error(`${path} is not a draft file`);
  }
  return state;
}

function save(path: string, state: State) {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

function turnView(turn: Turn) {
  if (turn.done) return { done: true, recap: turn.summary };
  return {
    done: false,
    slot: turn.slot,
    question: turn.question,
    quickReplies: turn.quickReplies.map((r, index) => ({ index, label: r.label })),
  };
}

function provenance(draft: DraftBundle) {
  return Object.fromEntries(
    Object.entries(draft.slots).map(([slot, v]) => [
      slot,
      { source: v!.source, ...(v!.span ? { span: v!.span.text } : {}) },
    ]),
  );
}

export function run(argv: string[]): CliResult {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    return { code: 1, output: { error: (err as Error).message, usage: USAGE } };
  }
  const { command, flags } = parsed;
  try {
    switch (command) {
      case "init": {
        const state: State = { version: 1, draft: emptyDraft() };
        const turn = nextTurn(state.draft);
        state.expecting = turn.done ? undefined : (turn.slot ?? undefined);
        save(need(flags, "draft"), state);
        return { code: 0, output: { turn: turnView(turn) } };
      }
      case "say": {
        const path = need(flags, "draft");
        const text = need(flags, "text");
        const state = load(path);
        const context = {
          expecting: state.expecting,
          side: state.draft.slots.side?.value as "borrower" | "lender" | undefined,
          intent: state.draft.slots.intent?.value as "atp_deposit" | "atp_withdraw" | undefined,
        };
        const { rejected } = verifyAll(text, extract(text, context));
        state.draft = applyMessage(state.draft, text, context);
        const turn = nextTurn(state.draft);
        state.expecting = turn.done ? undefined : (turn.slot ?? undefined);
        save(path, state);
        return {
          code: 0,
          output: {
            rejected: rejected.map((r) => ({ text: r.candidate.span.text, reason: r.reason })),
            understood: Object.keys(state.draft.slots).length,
            turn: turnView(turn),
          },
        };
      }
      case "reply": {
        const path = need(flags, "draft");
        const index = Number(need(flags, "index"));
        const state = load(path);
        const turn = nextTurn(state.draft);
        const reply = turn.done ? undefined : turn.quickReplies[index];
        if (!Number.isInteger(index) || !reply)
          throw new Error(`no quick reply ${flags.index} for the current question`);
        state.draft = reduce(state.draft, reply.event);
        const next = nextTurn(state.draft);
        state.expecting = next.done ? undefined : (next.slot ?? undefined);
        save(path, state);
        return { code: 0, output: { applied: reply.label, turn: turnView(next) } };
      }
      case "status": {
        const state = load(need(flags, "draft"));
        return { code: 0, output: { turn: turnView(nextTurn(state.draft)) } };
      }
      case "emit": {
        const state = load(need(flags, "draft"));
        const out = need(flags, "out");
        const turn = nextTurn(state.draft);
        if (!turn.done) return { code: 2, output: { error: "the draft is not complete", turn: turnView(turn) } };
        const kind = draftIntent(state.draft);
        if (kind === "atp_deposit" || kind === "atp_withdraw") {
          const intent = toAtpIntent(state.draft);
          const file = {
            format: ATP_FORMAT,
            intent,
            recap: describeDraft(state.draft),
            provenance: provenance(state.draft),
          };
          writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
          return { code: 0, output: { wrote: out, format: ATP_FORMAT, recap: file.recap } };
        }
        const expiry = flags["expiry-days"] ? Number(flags["expiry-days"]) : undefined;
        const terms = toTerms(state.draft, expiry);
        const given = ["collateral-token", "manager", "backing-id"].filter((f) => flags[f]);
        if (given.length !== 0 && given.length !== 3) {
          throw new Error("give all of --collateral-token, --manager and --backing-id, or none of them");
        }
        const wallet =
          given.length === 3
            ? {
                collateralToken: flags["collateral-token"],
                tokenOpsManager: flags.manager,
                backingId: flags["backing-id"],
              }
            : null;
        const hash = wallet ? canonicalBundleHash({ ...terms, ...wallet } as PlainBundle) : null;
        const file = {
          format: BUNDLE_FORMAT,
          terms,
          wallet,
          hash,
          recap: describeDraft(state.draft),
          provenance: provenance(state.draft),
        };
        writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
        return {
          code: 0,
          output: {
            wrote: out,
            format: BUNDLE_FORMAT,
            hash,
            note: wallet
              ? "Hash covers the wallet fields given. The review page recomputes it before anything is signed."
              : "No wallet fields given, so there is no hash yet. The review page adds them from the connected wallet and computes it.",
            recap: file.recap,
          },
        };
      }
      default:
        return {
          code: command ? 1 : 0,
          output: command ? { error: `unknown command "${command}"`, usage: USAGE } : { usage: USAGE },
        };
    }
  } catch (err) {
    return { code: 1, output: { error: (err as Error).message } };
  }
}

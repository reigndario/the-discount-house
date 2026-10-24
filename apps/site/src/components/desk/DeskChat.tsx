"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  applyMessage,
  diagramRows,
  draftIntent,
  emptyDraft,
  nextTurn,
  reduce,
  type DraftBundle,
  type QuickReply,
  type SlotKey,
  type Turn,
} from "confidential-vesting-credit/intent";

import { DraftDiagram } from "@/components/desk/DraftDiagram";
import { Glyph, type GlyphName } from "@/components/Glyph";

type Entry = { id: number; role: "desk" | "you"; text: string; done?: boolean; replies?: QuickReply[] };

type State = { draft: DraftBundle; entries: Entry[]; expecting?: SlotKey; nextId: number };

const NOT_UNDERSTOOD = "I did not catch a value in that.";

function deskEntry(id: number, turn: Turn, prefix?: string): Entry {
  if (turn.done) {
    return {
      id,
      role: "desk",
      text: [prefix, "Draft complete. Nothing has been sent."].filter(Boolean).join(" "),
      done: true,
    };
  }
  return { id, role: "desk", text: [prefix, turn.question].filter(Boolean).join(" "), replies: turn.quickReplies };
}

function expectingOf(turn: Turn): SlotKey | undefined {
  return turn.done ? undefined : (turn.slot ?? undefined);
}

function start(side: string | null): State {
  let draft = emptyDraft();
  if (side === "borrower" || side === "lender") {
    draft = reduce(draft, { type: "set", slot: "side", value: side, source: "picked" });
  }
  const turn = nextTurn(draft);
  return { draft, entries: [deskEntry(1, turn)], expecting: expectingOf(turn), nextId: 2 };
}

function glyphFor(reply: QuickReply): GlyphName | null {
  const e = reply.event;
  if (e.type !== "set") return null;
  if (e.slot === "side") return e.value === "borrower" ? "borrow" : "lend";
  if (e.slot === "intent") return "atp";
  return null;
}

// Each chip takes its section's Bauhaus color on hover, so the marks keep the homepage's identity.
const CHIP_HOVER: Record<GlyphName, string> = {
  borrow: "hover:bg-tdh-red hover:text-tdh-cream hover:border-tdh-red",
  lend: "hover:bg-tdh-blue hover:text-tdh-cream hover:border-tdh-blue",
  atp: "hover:bg-tdh-yellow hover:text-tdh-black hover:border-tdh-yellow",
  docs: "hover:bg-foreground hover:text-background",
};

function Chip({ children, glyph, ...rest }: React.ComponentProps<"button"> & { glyph?: GlyphName | null }) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex items-center gap-2 rounded-none border-2 border-foreground px-3 py-2 text-sm font-medium uppercase tracking-[0.15em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${CHIP_HOVER[glyph ?? "docs"]}`}
    >
      {glyph ? <Glyph name={glyph} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function DeskChat() {
  const side = useSearchParams().get("side");
  // Transcript and draft live in React state only: nothing is written to localStorage or anywhere else.
  const [state, setState] = useState<State>(() => start(side));
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not on first render, so the page keeps its heading in view.
    if (state.entries.length > 1) endRef.current?.scrollIntoView({ block: "end" });
  }, [state.entries.length]);

  const last = state.entries[state.entries.length - 1];
  const fresh = draftIntent(state.draft) === null;

  function say(raw: string) {
    const message = raw.trim();
    if (!message) return;
    setState((s) => {
      const side = s.draft.slots.side?.value;
      const intent = s.draft.slots.intent?.value;
      const next = applyMessage(s.draft, message, {
        expecting: s.expecting,
        side: side === "borrower" || side === "lender" ? side : undefined,
        intent: intent === "atp_deposit" || intent === "atp_withdraw" ? intent : undefined,
      });
      const changed = JSON.stringify(next) !== JSON.stringify(s.draft);
      const turn = nextTurn(next);
      return {
        draft: next,
        expecting: expectingOf(turn),
        nextId: s.nextId + 2,
        entries: [
          ...s.entries.map((e) => ({ ...e, replies: undefined })),
          { id: s.nextId, role: "you", text: message },
          deskEntry(s.nextId + 1, turn, changed ? undefined : NOT_UNDERSTOOD),
        ],
      };
    });
    setText("");
  }

  function pick(reply: QuickReply) {
    setState((s) => {
      const next = reduce(s.draft, reply.event);
      const turn = nextTurn(next);
      return {
        draft: next,
        expecting: expectingOf(turn),
        nextId: s.nextId + 2,
        entries: [
          ...s.entries.map((e) => ({ ...e, replies: undefined })),
          { id: s.nextId, role: "you", text: reply.label },
          deskEntry(s.nextId + 1, turn),
        ],
      };
    });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Conversation" className="min-w-0">
        <ol aria-live="polite" className="border-b border-foreground/30">
          {state.entries.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[3.5rem_1fr] gap-4 border-t border-foreground/30 py-4 sm:grid-cols-[4.5rem_1fr]"
            >
              <span className="pt-0.5 text-xs font-light uppercase tracking-[0.2em]">
                {entry.role === "desk" ? "Desk" : "You"}
              </span>
              <div>
                <p className={entry.role === "you" ? "font-medium" : "font-light"}>{entry.text}</p>
                {entry.done ? (
                  <p className="mt-2 text-sm font-light">
                    Keep editing, or{" "}
                    <button
                      type="button"
                      onClick={() => setState(start(null))}
                      className="underline underline-offset-4"
                    >
                      start over
                    </button>
                    .
                  </p>
                ) : null}
                {entry.replies?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {entry.replies.map((reply, i) => (
                      <Chip key={i} glyph={glyphFor(reply)} onClick={() => pick(reply)}>
                        {reply.label}
                      </Chip>
                    ))}
                    {entry === last && fresh ? (
                      <Link
                        href="/docs"
                        className={`flex items-center gap-2 border-2 border-foreground px-3 py-2 text-sm font-medium uppercase tracking-[0.15em] ${CHIP_HOVER.docs}`}
                      >
                        <Glyph name="docs" className="h-4 w-4" />
                        Docs
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div ref={endRef} />

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            say(text);
          }}
        >
          <label htmlFor="desk-input" className="sr-only">
            Your message
          </label>
          <input
            id="desk-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            placeholder="Type your answer"
            className="min-w-0 flex-1 rounded-none border-2 border-foreground bg-transparent px-3 py-3 font-light placeholder:text-foreground/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          />
          <button
            type="submit"
            className="rounded-none border-2 border-foreground bg-foreground px-5 py-3 text-sm font-medium uppercase tracking-[0.15em] text-background hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Send
          </button>
        </form>
        <p className="mt-3 text-xs font-light text-foreground/60">Drafted in your browser. Nothing is sent.</p>
      </section>

      <aside className="min-w-0">
        <DraftDiagram rows={diagramRows(state.draft)} />
      </aside>
    </div>
  );
}

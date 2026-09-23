"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { Glyph, type GlyphName } from "@/components/Glyph";

type Disclosure = {
  caption: string;
  publicItems: string;
  encryptedItems: string;
  /** Value counts, shown only where they are real (a Preference Bundle's on-chain shape). */
  counts?: { public: number; encrypted: number };
};

// A Preference Bundle publishes side, collateral token, TokenOps manager, principal bucket,
// duration bucket, expiry and backing ID (7 values). Its 6 term fields each carry an encrypted
// min, max, target, direction and priority (30 handles).
const BUNDLE = {
  publicItems: "Side, collateral token, manager, principal bucket, duration bucket, expiry, backing ID",
  encryptedItems: "Exact amounts, rate, duration, grace period, targets, direction, priority",
  counts: { public: 7, encrypted: 30 },
};

const DISCLOSURES: Record<"default" | GlyphName, Disclosure> = {
  default: { caption: "What a Preference Bundle makes public", ...BUNDLE },
  borrow: { caption: "What is public when you borrow", ...BUNDLE },
  lend: { caption: "What is public when you lend", ...BUNDLE },
  atp: {
    caption: "What is public when you invest in the ATP",
    publicItems: "Fund NAV, published once per epoch",
    encryptedItems: "Your deposit, your share, the fund's positions",
  },
  docs: { caption: "What a Preference Bundle makes public", ...BUNDLE },
};

const ENTRIES: { glyph: GlyphName; label: string; href: string; preview: boolean }[] = [
  { glyph: "borrow", label: "Borrow", href: "/desk?side=borrower", preview: true },
  { glyph: "lend", label: "Lend", href: "/desk?side=lender", preview: true },
  { glyph: "atp", label: "ATP", href: "/atp", preview: true },
  // Docs has no disclosure of its own, so on touch it opens straight away.
  { glyph: "docs", label: "Docs", href: "/docs", preview: false },
];

const TOUCH_QUERY = "(hover: none)";

function subscribeTouch(onChange: () => void) {
  const query = window.matchMedia(TOUCH_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on devices without hover (phones, tablets), where a tap has to stand in for it. */
function useIsTouch() {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH_QUERY).matches,
    () => false,
  );
}

export function HomeIndex() {
  const isTouch = useIsTouch();
  // Hover/focus preview (desktop) and tap selection (touch) are tracked separately so a stray
  // emulated mouse event on touch can't clear the glyph the user deliberately selected.
  const [hovered, setHovered] = useState<GlyphName | null>(null);
  const [selected, setSelected] = useState<GlyphName | null>(null);
  const active = hovered ?? selected;
  const disclosure = DISCLOSURES[active ?? "default"];
  const selectedEntry = ENTRIES.find((entry) => entry.glyph === selected);
  // ATP has no on-chain shape yet, so its public side is drawn as a sliver, not a ratio.
  const publicShare = disclosure.counts
    ? disclosure.counts.public / (disclosure.counts.public + disclosure.counts.encrypted)
    : 0.04;

  return (
    <div className="w-full max-w-md">
      <nav aria-label="Primary" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-y-14 sm:gap-x-16">
        {ENTRIES.map((entry) => (
          <Link
            key={entry.glyph}
            href={entry.href}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(entry.glyph)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(null)}
            onFocus={() => !isTouch && setHovered(entry.glyph)}
            onBlur={() => !isTouch && setHovered(null)}
            onClick={(e) => {
              // On touch, the first tap previews; a second tap on the same glyph enters.
              if (isTouch && entry.preview && selected !== entry.glyph) {
                e.preventDefault();
                setSelected(entry.glyph);
              }
            }}
            className="group flex flex-col items-center gap-3 sm:gap-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-foreground"
          >
            <Glyph name={entry.glyph} className="h-16 w-16 sm:h-24 sm:w-24" />
            <span
              className={`text-sm font-medium uppercase tracking-[0.2em] underline-offset-8 decoration-1 group-hover:underline group-focus-visible:underline ${
                selected === entry.glyph ? "underline" : ""
              }`}
            >
              {entry.label}
            </span>
          </Link>
        ))}
      </nav>

      <figure className="mt-12 sm:mt-20" aria-live="polite">
        <figcaption className="text-xs font-light uppercase tracking-[0.2em] mb-3">
          {disclosure.caption}
        </figcaption>
        <div className="flex h-3" aria-hidden="true">
          <div
            className="border border-foreground motion-safe:transition-[width] motion-safe:duration-300"
            style={{ width: `${publicShare * 100}%` }}
          />
          <div className="flex-1 bg-foreground" />
        </div>
        <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="font-medium uppercase tracking-[0.15em] text-xs pt-0.5">
            Public{disclosure.counts ? ` ${disclosure.counts.public}` : ""}
          </dt>
          <dd className="font-light">{disclosure.publicItems}</dd>
          <dt className="font-medium uppercase tracking-[0.15em] text-xs pt-0.5">
            Encrypted{disclosure.counts ? ` ${disclosure.counts.encrypted}` : ""}
          </dt>
          <dd className="font-light">{disclosure.encryptedItems}</dd>
        </dl>

        {isTouch ? (
          selectedEntry ? (
            <Link
              href={selectedEntry.href}
              className="mt-6 block border border-foreground px-4 py-3 text-center text-sm font-medium uppercase tracking-[0.2em] active:bg-foreground active:text-background"
            >
              Enter {selectedEntry.label}
            </Link>
          ) : (
            <p className="mt-6 text-xs font-light uppercase tracking-[0.2em]">
              Tap a mark to see what it makes public
            </p>
          )
        ) : null}
      </figure>
    </div>
  );
}

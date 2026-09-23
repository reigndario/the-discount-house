export type GlyphName = "borrow" | "lend" | "atp" | "docs";

/**
 * Geometric intent marks, drawn on a 100x100 grid in currentColor. Shared by the homepage
 * index and (later) the chat's quick-reply chips so both speak the same visual language.
 */
export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className} fill="currentColor">
      {name === "borrow" ? (
        // Collateral (circles) resting on credit (bars).
        <>
          <circle cx="30" cy="30" r="20" />
          <circle cx="70" cy="30" r="20" />
          <rect x="10" y="58" width="80" height="12" />
          <rect x="10" y="78" width="80" height="12" />
        </>
      ) : null}
      {name === "lend" ? (
        // Credit (bars) laid over collateral (circles).
        <>
          <rect x="10" y="10" width="80" height="12" />
          <rect x="10" y="30" width="80" height="12" />
          <circle cx="30" cy="70" r="20" />
          <circle cx="70" cy="70" r="20" />
        </>
      ) : null}
      {name === "atp" ? (
        <g stroke="currentColor" strokeWidth="11">
          <line x1="50" y1="8" x2="50" y2="92" />
          <line x1="8" y1="50" x2="92" y2="50" />
          <line x1="20.3" y1="20.3" x2="79.7" y2="79.7" />
          <line x1="79.7" y1="20.3" x2="20.3" y2="79.7" />
        </g>
      ) : null}
      {name === "docs" ? <rect x="10" y="44" width="80" height="12" /> : null}
    </svg>
  );
}

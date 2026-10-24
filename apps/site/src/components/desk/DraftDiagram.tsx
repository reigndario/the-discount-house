import type { DiagramRow } from "confidential-vesting-credit/intent";

import { Glyph } from "@/components/Glyph";

const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const compact = (n: number) => compactFormat.format(n).toLowerCase();
const full = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

const DIRECTION: Record<string, { mark: string; word: string }> = {
  lower_is_better: { mark: "↓", word: "lower is better" },
  higher_is_better: { mark: "↑", word: "higher is better" },
  target_is_best: { mark: "◎", word: "target is best" },
  neutral: { mark: "–", word: "neutral" },
};

/** Short, symbol-led value: "80k – 120k", "≥ 50k", "≤ 120k", or just the target. */
function value(row: DiagramRow): string {
  const { min, max, target } = row;
  if (min !== undefined && max !== undefined) return min === max ? compact(min) : `${compact(min)} – ${compact(max)}`;
  if (min !== undefined) return `≥ ${compact(min)}`;
  if (max !== undefined) return `≤ ${compact(max)}`;
  return target !== undefined ? compact(target) : "";
}

function spoken(row: DiagramRow): string {
  const parts = [
    row.min !== undefined ? `minimum ${full(row.min)}` : "",
    row.max !== undefined ? `maximum ${full(row.max)}` : "",
    row.target !== undefined ? `target ${full(row.target)}` : "",
  ].filter(Boolean);
  return `${row.label}, ${row.visibility}, ${parts.join(", ") || "not set"}${row.state === "default" ? ", default" : ""}`;
}

/** Filled square = encrypted, open square = public. Explained once in the legend. */
function Marker({ kind }: { kind: "public" | "encrypted" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 border-2 border-foreground ${kind === "encrypted" ? "bg-foreground" : ""}`}
    />
  );
}

function fillClass(row: DiagramRow) {
  if (row.problem) return "bg-tdh-red";
  return row.state === "default" ? "bg-tdh-yellow" : "bg-tdh-blue";
}

function Bar({ row }: { row: DiagramRow }) {
  const known = [row.min, row.max, row.target].filter((v): v is number => v !== undefined);
  const scale = known.length ? Math.max(...known) * 1.25 || 1 : 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const hasRange = row.min !== undefined || row.max !== undefined;
  // An inverted range (minimum above maximum) is drawn between the two values, in red, so the conflict is visible.
  const a = row.min ?? 0;
  const b = row.max ?? row.min ?? 0;
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return (
    <div
      aria-hidden="true"
      className={`relative mt-2 h-4 border-2 ${row.state === "empty" ? "border-dashed border-foreground/40" : "border-foreground"}`}
    >
      {hasRange ? (
        <div
          className={`absolute inset-y-0 ${fillClass(row)}`}
          style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)} + 2px)` }}
        />
      ) : null}
      {row.target !== undefined ? (
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: pct(row.target) }}
        />
      ) : null}
    </div>
  );
}

function SideRow({ row }: { row: DiagramRow }) {
  const side = row.text === "lender" ? "lend" : row.text === "borrower" ? "borrow" : null;
  return (
    <li
      className="flex items-center gap-3 border-t border-foreground/20 py-3"
      aria-label={`Side, public, ${row.text ?? "not set"}`}
    >
      <Marker kind="public" />
      <span className="text-sm font-medium">Side</span>
      <span className="ml-auto flex items-center gap-2 text-sm font-medium capitalize">
        {side ? <Glyph name={side} className="h-4 w-4" /> : null}
        {row.text ?? <span className="font-light text-foreground/50">–</span>}
      </span>
    </li>
  );
}

/**
 * The draft at a glance. Color carries the state: blue is what you stated, yellow is a default, red is a problem, a
 * dashed outline is empty. The circle on each bar is the target.
 */
export function DraftDiagram({ rows }: { rows: DiagramRow[] }) {
  return (
    <section aria-label="Your draft">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em]">Your draft</h2>
        <p className="flex items-center gap-3 text-[11px] font-light uppercase tracking-[0.15em]">
          <span className="flex items-center gap-1.5">
            <Marker kind="encrypted" /> Encrypted
          </span>
          <span className="flex items-center gap-1.5">
            <Marker kind="public" /> Public
          </span>
        </p>
      </div>
      <ul className="border-b border-foreground/20">
        {rows.map((row) => {
          if (row.key === "side") return <SideRow key={row.key} row={row} />;
          if (row.key === "amount") {
            return (
              <li
                key={row.key}
                className="flex items-center gap-3 border-t border-foreground/20 py-3"
                aria-label={spoken(row)}
              >
                <Marker kind="encrypted" />
                <span className="text-sm font-medium">{row.label}</span>
                <span className="ml-auto text-sm font-medium">
                  {row.text ? `${compact(Number(row.text))} ${row.unit}` : "–"}
                </span>
              </li>
            );
          }
          const dir = row.direction ? DIRECTION[row.direction] : undefined;
          return (
            <li key={row.key} className="border-t border-foreground/20 py-3" aria-label={spoken(row)}>
              <div className="flex items-center gap-3">
                <Marker kind="encrypted" />
                <span className={`text-sm font-medium ${row.problem ? "text-tdh-red" : ""}`}>{row.label}</span>
                {row.publicBucket ? (
                  <span title="Public bucket" className="flex items-center gap-1.5 text-[11px] font-light">
                    <Marker kind="public" />
                    {row.publicBucket.replace(/<0+/, "<")}
                  </span>
                ) : null}
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {value(row)}
                  {row.state !== "empty" ? <span className="ml-1 text-xs font-light">{row.unit}</span> : null}
                </span>
              </div>
              <Bar row={row} />
              {row.state !== "empty" && row.priority !== undefined && dir ? (
                <p
                  className="mt-2 flex items-center gap-2 text-xs font-light"
                  title={`${dir.word}, priority ${row.priority} of 5`}
                >
                  <span aria-hidden="true">{dir.mark}</span>
                  <span aria-hidden="true" className="inline-flex gap-[3px]">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={`h-2 w-2 border border-foreground ${n <= (row.priority ?? 0) ? "bg-foreground" : ""}`}
                      />
                    ))}
                  </span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

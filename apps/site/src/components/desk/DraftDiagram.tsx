import type { DiagramRow } from "confidential-vesting-credit/intent";

const DIRECTION_TEXT: Record<string, string> = {
  lower_is_better: "Lower is better",
  higher_is_better: "Higher is better",
  target_is_best: "Target is best",
  neutral: "Neutral",
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

function describe(row: DiagramRow): string {
  if (row.text !== undefined) return row.text;
  const parts: string[] = [];
  if (row.min !== undefined && row.max !== undefined) parts.push(`${fmt(row.min)} to ${fmt(row.max)} ${row.unit}`);
  else if (row.min !== undefined) parts.push(`at least ${fmt(row.min)} ${row.unit}`);
  else if (row.max !== undefined) parts.push(`at most ${fmt(row.max)} ${row.unit}`);
  if (row.target !== undefined) parts.push(`target ${fmt(row.target)}`);
  return parts.length ? parts.join(", ") : "Not set";
}

function Bar({ row }: { row: DiagramRow }) {
  const known = [row.min, row.max, row.target].filter((v): v is number => v !== undefined);
  const scale = known.length ? Math.max(...known) * 1.25 || 1 : 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const from = row.min ?? 0;
  const to = row.max ?? row.min ?? row.target;
  const filled = to !== undefined && row.state !== "empty" && !(row.min === undefined && row.max === undefined);
  return (
    <div
      role="img"
      aria-label={`${row.label}: ${describe(row)}`}
      className={`relative mt-2 h-3 border ${
        row.state === "empty" ? "border-dashed border-foreground/40" : "border-foreground/60"
      }`}
    >
      {filled ? (
        <div
          className={`absolute inset-y-0 ${row.state === "default" ? "bg-foreground/25" : "bg-foreground"}`}
          style={{ left: pct(from), width: `calc(${pct(to as number)} - ${pct(from)})` }}
        />
      ) : null}
      {row.target !== undefined ? (
        <div
          className="absolute -top-1 h-5 w-[3px] bg-background ring-1 ring-foreground"
          style={{ left: pct(row.target) }}
        />
      ) : null}
    </div>
  );
}

function Priority({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-[3px] align-middle" role="img" aria-label={`Priority ${value} of 5 (default)`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-2 w-2 border border-foreground ${n <= value ? "bg-foreground" : ""}`} />
      ))}
    </span>
  );
}

/** One row per field: range bar with a target tick, empty / stated / default state, and public or encrypted. */
export function DraftDiagram({ rows }: { rows: DiagramRow[] }) {
  return (
    <section aria-label="Your draft">
      <h2 className="text-xs font-medium uppercase tracking-[0.2em] mb-3">Your draft</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="border-t border-foreground/30 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="text-xs font-light uppercase tracking-[0.15em]">
                {row.visibility}
                {row.state === "default" ? " · default" : ""}
                {row.state === "empty" ? " · empty" : ""}
              </span>
            </div>
            {row.text === undefined && row.key !== "amount" ? <Bar row={row} /> : null}
            <p className={`mt-2 text-sm font-light ${row.state === "empty" ? "text-foreground/50" : ""}`}>
              {describe(row)}
            </p>
            {row.publicBucket ? (
              <p className="mt-1 text-xs font-light">Public bucket: {row.publicBucket}</p>
            ) : null}
            {row.priority !== undefined && row.direction ? (
              <p className="mt-1 text-xs font-light">
                <Priority value={row.priority} /> <span className="ml-2">{DIRECTION_TEXT[row.direction]} · default</span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Small uppercase label printed above a headline or panel title. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-tdh-black/50 mb-1">
      {children}
    </p>
  );
}

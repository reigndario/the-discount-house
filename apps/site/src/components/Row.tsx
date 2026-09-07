/** A calm single label/value line with a hairline divider above it. Replaces boxed stat pairs. */
export function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-t border-tdh-black/10 py-3 first:border-t-0 first:pt-0">
      <span className="text-sm text-tdh-black/60">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

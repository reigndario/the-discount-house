import { NAV_COLOR_CLASS, type NavColor } from "@/lib/nav";

/** Small uppercase label printed above a headline or panel title. */
export function Eyebrow({
  color,
  children,
}: {
  color?: NavColor;
  children: React.ReactNode;
}) {
  const colorClass = color ? NAV_COLOR_CLASS[color].text : "text-foreground/50";
  return (
    <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colorClass}`}>
      {children}
    </p>
  );
}

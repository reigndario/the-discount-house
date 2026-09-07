export type NavColor = "red" | "yellow" | "blue" | "black";

export type NavItem = {
  label: string;
  href: string;
  /** Bauhaus accent tied to this section's identity (active nav state, eyebrow labels). */
  color: NavColor;
};

/** The three product sections, shown under the sidebar's "APP" group. */
export const APP_NAV: NavItem[] = [
  { label: "Book", href: "/book", color: "red" },
  { label: "Desk", href: "/desk", color: "yellow" },
  { label: "Vault", href: "/vault", color: "blue" },
];

/** Reference/info links, shown under the sidebar's "INFO" group. */
export const INFO_NAV: NavItem[] = [{ label: "Docs", href: "/docs", color: "black" }];

export const ALL_NAV: NavItem[] = [...APP_NAV, ...INFO_NAV];

export const NAV_COLOR_CLASS: Record<
  NavColor,
  { border: string; text: string; bg: string; sidebarBorder: string }
> = {
  // `sidebarBorder` differs from `border` only for black: the sidebar itself is black, so a
  // black active-indicator would be invisible against it — cream stands in there instead.
  red: { border: "border-tdh-red", text: "text-tdh-red", bg: "bg-tdh-red", sidebarBorder: "border-tdh-red" },
  yellow: {
    border: "border-tdh-yellow",
    text: "text-tdh-yellow",
    bg: "bg-tdh-yellow",
    sidebarBorder: "border-tdh-yellow",
  },
  blue: { border: "border-tdh-blue", text: "text-tdh-blue", bg: "bg-tdh-blue", sidebarBorder: "border-tdh-blue" },
  black: {
    border: "border-foreground",
    text: "text-foreground",
    bg: "bg-foreground",
    sidebarBorder: "border-tdh-cream",
  },
};

export type NavColor = "red" | "yellow" | "blue" | "black";

export type NavItem = {
  label: string;
  href: string;
  /** Bauhaus accent tied to this section's identity (used on its Eyebrow label). */
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

// "black" tracks --foreground (not a literal color) so it stays legible against the
// theme-flipped content background in dark mode, rather than rendering invisible-dark text.
export const NAV_COLOR_CLASS: Record<NavColor, { text: string }> = {
  red: { text: "text-tdh-red" },
  yellow: { text: "text-tdh-yellow" },
  blue: { text: "text-tdh-blue" },
  black: { text: "text-foreground" },
};

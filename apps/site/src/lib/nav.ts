export type NavItem = {
  label: string;
  href: string;
};

/** The three product sections, shown under the sidebar's "APP" group. */
export const APP_NAV: NavItem[] = [
  { label: "Book", href: "/book" },
  { label: "Desk", href: "/desk" },
  { label: "Vault", href: "/vault" },
];

/** Reference/info links, shown under the sidebar's "INFO" group. */
export const INFO_NAV: NavItem[] = [{ label: "Docs", href: "/docs" }];

export const ALL_NAV: NavItem[] = [...APP_NAV, ...INFO_NAV];

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { APP_NAV, INFO_NAV, type NavItem } from "@/lib/nav";

function NavGroup({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  return (
    <div>
      <p className="px-3 text-xs font-semibold uppercase tracking-wide text-tdh-cream/40 mb-2">
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block px-3 py-2 text-sm font-semibold uppercase tracking-wide border-l-2 ${
                  active
                    ? "border-tdh-red text-tdh-cream bg-tdh-cream/5"
                    : "border-transparent text-tdh-cream/60 hover:text-tdh-cream hover:bg-tdh-cream/5"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-tdh-black text-tdh-cream flex flex-col gap-8 px-3 py-6 min-h-screen">
      <Link href="/" className="px-3 font-serif font-bold uppercase text-lg tracking-wide">
        The Discount House
      </Link>
      <NavGroup label="App" items={APP_NAV} pathname={pathname} />
      <NavGroup label="Info" items={INFO_NAV} pathname={pathname} />
    </aside>
  );
}

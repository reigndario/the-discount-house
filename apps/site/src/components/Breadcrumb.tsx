"use client";

import { usePathname } from "next/navigation";

import { ALL_NAV } from "@/lib/nav";

export function Breadcrumb({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const current = ALL_NAV.find((item) => item.href === pathname);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-tdh-black/10 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Toggle navigation"
          className="md:hidden shrink-0 border border-tdh-black/20 px-2 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tdh-black"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <p className="text-sm truncate">
          <span className="text-tdh-black/50">The Discount House</span>
          {current ? (
            <>
              <span className="text-tdh-black/30 mx-2">/</span>
              <span className="font-semibold">{current.label}</span>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 bg-tdh-black text-tdh-cream text-xs sm:text-sm font-semibold uppercase tracking-wide px-3 py-2 sm:px-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tdh-black"
      >
        Connect Wallet
      </button>
    </header>
  );
}

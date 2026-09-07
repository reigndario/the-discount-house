"use client";

import { useState } from "react";

import { Breadcrumb } from "@/components/Breadcrumb";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-tdh-cream text-tdh-black">
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-tdh-black/40 md:hidden"
        />
      ) : null}
      <div
        className={`fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : ""
        }`}
      >
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <Breadcrumb onMenuClick={() => setNavOpen((open) => !open)} />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

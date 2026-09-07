"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme") as Theme | null;
    if (attr === "light" || attr === "dark") {
      setTheme(attr);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage can be unavailable (private mode, blocked); theme just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="shrink-0 border border-foreground/20 text-xs sm:text-sm font-semibold uppercase tracking-wide px-3 py-2 hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

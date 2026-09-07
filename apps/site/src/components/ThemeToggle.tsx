"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="0.5" x2="8" y2="2.3" />
        <line x1="8" y1="13.7" x2="8" y2="15.5" />
        <line x1="0.5" y1="8" x2="2.3" y2="8" />
        <line x1="13.7" y1="8" x2="15.5" y2="8" />
        <line x1="2.6" y1="2.6" x2="3.9" y2="3.9" />
        <line x1="12.1" y1="12.1" x2="13.4" y2="13.4" />
        <line x1="2.6" y1="13.4" x2="3.9" y2="12.1" />
        <line x1="12.1" y1="3.9" x2="13.4" y2="2.6" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M14 9.5A6 6 0 1 1 6.5 2a5 5 0 1 0 7.5 7.5Z" />
    </svg>
  );
}

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

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle color theme"
      className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full bg-foreground/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full bg-background text-foreground shadow transition-transform ${
          isDark ? "translate-x-7" : "translate-x-1"
        }`}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

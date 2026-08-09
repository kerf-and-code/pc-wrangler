"use client";

// The light/dark switch for a published codex.
//
// IT DOES NOT OWN THE INITIAL THEME. An inline script in the page sets data-wiki before first paint,
// because this component cannot run until React hydrates and a reader who chose dark would see a
// white flash on every load. This only handles the CLICK, and reads its label from what that script
// already decided.
//
// WHICH MEANS IT MUST NOT RENDER A LABEL ON THE SERVER. The server has no idea which theme the
// reader picked, so anything it rendered would be wrong half the time and React would warn about
// the mismatch. It renders nothing until mounted.

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.wiki as "dark" | "light") || "dark";
    setTheme(current);
  }, []);

  if (!theme) return null;

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.wiki = next;
    try {
      localStorage.setItem("sixaxes-wiki-theme", next);
    } catch {
      // Private browsing can refuse storage. The theme still changes for this page view, which is
      // the part the reader asked for; only remembering it fails.
    }
    setTheme(next);
  };

  return (
    <button className="w-theme" onClick={flip}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

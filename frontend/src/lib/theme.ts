// Theme handling. We toggle the `dark` class on <html>; tokens in global.css
// + tailwind.config.ts do the rest.
//
// Persistence: we use localStorage when available, but fall back gracefully
// (e.g. in sandboxed iframes) so the toggle still works for the current session.
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "gtotree-theme";

function safeGet(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch { return null; }
}
function safeSet(v: Theme) {
  try { window.localStorage.setItem(KEY, v); } catch { /* ignored */ }
}

// Default to LIGHT regardless of system preference so the app's initial look
// is consistent for first-time visitors.
function defaultTheme(): Theme {
  return "light";
}

function apply(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.style.colorScheme = t;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => safeGet() ?? (typeof document !== "undefined" &&
                         document.documentElement.classList.contains("dark")
                          ? "dark" : defaultTheme())
  );

  useEffect(() => {
    apply(theme);
    safeSet(theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}

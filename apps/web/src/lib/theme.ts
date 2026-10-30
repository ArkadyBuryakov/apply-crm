// Color theme kept per browser. index.html applies the stored choice before the first paint; this module keeps the
// `dark` class on <html> in sync with it and, for "system", with the OS setting.
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const resolve = (theme: Theme) => (theme === "system" ? (media().matches ? "dark" : "light") : theme);

function apply() {
  document.documentElement.classList.toggle("dark", resolve(stored()) === "dark");
  for (const notify of listeners) notify();
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  apply();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) media().addEventListener("change", apply);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) media().removeEventListener("change", apply);
  };
}

/** The chosen theme and the one in effect. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, stored);
  const resolved = useSyncExternalStore(subscribe, () => resolve(stored()));
  return { theme, resolved };
}

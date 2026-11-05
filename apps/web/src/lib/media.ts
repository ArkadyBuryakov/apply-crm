import { useSyncExternalStore } from "react";

/** Below Tailwind's `md`: phones get the bottom tab bar and full-screen sheets instead of the sidebar. */
export const PHONE = "(max-width: 767px)";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export const usePhone = () => useMediaQuery(PHONE);

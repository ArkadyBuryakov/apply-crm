// Page titles (ADR 0036): pages name what they show, an open dialog goes in front, and the assistant is told the result.
import { useEffect } from "react";

const APP = "Apply CRM";

/** Pages use level 0; things opened over a page, such as an action, a higher one. */
const entries = new Map<symbol, { title: string; level: number }>();

/** What the user is looking at, most specific first, without the app's name. */
export function viewTitle() {
  return [...entries.values()]
    .sort((a, b) => b.level - a.level)
    .map((e) => e.title)
    .join(" — ");
}

export function useDocumentTitle(title: string | undefined, level = 0) {
  useEffect(() => {
    if (!title) return;
    const key = Symbol(title);
    entries.set(key, { title, level });
    document.title = [viewTitle(), APP].filter(Boolean).join(" — ");
    return () => {
      entries.delete(key);
      document.title = [viewTitle(), APP].filter(Boolean).join(" — ");
    };
  }, [title, level]);
}

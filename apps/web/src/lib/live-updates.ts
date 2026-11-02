import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { invalidateProject } from "./queries";

const DEBOUNCE_MS = 500;
const MAX_RETRY_MS = 60_000;

/**
 * Keeps the project's queries current when something else changes its data: an agent over MCP, an API script, the
 * worker or another member (ADR 0034). Every event refreshes the whole project, because lists, the agenda and the graph
 * can show an entity without having its ID in their query key; only the queries on screen actually refetch.
 */
export function useLiveUpdates(projectId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    let source: EventSource | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 1000;
    let opened = false;
    let projectStale = false;
    let userStale = false;

    function schedule() {
      flushTimer ??= setTimeout(() => {
        flushTimer = undefined;
        if (projectStale) invalidateProject(qc, projectId);
        // Queries outside a project (the user's memories, for one) have a key of a single element.
        if (userStale) qc.invalidateQueries({ predicate: (q) => q.queryKey.length === 1 });
        projectStale = userStale = false;
      }, DEBOUNCE_MS);
    }

    function connect() {
      source = new EventSource(`/api/projects/${projectId}/events`);
      source.onopen = () => {
        retryMs = 1000;
        // Whatever changed while disconnected was not announced to this stream.
        if (opened) {
          projectStale = userStale = true;
          schedule();
        }
        opened = true;
      };
      source.onmessage = (message) => {
        if ("userId" in JSON.parse(message.data)) userStale = true;
        else projectStale = true;
        schedule();
      };
      source.onerror = () => {
        // The browser retries dropped connections itself, but gives up on an error response such as a proxy's 502.
        if (source?.readyState !== EventSource.CLOSED) return;
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      };
    }

    connect();
    return () => {
      source?.close();
      clearTimeout(flushTimer);
      clearTimeout(retryTimer);
    };
  }, [qc, projectId]);
}

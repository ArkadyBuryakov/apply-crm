// The action opened over a project page (ADR 0036): `?action=` on the project route, shown by one dialog in the
// project layout, so any page can be linked to with an action open.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { type Action, api, unwrap } from "@/lib/api";
import { useDocumentTitle } from "@/lib/document-title";

const actionKey = (projectId: string, actionId: string) => ["action", projectId, actionId];

/** Opens an action over the current page; passing the row a list already has shows it without waiting. */
export function useOpenAction(projectId: string) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (action: Action | string) => {
    const id = typeof action === "string" ? action : action.id;
    if (typeof action !== "string") qc.setQueryData(actionKey(projectId, id), action);
    navigate({
      to: ".",
      search: (prev) => ({ ...prev, action: id }),
      state: (prev) => ({ ...prev, openedAction: true }),
    });
  };
}

export function OpenedAction({ projectId }: { projectId: string }) {
  const { action: actionId } = useSearch({ from: "/authed/p/$projectId" });
  const router = useRouter();
  const navigate = useNavigate();
  const action = useQuery({
    queryKey: actionKey(projectId, actionId ?? ""),
    enabled: Boolean(actionId),
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/actions/{actionId}", {
          params: { path: { projectId, actionId: actionId! } },
        }),
      ),
  });
  useDocumentTitle(actionId ? action.data?.title : undefined, 1);

  const remove = () => navigate({ to: ".", search: (prev) => ({ ...prev, action: undefined }), replace: true });
  // Back undoes opening it in the app; a link that arrived with the action open has nothing to go back to.
  const close = () => (router.state.location.state.openedAction ? router.history.back() : remove());

  // Deleted, or a link to an action that is gone.
  const missing = Boolean(actionId) && action.isError;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the action turns out to be missing
  useEffect(() => {
    if (missing) remove();
  }, [missing]);

  if (!actionId || !action.data) return null;
  return (
    <ActionDialog
      key={actionId}
      projectId={projectId}
      open
      onOpenChange={(open) => (open ? undefined : close())}
      action={action.data}
    />
  );
}

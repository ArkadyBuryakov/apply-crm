import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, unwrap } from "./api";

/** Every project query key starts with [family, projectId], so one predicate invalidates a whole project. */
export function invalidateProject(qc: QueryClient, projectId: string) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === projectId });
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 412) return "Someone else changed this in the meantime. The latest version has been loaded.";
    if (error.status === 403) return `Not allowed: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

/** A mutation scoped to a project: refreshes the project's queries afterwards and reports errors as toasts. */
export function useProjectMutation<TVars, TResult>(
  projectId: string,
  fn: (vars: TVars) => Promise<TResult>,
  options: { success?: string | ((r: TResult) => string); onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await invalidateProject(qc, projectId);
      const msg = typeof options.success === "function" ? options.success(result) : options.success;
      if (msg) toast.success(msg);
      options.onSuccess?.(result);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 412) await invalidateProject(qc, projectId);
      toast.error(errorMessage(error));
    },
  });
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => unwrap(api.GET("/api/me")), retry: false });
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => unwrap(api.GET("/api/projects")) });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => unwrap(api.GET("/api/projects/{projectId}", { params: { path: { projectId } } })),
  });
}

export function useCan(projectId: string) {
  const { data } = useProject(projectId);
  const granted = new Set(data?.permissions ?? []);
  return (...permissions: string[]) => permissions.every((p) => granted.has(p));
}

export function useStages(projectId: string) {
  return useQuery({
    queryKey: ["stages", projectId],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/stages", { params: { path: { projectId } } }))).items,
  });
}

export function useChannels(projectId: string) {
  return useQuery({
    queryKey: ["channels", projectId],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/channels", { params: { path: { projectId } } }))).items,
  });
}

export function useMembers(projectId: string) {
  return useQuery({
    queryKey: ["members", projectId],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/members", { params: { path: { projectId } } }))).items,
  });
}

export function useOrganizations(projectId: string, query: { kind?: "company" | "agency"; q?: string } = {}) {
  return useQuery({
    queryKey: ["organizations", projectId, query],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/organizations", {
            params: { path: { projectId }, query: { limit: 200, ...query } },
          }),
        )
      ).items,
  });
}

export function useContacts(projectId: string, query: { q?: string; organizationId?: string } = {}) {
  return useQuery({
    queryKey: ["contacts", projectId, query],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/contacts", {
            params: { path: { projectId }, query: { limit: 200, ...query } },
          }),
        )
      ).items,
  });
}

export function usePositions(
  projectId: string,
  query: {
    outcome?: "open" | "accepted" | "rejected" | "withdrawn" | "ghosted";
    organizationId?: string;
    q?: string;
  } = {},
) {
  return useQuery({
    queryKey: ["positions", projectId, query],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/positions", {
            params: { path: { projectId }, query: { limit: 200, ...query } },
          }),
        )
      ).items,
  });
}

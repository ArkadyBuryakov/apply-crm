// The assistant's navigation tool (ADR 0031), derived from the router: routes with a `staticData.description` are
// navigable, path params come from the path and search params from the route's zod schema. The browser runs the call.
import type { AnyRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { AppRouter } from "@/router";

type NavigableRoute = {
  to: string;
  description: string;
  params: string[];
  search: z.ZodType | null;
};

export type NavigationInput = { to: string; params?: Record<string, string>; search?: Record<string, unknown> };

export function navigableRoutes(router: AppRouter): NavigableRoute[] {
  return (Object.values(router.routesById) as AnyRoute[]).flatMap((route) => {
    const description = route.options.staticData?.description;
    if (!description) return [];
    const validate = route.options.validateSearch;
    return [
      {
        to: route.fullPath,
        description,
        params: [...route.fullPath.matchAll(/\$(\w+)/g)].map((m) => m[1]!),
        search: validate instanceof z.ZodType ? validate : null,
      },
    ];
  });
}

/** The tool definition the SPA sends with every message. */
export function navigationToolDefinition(router: AppRouter) {
  const routes = navigableRoutes(router);
  const params = [...new Set(routes.flatMap((r) => r.params))].filter((p) => p !== "projectId");
  const search: Record<string, unknown> = {};
  const lines = routes.map((route) => {
    const parts = [`- \`${route.to}\`: ${route.description}.`];
    const own = route.params.filter((p) => p !== "projectId");
    if (own.length) parts.push(`Params: ${own.join(", ")}.`);
    if (route.search) {
      const schema = z.toJSONSchema(route.search, { io: "input" }) as { properties?: Record<string, unknown> };
      Object.assign(search, schema.properties);
      parts.push(`Search: ${Object.keys(schema.properties ?? {}).join(", ")}.`);
    }
    return parts.join(" ");
  });
  return {
    description: [
      "Open a page of the web app for the user. projectId is filled in with the current project. Pages:",
      ...lines,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", enum: routes.map((r) => r.to), description: "The page to open" },
        params: {
          type: "object",
          description: "Path params of the page, e.g. positionId",
          properties: Object.fromEntries(params.map((p) => [p, { type: "string" }])),
          additionalProperties: false,
        },
        search: {
          type: "object",
          description: "Search params of the page, where it has any",
          properties: search,
          additionalProperties: false,
        },
      },
      required: ["to"],
      additionalProperties: false,
    },
  };
}

/** Runs a navigation call; failures are returned to the model rather than thrown. */
export async function runNavigation(router: AppRouter, input: NavigationInput, projectId: string) {
  const route = navigableRoutes(router).find((r) => r.to === input.to);
  if (!route) return { ok: false, error: `Unknown page ${input.to}` };
  const params: Record<string, string> = { projectId, ...input.params };
  const missing = route.params.filter((p) => !params[p]);
  if (missing.length) return { ok: false, error: `Missing params: ${missing.join(", ")}` };
  let search: unknown = {};
  if (route.search) {
    const parsed = route.search.safeParse(input.search ?? {});
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    search = parsed.data;
  }
  const used = Object.fromEntries(route.params.map((p) => [p, params[p]!]));
  await router.navigate({ to: route.to, params: used, search } as never);
  return { ok: true, url: router.state.location.href };
}

import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "./lib/auth";
import { getLastProject } from "./lib/last-project";
import { AccountPage } from "./pages/account";
import { ConsentPage } from "./pages/auth/consent";
import { LoginPage, SignupPage } from "./pages/auth/login";
import { NotFound } from "./pages/not-found";
import { AgendaPage } from "./pages/project/agenda";
import { BoardPage } from "./pages/project/board";
import { ContactDetailPage, ContactsPage } from "./pages/project/contacts";
import { DocumentDetailPage, DocumentsPage } from "./pages/project/documents";
import { GraphPage } from "./pages/project/graph";
import { ProjectLayout } from "./pages/project/layout";
import { OrganizationDetailPage, OrganizationsPage } from "./pages/project/organizations";
import { PositionPage } from "./pages/project/position";
import { SearchPage } from "./pages/project/search";
import { SettingsPage } from "./pages/project/settings";
import { ProjectsPage } from "./pages/projects";

type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", component: SignupPage });
const consentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/oauth/consent", component: ConsentPage });

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: "/login", search: { redirect: location.href } });
    return { user: data.user };
  },
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  beforeLoad: () => {
    const projectId = getLastProject();
    throw projectId
      ? redirect({ to: "/p/$projectId", params: { projectId }, replace: true })
      : redirect({ to: "/projects", replace: true });
  },
});
// Routes with a `staticData.description` can be opened by the assistant's navigation tool (ADR 0031); their search
// params are zod schemas so the tool can describe them.
const projectsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/projects",
  component: ProjectsPage,
  staticData: { description: "All of the user's projects and pending invitations" },
});
const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/account",
  component: AccountPage,
  staticData: { description: "The user's account: profile, timezone, API keys and AI provider keys" },
});

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/p/$projectId",
  component: ProjectLayout,
});
const boardRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: BoardPage,
  staticData: { description: "Pipeline board: the project's positions grouped by stage" },
});
const positionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/positions/$positionId",
  component: PositionPage,
  staticData: {
    description: "One position: details, listing, stage and outcome, contacts, action timeline, documents",
  },
});
const organizationsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/organizations",
  component: OrganizationsPage,
  staticData: { description: "All organizations (companies and recruiting agencies)" },
});
const organizationRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/organizations/$organizationId",
  component: OrganizationDetailPage,
  staticData: { description: "One organization: details, its positions, contacts and timeline" },
});
const contactsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/contacts",
  component: ContactsPage,
  staticData: { description: "All contacts (people)" },
});
const contactRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/contacts/$contactId",
  component: ContactDetailPage,
  staticData: { description: "One contact: handles, affiliations and the actions they took part in" },
});
const agendaRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/agenda",
  component: AgendaPage,
  staticData: { description: "Agenda: planned actions by day, and overdue tasks" },
});
const graphRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/graph",
  component: GraphPage,
  validateSearch: z.object({
    positionId: z.string().optional().describe("Show only this position's actions (pos_…)"),
    organizationId: z.string().optional().describe("Show only this organization's actions (org_…)"),
  }),
  staticData: { description: "Action graph: actions and the links between them, for the project or one position" },
});
const documentsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/documents",
  component: DocumentsPage,
  staticData: { description: "Documents (resumes, cover letters, …) and LaTeX templates" },
});
const documentRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/documents/$documentId",
  component: DocumentDetailPage,
  staticData: { description: "One document: its versions, LaTeX source and compiled PDF" },
});
const searchRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/search",
  component: SearchPage,
  validateSearch: z.object({ q: z.string().default("").describe("Search text") }),
  staticData: { description: "Full-text search over organizations, positions, contacts and actions" },
});
const settingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/settings",
  component: SettingsPage,
  staticData: { description: "Project settings: name, members and invitations, stages, channels, MCP, import/export" },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  consentRoute,
  authedRoute.addChildren([
    indexRoute,
    projectsRoute,
    accountRoute,
    projectRoute.addChildren([
      boardRoute,
      positionRoute,
      organizationsRoute,
      organizationRoute,
      contactsRoute,
      contactRoute,
      agendaRoute,
      graphRoute,
      documentsRoute,
      documentRoute,
      searchRoute,
      settingsRoute,
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface StaticDataRouteOption {
    /** What the page shows; routes with a description are navigable by the assistant. */
    description?: string;
  }
}

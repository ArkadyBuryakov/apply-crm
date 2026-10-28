import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
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
const projectsRoute = createRoute({ getParentRoute: () => authedRoute, path: "/projects", component: ProjectsPage });
const accountRoute = createRoute({ getParentRoute: () => authedRoute, path: "/account", component: AccountPage });

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/p/$projectId",
  component: ProjectLayout,
});
const boardRoute = createRoute({ getParentRoute: () => projectRoute, path: "/", component: BoardPage });
const positionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/positions/$positionId",
  component: PositionPage,
});
const organizationsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/organizations",
  component: OrganizationsPage,
});
const organizationRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/organizations/$organizationId",
  component: OrganizationDetailPage,
});
const contactsRoute = createRoute({ getParentRoute: () => projectRoute, path: "/contacts", component: ContactsPage });
const contactRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/contacts/$contactId",
  component: ContactDetailPage,
});
const agendaRoute = createRoute({ getParentRoute: () => projectRoute, path: "/agenda", component: AgendaPage });
const graphRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/graph",
  component: GraphPage,
  validateSearch: (s: Record<string, unknown>): { positionId?: string; organizationId?: string } => ({
    ...(typeof s.positionId === "string" ? { positionId: s.positionId } : {}),
    ...(typeof s.organizationId === "string" ? { organizationId: s.organizationId } : {}),
  }),
});
const documentsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/documents",
  component: DocumentsPage,
});
const documentRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/documents/$documentId",
  component: DocumentDetailPage,
});
const searchRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/search",
  component: SearchPage,
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === "string" ? s.q : "" }),
});
const settingsRoute = createRoute({ getParentRoute: () => projectRoute, path: "/settings", component: SettingsPage });

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

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

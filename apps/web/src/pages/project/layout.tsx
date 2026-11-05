import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useCanGoBack,
  useMatches,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import {
  Bell,
  Brain,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  FileText,
  KanbanSquare,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  SunMoon,
  UserRound,
  Users,
} from "lucide-react";
import { type CSSProperties, type FormEvent, type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Loading } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { panelOpen, panelWidth } from "@/lib/assistant-prefs";
import { authClient } from "@/lib/auth";
import { clearLastProject, setLastProject } from "@/lib/last-project";
import { useLiveUpdates } from "@/lib/live-updates";
import { useMediaQuery } from "@/lib/media";
import { useProject, useProjectMutation } from "@/lib/queries";
import { sidebarCollapsed } from "@/lib/sidebar-prefs";
import { setTheme, useTheme } from "@/lib/theme";
import { cn, formatDateTime, humanize } from "@/lib/utils";

const NAV_ITEM =
  "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const NAV = [
  { to: "/p/$projectId", label: "Pipeline", icon: KanbanSquare, exact: true },
  { to: "/p/$projectId/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/p/$projectId/organizations", label: "Organizations", icon: Building2 },
  { to: "/p/$projectId/contacts", label: "Contacts", icon: Users },
  { to: "/p/$projectId/graph", label: "Action graph", icon: Network },
  { to: "/p/$projectId/documents", label: "Documents", icon: FileText },
  { to: "/p/$projectId/memory", label: "Memory", icon: Brain },
  { to: "/p/$projectId/settings", label: "Settings", icon: Settings },
] as const;

export function ProjectLayout() {
  const { projectId } = useParams({ from: "/authed/p/$projectId" });
  const project = useProject(projectId);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(panelOpen.get);
  const [moreOpen, setMoreOpen] = useState(false);
  useLiveUpdates(projectId);

  function toggleAssistant(open = !assistantOpen) {
    setAssistantOpen(open);
    panelOpen.set(open);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen((open) => {
          panelOpen.set(!open);
          return !open;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (project.isSuccess) setLastProject(projectId);
    else if (project.isError) clearLastProject(projectId);
  }, [projectId, project.isSuccess, project.isError]);

  if (project.isLoading) return <Loading />;
  if (project.isError) {
    return (
      <div className="p-6 text-sm">
        This project does not exist or you no longer have access.{" "}
        <Link to="/projects" className="text-primary hover:underline">
          Back to your projects
        </Link>
      </div>
    );
  }

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate({ to: "/p/$projectId/search", params: { projectId }, search: { q: q.trim() } });
  }

  return (
    <div className="flex min-h-full">
      <Sidebar projectId={projectId} projectName={project.data?.name} role={project.data?.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-border bg-background/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur md:px-4">
          <PhoneTitle projectId={projectId} />
          <div className="md:hidden">
            <Notifications projectId={projectId} align="end" />
          </div>
          <form onSubmit={search} className="hidden flex-1 md:block">
            <Input
              className="max-w-md"
              placeholder="Search organizations, positions, people, actions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Assistant"
            aria-pressed={assistantOpen}
            title="Assistant (Ctrl+J)"
            className={cn("max-md:hidden", assistantOpen && "bg-muted")}
            onClick={() => toggleAssistant()}
          >
            <MessageSquare />
          </Button>
        </header>
        <main className="flex min-w-0 flex-1 flex-col p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6">
          <Outlet />
        </main>
      </div>
      <TabBar
        projectId={projectId}
        assistantOpen={assistantOpen}
        onAssistant={() => toggleAssistant()}
        moreOpen={moreOpen}
        onMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        projectId={projectId}
        projectName={project.data?.name}
        role={project.data?.role}
      />
      {assistantOpen ? (
        <AssistantSidebar>
          <AssistantPanel key={projectId} projectId={projectId} onClose={() => toggleAssistant(false)} />
        </AssistantSidebar>
      ) : null}
    </div>
  );
}

const MIN_WIDTH = 320;

/** Full screen on phones; a resizable column beside the page from md up. */
function AssistantSidebar({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(panelWidth.get);

  function startResize(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => {
      const max = Math.max(MIN_WIDTH, window.innerWidth * 0.6);
      setWidth(Math.min(max, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX)));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setWidth((w) => {
        panelWidth.set(w);
        return w;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  return (
    <aside
      aria-label="Assistant"
      style={{ "--assistant-width": `${width}px` } as CSSProperties}
      className="fixed inset-0 z-40 flex bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:sticky md:top-0 md:z-auto md:h-screen md:w-[var(--assistant-width)] md:shrink-0 md:border-l md:border-border md:p-0"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: an interactive splitter, which <hr> cannot be */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        onPointerDown={startResize}
        className="hidden w-1 shrink-0 cursor-col-resize hover:bg-primary/30 md:block"
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

const NARROW = "(max-width: 1023px)";

/**
 * Project navigation on tablets and desktops (phones use the tab bar). Wide windows show it expanded unless the user collapsed it to an icon rail; narrow windows always
 * show the rail, whose expand button opens it over the dimmed page until it is collapsed again or the page is clicked.
 */
function Sidebar({ projectId, projectName, role }: { projectId: string; projectName?: string; role?: string }) {
  const narrow = useMediaQuery(NARROW);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed.get);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const rail = narrow || collapsed;
  const overlay = narrow && overlayOpen;
  const expanded = !rail || overlay;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  function toggle() {
    if (narrow) setOverlayOpen(!overlayOpen);
    else {
      setCollapsed(!collapsed);
      sidebarCollapsed.set(!collapsed);
    }
  }

  const toggleButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={expanded}
      title={expanded ? "Collapse sidebar" : "Expand sidebar"}
      onClick={toggle}
    >
      {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  );

  return (
    <>
      {overlay ? (
        <div aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={() => setOverlayOpen(false)} />
      ) : null}
      <aside
        aria-label="Project navigation"
        className={cn("sticky top-0 z-30 h-screen shrink-0 max-md:hidden", rail ? "w-14" : "w-56")}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 overflow-hidden border-r border-border bg-background",
            expanded ? "w-56" : "w-14",
            overlay && "shadow-lg",
          )}
        >
          <div className="flex h-full flex-col bg-muted/30">
            <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
              {expanded ? (
                <>
                  <Link
                    to="/projects"
                    className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="size-3" /> All projects
                  </Link>
                  <Notifications projectId={projectId} />
                </>
              ) : null}
              {toggleButton}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-3">
              {expanded ? (
                <div className="mb-3 truncate px-2 font-semibold" title={projectName}>
                  {projectName}
                </div>
              ) : (
                <div className="mb-2">
                  <Notifications projectId={projectId} />
                </div>
              )}
              <nav className="grid gap-0.5">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    params={{ projectId }}
                    activeOptions={{ exact: "exact" in item }}
                    title={expanded ? undefined : item.label}
                    aria-label={expanded ? undefined : item.label}
                    className={NAV_ITEM}
                    activeProps={{ className: "bg-muted text-foreground font-medium" }}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {expanded ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto grid pt-3">
                <ThemeMenu expanded={expanded} />
              </div>
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <UserMenu expanded={expanded} role={role} />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

const DETAIL_PARENTS = {
  "/p/$projectId/positions/$positionId": "/p/$projectId",
  "/p/$projectId/organizations/$organizationId": "/p/$projectId/organizations",
  "/p/$projectId/contacts/$contactId": "/p/$projectId/contacts",
  "/p/$projectId/documents/$documentId": "/p/$projectId/documents",
} as const;

type PhoneTab = "pipeline" | "agenda" | "search" | "more";

/** Where the phone shell is: the page's title, the list a detail page goes back to, and the tab it belongs under. */
function usePhonePage() {
  const matches = useMatches();
  const path = (matches.at(-1)?.fullPath ?? "").replace(/(.)\/$/, "$1");
  const parent = DETAIL_PARENTS[path as keyof typeof DETAIL_PARENTS] as (typeof NAV)[number]["to"] | undefined;
  const page = parent ?? path;
  const tab: PhoneTab =
    page === "/p/$projectId"
      ? "pipeline"
      : page === "/p/$projectId/agenda"
        ? "agenda"
        : page === "/p/$projectId/search"
          ? "search"
          : "more";
  const title = page === "/p/$projectId/search" ? "Search" : (NAV.find((n) => n.to === page)?.label ?? "");
  return { title, parent, tab };
}

/** The phone header's left side: the page title, or a way back to the list on detail pages. */
function PhoneTitle({ projectId }: { projectId: string }) {
  const { title, parent } = usePhonePage();
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  // Not a heading: the page has its own h1, which phones show only to screen readers when it repeats this title.
  if (!parent) return <div className="min-w-0 flex-1 truncate px-2 text-lg font-semibold md:hidden">{title}</div>;
  return (
    <div className="flex min-w-0 flex-1 items-center md:hidden">
      <Button
        variant="ghost"
        className="min-w-0 gap-1 px-2 font-normal text-muted-foreground"
        onClick={() => (canGoBack ? router.history.back() : navigate({ to: parent, params: { projectId } }))}
      >
        <ChevronLeft className="size-5!" /> <span className="truncate">{title}</span>
      </Button>
    </div>
  );
}

const TAB = "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground cursor-pointer";
const TAB_ON = "font-medium text-primary";

/** Phone navigation along the bottom of the screen; the rest of the sidebar is under More. */
function TabBar({
  projectId,
  assistantOpen,
  onAssistant,
  moreOpen,
  onMore,
}: {
  projectId: string;
  assistantOpen: boolean;
  onAssistant: () => void;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const { tab } = usePhonePage();
  const on = (t: PhoneTab) => !assistantOpen && !moreOpen && tab === t;
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <Link to="/p/$projectId" params={{ projectId }} className={cn(TAB, on("pipeline") && TAB_ON)}>
        <KanbanSquare className="size-5" /> Pipeline
      </Link>
      <Link to="/p/$projectId/agenda" params={{ projectId }} className={cn(TAB, on("agenda") && TAB_ON)}>
        <CalendarDays className="size-5" /> Agenda
      </Link>
      <Link
        to="/p/$projectId/search"
        params={{ projectId }}
        search={{ q: "" }}
        className={cn(TAB, on("search") && TAB_ON)}
      >
        <Search className="size-5" /> Search
      </Link>
      <button
        type="button"
        aria-pressed={assistantOpen}
        onClick={onAssistant}
        className={cn(TAB, assistantOpen && TAB_ON)}
      >
        <MessageSquare className="size-5" /> Assistant
      </button>
      <button type="button" onClick={onMore} className={cn(TAB, (moreOpen || on("more")) && TAB_ON)}>
        <MenuIcon className="size-5" /> More
      </button>
    </nav>
  );
}

const SHEET_ITEM = "flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-muted [&_svg]:size-5";

/** The phone's More tab: the pages and account controls that do not fit in the tab bar. */
function MoreSheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
  role?: string;
}) {
  const { user } = useRouteContext({ from: "/authed" });
  const { theme } = useTheme();
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="More">
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{projectName}</div>
          {role ? <div className="text-xs text-muted-foreground">{humanize(role)}</div> : null}
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/projects" onClick={close}>
            All projects
          </Link>
        </Button>
      </div>
      <nav className="grid">
        {NAV.slice(2).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ projectId }}
            onClick={close}
            className={SHEET_ITEM}
            activeProps={{ className: "bg-muted font-medium" }}
          >
            <item.icon /> {item.label}
          </Link>
        ))}
      </nav>
      <div className="my-2 h-px bg-border" />
      <div role="radiogroup" aria-label="Theme" className="mx-3 my-2 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {THEMES.map((t) => (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={t.value === theme}
            onClick={() => setTheme(t.value)}
            className={cn(
              "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground [&_svg]:size-4",
              t.value === theme && "bg-card font-medium text-foreground shadow-xs",
            )}
          >
            <t.icon /> {t.label}
          </button>
        ))}
      </div>
      <Link to="/account" onClick={close} className={SHEET_ITEM}>
        <UserRound /> <span className="min-w-0 flex-1 truncate">{user.name}</span>
        <span className="text-xs text-muted-foreground">Account</span>
      </Link>
      <button type="button" onClick={signOut} className={cn(SHEET_ITEM, "w-full cursor-pointer text-left")}>
        <LogOut /> Sign out
      </button>
    </Sheet>
  );
}

async function signOut() {
  await authClient.signOut();
  window.location.href = "/login";
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function ThemeMenu({ expanded }: { expanded: boolean }) {
  const { theme } = useTheme();
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={expanded ? undefined : "Theme"}
          title={expanded ? undefined : "Theme"}
          className={cn(NAV_ITEM, "w-full cursor-pointer text-left data-[state=open]:bg-muted")}
        >
          <SunMoon className="size-4 shrink-0" />
          {expanded ? <span className="truncate">Theme</span> : null}
        </button>
      }
    >
      {THEMES.map((t) => (
        <MenuItem key={t.value} onSelect={() => setTheme(t.value)}>
          <t.icon /> <span className="flex-1">{t.label}</span>
          {t.value === theme ? <Check className="text-primary" /> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

function UserMenu({ expanded, role }: { expanded: boolean; role?: string }) {
  const { user } = useRouteContext({ from: "/authed" });
  const navigate = useNavigate();
  return (
    <Menu
      side="top"
      align="start"
      trigger={
        <Button
          variant="ghost"
          aria-label="Account"
          title={expanded ? undefined : user.name}
          className={cn("w-full justify-start px-2", expanded ? "h-auto py-1.5" : "size-8")}
        >
          <UserRound />
          {expanded ? (
            <span className="min-w-0 text-left">
              <span className="block truncate">{user.name}</span>
              {role ? <span className="block text-xs font-normal text-muted-foreground">{humanize(role)}</span> : null}
            </span>
          ) : null}
        </Button>
      }
    >
      <MenuItem onSelect={() => navigate({ to: "/account" })}>
        <UserRound /> Account
      </MenuItem>
      <MenuItem onSelect={signOut}>
        <LogOut /> Sign out
      </MenuItem>
    </Menu>
  );
}

function Notifications({ projectId, align = "start" }: { projectId: string; align?: "start" | "end" }) {
  const notifications = useQuery({
    queryKey: ["notifications", projectId],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/notifications", { params: { path: { projectId }, query: { limit: 20 } } }),
      ),
  });
  const markRead = useProjectMutation(projectId, (ids?: string[]) =>
    unwrap(
      api.POST("/api/projects/{projectId}/notifications/read", {
        params: { path: { projectId } },
        body: ids ? { ids } : {},
      }),
    ),
  );
  const unread = notifications.data?.items.filter((n) => !n.readAt).length ?? 0;
  return (
    <Menu
      align={align}
      trigger={
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell />
          {unread ? (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {unread}
            </span>
          ) : null}
        </Button>
      }
    >
      <div className="max-h-96 w-[min(20rem,calc(100vw-1rem))] overflow-y-auto">
        {notifications.data?.items.length ? null : <p className="p-3 text-sm text-muted-foreground">Nothing new.</p>}
        {notifications.data?.items.map((n) => {
          const body = (
            <>
              <p>{n.message}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
            </>
          );
          return n.kind === "agenda" ? (
            <MenuItem
              key={n.id}
              asChild
              onSelect={() => (n.readAt ? undefined : markRead.mutate([n.id]))}
              className={cn("block", !n.readAt && "bg-accent/50")}
            >
              <Link to="/p/$projectId/agenda" params={{ projectId }}>
                {body}
              </Link>
            </MenuItem>
          ) : (
            <div key={n.id} className={cn("rounded px-2 py-1.5 text-sm", !n.readAt && "bg-accent/50")}>
              {body}
            </div>
          );
        })}
        {unread ? (
          <MenuItem onSelect={() => markRead.mutate(undefined)} className="justify-center text-primary">
            Mark all as read
          </MenuItem>
        ) : null}
      </div>
    </Menu>
  );
}

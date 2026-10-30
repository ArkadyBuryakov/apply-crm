import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams, useRouteContext } from "@tanstack/react-router";
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
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Loading } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { panelOpen, panelWidth } from "@/lib/assistant-prefs";
import { authClient } from "@/lib/auth";
import { clearLastProject, setLastProject } from "@/lib/last-project";
import { useProject, useProjectMutation } from "@/lib/queries";
import { sidebarCollapsed } from "@/lib/sidebar-prefs";
import { setTheme, useTheme } from "@/lib/theme";
import { cn, formatDateTime, humanize } from "@/lib/utils";

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
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
          <form onSubmit={search} className="flex-1">
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
            className={cn(assistantOpen && "bg-muted")}
            onClick={() => toggleAssistant()}
          >
            <MessageSquare />
          </Button>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
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
      className="fixed inset-0 z-40 flex bg-background md:sticky md:top-0 md:z-auto md:h-screen md:w-[var(--assistant-width)] md:shrink-0 md:border-l md:border-border"
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

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/**
 * Project navigation. Wide windows show it expanded unless the user collapsed it to an icon rail; narrow windows always
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
        className={cn("sticky top-0 z-30 h-screen shrink-0", rail ? "w-14" : "w-56")}
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
                    className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    activeProps={{ className: "bg-muted text-foreground font-medium" }}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {expanded ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                ))}
              </nav>
            </div>
            <div className={cn("flex shrink-0 gap-1 border-t border-border p-3", !expanded && "flex-col")}>
              <div className="min-w-0 flex-1">
                <UserMenu expanded={expanded} role={role} />
              </div>
              <ThemeMenu />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function ThemeMenu() {
  const { theme } = useTheme();
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  return (
    <Menu
      side="top"
      align="start"
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current.label}`} title={`Theme: ${current.label}`}>
          <current.icon />
        </Button>
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
      <MenuItem
        onSelect={async () => {
          await authClient.signOut();
          window.location.href = "/login";
        }}
      >
        <LogOut /> Sign out
      </MenuItem>
    </Menu>
  );
}

function Notifications({ projectId }: { projectId: string }) {
  const notifications = useQuery({
    queryKey: ["notifications", projectId],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/notifications", { params: { path: { projectId }, query: { limit: 20 } } }),
      ),
    refetchInterval: 60_000,
  });
  const markRead = useProjectMutation(projectId, () =>
    unwrap(api.POST("/api/projects/{projectId}/notifications/read", { params: { path: { projectId } }, body: {} })),
  );
  const unread = notifications.data?.items.filter((n) => !n.readAt).length ?? 0;
  return (
    <Menu
      align="start"
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
      <div className="max-h-96 w-80 overflow-y-auto">
        {notifications.data?.items.length ? null : <p className="p-3 text-sm text-muted-foreground">Nothing new.</p>}
        {notifications.data?.items.map((n) => (
          <div key={n.id} className={cn("rounded px-2 py-1.5 text-sm", !n.readAt && "bg-accent/50")}>
            <p>{n.message}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
          </div>
        ))}
        {unread ? (
          <MenuItem onSelect={() => markRead.mutate(undefined)} className="justify-center text-primary">
            Mark all as read
          </MenuItem>
        ) : null}
      </div>
    </Menu>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  FileText,
  KanbanSquare,
  LogOut,
  Network,
  Settings,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { type CSSProperties, type FormEvent, type PointerEvent, type ReactNode, useEffect, useState } from "react";
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
import { cn, formatDateTime } from "@/lib/utils";

const NAV = [
  { to: "/p/$projectId", label: "Pipeline", icon: KanbanSquare, exact: true },
  { to: "/p/$projectId/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/p/$projectId/organizations", label: "Organizations", icon: Building2 },
  { to: "/p/$projectId/contacts", label: "Contacts", icon: Users },
  { to: "/p/$projectId/graph", label: "Action graph", icon: Network },
  { to: "/p/$projectId/documents", label: "Documents", icon: FileText },
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
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-muted/30 p-3 md:flex">
        <Link
          to="/projects"
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3" /> All projects
        </Link>
        <div className="mb-4 truncate px-2 font-semibold" title={project.data?.name}>
          {project.data?.name}
        </div>
        <nav className="grid gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              params={{ projectId }}
              activeOptions={{ exact: "exact" in item }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "bg-muted text-foreground font-medium" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto text-xs text-muted-foreground">Your role: {project.data?.role}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
          <form onSubmit={search} className="flex-1">
            <Input
              className="max-w-md"
              placeholder="Search organizations, positions, people, actions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <MobileNav projectId={projectId} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Assistant"
            aria-pressed={assistantOpen}
            title="Assistant (Ctrl+J)"
            className={cn(assistantOpen && "bg-muted")}
            onClick={() => toggleAssistant()}
          >
            <Sparkles />
          </Button>
          <Notifications projectId={projectId} />
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label="Account">
                <UserRound />
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

function MobileNav({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  return (
    <div className="md:hidden">
      <Menu
        trigger={
          <Button variant="outline" size="sm">
            Menu
          </Button>
        }
      >
        {NAV.map((item) => (
          <MenuItem key={item.to} onSelect={() => navigate({ to: item.to, params: { projectId } })}>
            <item.icon /> {item.label}
          </MenuItem>
        ))}
      </Menu>
    </div>
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

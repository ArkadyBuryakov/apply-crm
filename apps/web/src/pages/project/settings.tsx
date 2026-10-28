import { ACTION_TYPES } from "@crm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Copy, Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { api, type Stage, unwrap, uploadForm } from "@/lib/api";
import { clearLastProject } from "@/lib/last-project";
import {
  invalidateProject,
  useCan,
  useChannels,
  useMe,
  useMembers,
  useProject,
  useProjectMutation,
  useStages,
} from "@/lib/queries";
import { humanize } from "@/lib/utils";

const CHANNEL_KINDS = ["email", "phone", "linkedin", "job_board", "careers_site", "messenger", "other"] as const;

export function SettingsPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/settings" });
  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader title="Settings" />
      <GeneralSection projectId={projectId} />
      <McpSection projectId={projectId} />
      <MembersSection projectId={projectId} />
      <StagesSection projectId={projectId} />
      <ChannelsSection projectId={projectId} />
      <DataSection projectId={projectId} />
    </div>
  );
}

function GeneralSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const project = useProject(projectId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(project.data?.name ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rename = useProjectMutation(
    projectId,
    () => unwrap(api.PATCH("/api/projects/{projectId}", { params: { path: { projectId } }, body: { name } })),
    { success: "Renamed", onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }) },
  );
  const remove = useProjectMutation(
    projectId,
    () => unwrap(api.DELETE("/api/projects/{projectId}", { params: { path: { projectId } } })),
    {
      success: "Project deleted",
      onSuccess: async () => {
        clearLastProject(projectId);
        await qc.invalidateQueries({ queryKey: ["projects"] });
        navigate({ to: "/projects" });
      },
    },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex max-w-md gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!can("project:update")}
            aria-label="Project name"
          />
          {can("project:update") ? (
            <Button variant="outline" disabled={!name || rename.isPending} onClick={() => rename.mutate(undefined)}>
              Rename
            </Button>
          ) : null}
        </div>
        {can("organization:delete") ? (
          <div>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete project
            </Button>
          </div>
        ) : null}
      </CardContent>
      {confirmDelete ? (
        <Dialog
          open
          onOpenChange={setConfirmDelete}
          title="Delete this project?"
          description="All positions, contacts, actions and documents are deleted for every member. Export first if you want a copy."
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate(undefined)}>
              Delete forever
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function McpSection({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const url = project.data?.mcpUrl ?? "";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI assistant (MCP)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Add this URL as a remote MCP server in Claude, ChatGPT or your IDE. You will be asked to sign in and allow
          access; the assistant can then do what your role in this project allows.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" aria-label="MCP URL" />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast.success("Copied");
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
        <p className="text-muted-foreground">
          For scripts or clients without OAuth, send a personal API key as a bearer token. Create one on your{" "}
          <Link to="/account" className="text-primary hover:underline">
            account page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function MembersSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const me = useMe();
  const members = useMembers(projectId);
  const invitations = useQuery({
    queryKey: ["invitations", projectId],
    enabled: can("membership:read"),
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/invitations", { params: { path: { projectId } } }))).items,
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "commenter" | "viewer">("viewer");
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const navigate = useNavigate();

  const invite = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/invitations", { params: { path: { projectId } }, body: { email, role } }),
      ),
    {
      success: "Invitation created. Ask them to sign up or sign in with that email.",
      onSuccess: () => setEmail(""),
    },
  );
  const changeRole = useProjectMutation(
    projectId,
    ({ userId, role }: { userId: string; role: "editor" | "commenter" | "viewer" }) =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/members/{userId}", {
          params: { path: { projectId, userId } },
          body: { role },
        }),
      ),
  );
  const removeMember = useProjectMutation(projectId, (userId: string) =>
    unwrap(api.DELETE("/api/projects/{projectId}/members/{userId}", { params: { path: { projectId, userId } } })),
  );
  const cancel = useProjectMutation(projectId, (invitationId: string) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/invitations/{invitationId}", {
        params: { path: { projectId, invitationId } },
      }),
    ),
  );
  const transfer = useProjectMutation(
    projectId,
    (userId: string) =>
      unwrap(
        api.POST("/api/projects/{projectId}/transfer-ownership", { params: { path: { projectId } }, body: { userId } }),
      ),
    { success: "Ownership transferred", onSuccess: () => setTransferTo(null) },
  );
  const leave = useProjectMutation(
    projectId,
    () => unwrap(api.POST("/api/projects/{projectId}/leave", { params: { path: { projectId } } })),
    {
      success: "You left the project",
      onSuccess: () => {
        clearLastProject(projectId);
        navigate({ to: "/projects" });
      },
    },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Everyone in the project sees all of it, including salaries and other offers. Use a separate project to share
          less.
        </p>
        <div className="grid gap-2">
          {members.data?.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{m.name}</span> <span className="text-muted-foreground">{m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {m.role === "owner" || !can("membership:manage") ? (
                  <span className="text-muted-foreground">{humanize(m.role)}</span>
                ) : (
                  <Select
                    className="h-8 w-36"
                    value={m.role}
                    onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as "editor" })}
                    aria-label={`Role of ${m.name}`}
                  >
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                )}
                {can("project:transfer") && m.role !== "owner" ? (
                  <Button size="sm" variant="ghost" onClick={() => setTransferTo(m.userId)}>
                    Make owner
                  </Button>
                ) : null}
                {can("membership:manage") && m.role !== "owner" ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => removeMember.mutate(m.userId)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
                {m.userId === me.data?.id && m.role !== "owner" ? (
                  <Button size="sm" variant="outline" onClick={() => leave.mutate(undefined)}>
                    Leave
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        {can("membership:manage") ? (
          <>
            {invitations.data?.length ? (
              <div className="grid gap-1 text-sm">
                <span className="font-medium">Pending invitations</span>
                {invitations.data.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between">
                    <span>
                      {inv.email} <span className="text-muted-foreground">as {inv.role}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(inv.id)}>
                      Cancel
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-xs"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select
                className="w-36"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                aria-label="Role"
              >
                <option value="editor">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
              </Select>
              <Button disabled={!email || invite.isPending} onClick={() => invite.mutate(undefined)}>
                Invite
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
      {transferTo ? (
        <Dialog
          open
          onOpenChange={() => setTransferTo(null)}
          title="Transfer ownership?"
          description="They become the owner; you become an editor. Only the new owner can undo this."
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTransferTo(null)}>
              Cancel
            </Button>
            <Button onClick={() => transfer.mutate(transferTo)}>Transfer</Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function StagesSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const stages = useStages(projectId);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const update = useProjectMutation(
    projectId,
    ({ stage, body }: { stage: Stage; body: { label?: string; order?: number; suggestOnActionTypes?: string[] } }) =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/stages/{stageId}", {
          params: { path: { projectId, stageId: stage.id } },
          body: { ...(body as { label?: string }), version: stage.version },
        }),
      ),
  );
  const create = useProjectMutation(
    projectId,
    () =>
      unwrap(api.POST("/api/projects/{projectId}/stages", { params: { path: { projectId } }, body: { key, label } })),
    {
      onSuccess: () => {
        setKey("");
        setLabel("");
      },
    },
  );
  const remove = useProjectMutation(projectId, (stage: Stage) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/stages/{stageId}", {
        params: { path: { projectId, stageId: stage.id }, query: { version: stage.version } },
      }),
    ),
  );
  const list = stages.data ?? [];

  async function swap(i: number, j: number) {
    const a = list[i];
    const b = list[j];
    if (!a || !b) return;
    await update.mutateAsync({ stage: a, body: { order: b.order } });
    await update.mutateAsync({ stage: b, body: { order: a.order } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline stages</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {list.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Input
              className="w-48"
              defaultValue={s.label}
              disabled={!can("stage:update")}
              onBlur={(e) => e.target.value !== s.label && update.mutate({ stage: s, body: { label: e.target.value } })}
              aria-label={`Label of ${s.key}`}
            />
            <span className="w-28 font-mono text-xs text-muted-foreground">{s.key}</span>
            <Select
              className="h-8 w-48 text-xs"
              title="Logging a done action of this type suggests moving the position here"
              value={s.suggestOnActionTypes[0] ?? ""}
              disabled={!can("stage:update")}
              onChange={(e) =>
                update.mutate({ stage: s, body: { suggestOnActionTypes: e.target.value ? [e.target.value] : [] } })
              }
              aria-label="Suggest when"
            >
              <option value="">No suggestion</option>
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  On {humanize(t).toLowerCase()}
                </option>
              ))}
            </Select>
            {can("stage:update") ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={i === 0}
                  onClick={() => swap(i, i - 1)}
                  aria-label="Move up"
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={i === list.length - 1}
                  onClick={() => swap(i, i + 1)}
                  aria-label="Move down"
                >
                  <ArrowDown />
                </Button>
              </>
            ) : null}
            {can("stage:delete") ? (
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(s)} aria-label={`Delete ${s.label}`}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ))}
        {can("stage:create") ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              className="w-40"
              placeholder="key (e.g. final_round)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Input className="w-48" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button
              variant="outline"
              disabled={!key || !label || create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              Add stage
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChannelsSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const channels = useChannels(projectId);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof CHANNEL_KINDS)[number]>("other");
  const create = useProjectMutation(
    projectId,
    () =>
      unwrap(api.POST("/api/projects/{projectId}/channels", { params: { path: { projectId } }, body: { name, kind } })),
    { onSuccess: () => setName("") },
  );
  const remove = useProjectMutation(projectId, ({ id, version }: { id: string; version: number }) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/channels/{channelId}", {
        params: { path: { projectId, channelId: id }, query: { version } },
      }),
    ),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          {channels.data?.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
              {c.name} <span className="text-muted-foreground">({humanize(c.kind)})</span>
              {can("channel:delete") ? (
                <button
                  type="button"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => remove.mutate(c)}
                  aria-label={`Delete ${c.name}`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {can("channel:create") ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Input className="w-48" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select
              className="w-40"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              aria-label="Kind"
            >
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </Select>
            <Button variant="outline" disabled={!name || create.isPending} onClick={() => create.mutate(undefined)}>
              Add channel
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DataSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function importFile(path: string, files: FileList | null, summarize: (r: Record<string, number>) => string) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const result = await uploadForm<Record<string, number>>(path, form);
      toast.success(summarize(result));
      await invalidateProject(qc, projectId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  if (!can("data:export") && !can("data:import")) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Export and import</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {can("data:export") ? (
          <div>
            <Button variant="outline" asChild>
              <a href={`/api/projects/${projectId}/export`}>
                <Download /> Export everything (.zip)
              </a>
            </Button>
          </div>
        ) : null}
        {can("data:import") ? (
          <div className="flex flex-wrap gap-2">
            <Field label="Import an export archive" hint="Adds its contents to this project with new IDs">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 hover:bg-muted">
                <Upload className="size-4" /> Choose .zip
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) =>
                    importFile(
                      `/api/projects/${projectId}/import`,
                      e.target.files,
                      (r) => `Imported ${r.positions} positions and ${r.actions} actions`,
                    )
                  }
                />
              </label>
            </Field>
            <Field
              label="Import positions from CSV"
              hint="Columns: title, company, agency, url, stage, outcome, salary_min, salary_max, currency, notes"
            >
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 hover:bg-muted">
                <Upload className="size-4" /> Choose .csv
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) =>
                    importFile(
                      `/api/projects/${projectId}/import/positions.csv`,
                      e.target.files,
                      (r) => `Imported ${r.positions} positions`,
                    )
                  }
                />
              </label>
            </Field>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

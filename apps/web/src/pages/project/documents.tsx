// Documents (ADR 0006, 0025): main and tailored resumes as LaTeX versions compiled by the worker, uploads for
// everything else, and LaTeX templates holding shared files such as .cls.

import { DOCUMENT_KINDS, type DocumentKind } from "@crm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Download, FileUp, Pencil, Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type DocumentT, type Schemas, unwrap, uploadForm } from "@/lib/api";
import { invalidateProject, useCan, useMe, usePositions, useProjectMutation } from "@/lib/queries";
import { cn, formatDateTime, humanize } from "@/lib/utils";

const COMPILE_TONE = { queued: "neutral", running: "primary", ready: "success", failed: "danger" } as const;

function useDocuments(projectId: string, query: { main?: "true"; positionId?: string } = {}) {
  return useQuery({
    queryKey: ["documents", projectId, query],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/documents", { params: { path: { projectId }, query } }))).items,
  });
}

function useTemplates(projectId: string) {
  return useQuery({
    queryKey: ["templates", projectId],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/templates", { params: { path: { projectId } } }))).items,
  });
}

export function DocumentsPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/documents" });
  const can = useCan(projectId);
  const docs = useDocuments(projectId);
  const positions = usePositions(projectId);
  const [creating, setCreating] = useState(false);
  const main = docs.data?.filter((d) => !d.positionId) ?? [];
  const tailored = docs.data?.filter((d) => d.positionId) ?? [];
  const positionTitle = (id: string | null) => positions.data?.find((p) => p.id === id)?.title ?? "Position";

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Every version is kept; actions record exactly which version was sent."
        actions={
          can("document:create") ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New document
            </Button>
          ) : null
        }
      />
      {docs.isLoading ? <Loading /> : null}
      <div className="grid gap-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Main documents</h2>
          {main.length === 0 ? <EmptyState title="No main documents">Start with your main resume.</EmptyState> : null}
          <DocumentList projectId={projectId} docs={main} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold">Tailored for positions</h2>
          {tailored.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          <DocumentList projectId={projectId} docs={tailored} label={(d) => positionTitle(d.positionId)} />
        </section>
        <TemplatesSection projectId={projectId} />
      </div>
      {creating ? <CreateDocumentDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function DocumentList({
  projectId,
  docs,
  label,
}: {
  projectId: string;
  docs: DocumentT[];
  label?: (d: DocumentT) => string;
}) {
  return (
    <div className="grid gap-2">
      {docs.map((d) => {
        const latest = d.versions[0];
        return (
          <Link key={d.id} to="/p/$projectId/documents/$documentId" params={{ projectId, documentId: d.id }}>
            <Card className="hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>
                  <span className="font-medium">{d.title}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {humanize(d.kind)}
                    {label ? ` · ${label(d)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {latest ? `v${latest.versionNo} · ${formatDateTime(latest.createdAt)}` : "no versions"}
                  {latest?.compileStatus ? (
                    <Badge tone={COMPILE_TONE[latest.compileStatus]}>{latest.compileStatus}</Badge>
                  ) : null}
                </span>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function CreateDocumentDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const positions = usePositions(projectId);
  const mainDocs = useDocuments(projectId, { main: "true" });
  const [kind, setKind] = useState<DocumentKind>("resume");
  const [title, setTitle] = useState("");
  const [positionId, setPositionId] = useState("");
  const [derivedFromVersionId, setDerivedFrom] = useState("");
  // Follows the suggestion until the user types their own.
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const me = useMe();
  const suggestedName = (() => {
    if (!positionId) return me.data?.name ?? "";
    const based = mainDocs.data?.find((d) => d.versions.some((v) => v.id === derivedFromVersionId));
    const pos = positions.data?.find((p) => p.id === positionId);
    return [based?.downloadName ?? me.data?.name, pos?.company?.name, pos?.title].filter(Boolean).join(" - ");
  })();
  const mainVersions =
    mainDocs.data?.flatMap((d) => d.versions.map((v) => ({ id: v.id, label: `${d.title} v${v.versionNo}` }))) ?? [];
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/documents", {
          params: { path: { projectId } },
          body: {
            kind,
            title,
            downloadName: (downloadName ?? suggestedName).trim() || undefined,
            positionId: positionId || null,
            derivedFromVersionId: derivedFromVersionId || null,
          },
        }),
      ),
    {
      onSuccess: (d) => {
        onClose();
        navigate({ to: "/p/$projectId/documents/$documentId", params: { projectId, documentId: d.id } });
      },
    },
  );
  return (
    <Dialog open onOpenChange={onClose} title="New document">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Main resume" />
        </Field>
        <Field label="Tailored for" hint="Leave empty for a main document" className="sm:col-span-2">
          <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">— main document —</option>
            {positions.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.company ? ` — ${p.company.name}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {positionId ? (
          <Field label="Based on" className="sm:col-span-2">
            <Select value={derivedFromVersionId} onChange={(e) => setDerivedFrom(e.target.value)}>
              <option value="">—</option>
              {mainVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Download name" hint="File name for downloads, without the extension" className="sm:col-span-2">
          <Input value={downloadName ?? suggestedName} onChange={(e) => setDownloadName(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title || save.isPending} onClick={() => save.mutate(undefined)}>
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TemplatesSection({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const qc = useQueryClient();
  const templates = useTemplates(projectId);
  const [name, setName] = useState("");
  const create = useProjectMutation(
    projectId,
    () => unwrap(api.POST("/api/projects/{projectId}/templates", { params: { path: { projectId } }, body: { name } })),
    { success: "Template created", onSuccess: () => setName("") },
  );

  async function uploadVersion(templateId: string, files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    try {
      await uploadForm(`/api/projects/${projectId}/templates/${templateId}/versions`, form);
      toast.success("New template version uploaded");
      await invalidateProject(qc, projectId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">LaTeX templates</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Shared files (.cls, fonts, images) compiled next to your .tex. Upload the complete set as a new version;
        document versions pin the template version they were compiled with.
      </p>
      <div className="grid gap-2">
        {templates.data?.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span>
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {t.versions.length
                    ? `v${t.versions[0]!.versionNo}: ${t.versions[0]!.files.map((f) => f.name).join(", ")}`
                    : "no files yet"}
                </span>
              </span>
              {can("template:update") ? (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted">
                  <Upload className="size-3.5" /> Upload files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => uploadVersion(t.id, e.target.files)}
                  />
                </label>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {can("template:create") ? (
        <div className="mt-3 flex max-w-md gap-2">
          <Input placeholder="New template name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" disabled={!name || create.isPending} onClick={() => create.mutate(undefined)}>
            Add
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type VersionDetail = Schemas["DocumentVersion"];

export function DocumentDetailPage() {
  const { projectId, documentId } = useParams({ from: "/authed/p/$projectId/documents/$documentId" });
  const can = useCan(projectId);
  const qc = useQueryClient();
  const templates = useTemplates(projectId);
  const positions = usePositions(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);

  const doc = useQuery({
    queryKey: ["document", projectId, documentId],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/documents/{documentId}", { params: { path: { projectId, documentId } } }),
      ),
    // Keep polling while a compile is in progress.
    refetchInterval: (q) =>
      q.state.data?.versions.some((v) => v.compileStatus === "queued" || v.compileStatus === "running") ? 2000 : false,
  });
  const versionId = selected ?? doc.data?.versions[0]?.id ?? null;
  const version = useQuery({
    queryKey: [
      "document-version",
      projectId,
      documentId,
      versionId,
      doc.data?.versions.find((v) => v.id === versionId)?.compileStatus,
    ],
    enabled: Boolean(versionId),
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/documents/{documentId}/versions/{versionId}", {
          params: { path: { projectId, documentId, versionId: versionId! } },
        }),
      ),
  });
  const recompile = useProjectMutation(projectId, () =>
    unwrap(
      api.POST("/api/projects/{projectId}/documents/{documentId}/versions/{versionId}/compile", {
        params: { path: { projectId, documentId, versionId: versionId! } },
      }),
    ),
  );

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const v = await uploadForm<VersionDetail>(
        `/api/projects/${projectId}/documents/${documentId}/versions/upload`,
        form,
      );
      toast.success(`Uploaded as version ${v.versionNo}`);
      setSelected(v.id);
      await invalidateProject(qc, projectId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  if (doc.isLoading) return <Loading />;
  if (!doc.data) return <EmptyState title="Document not found" />;
  const d = doc.data;
  const base = `/api/projects/${projectId}/documents/${documentId}/versions`;
  const v = version.data;

  return (
    <div>
      <PageHeader
        title={d.title}
        subtitle={
          <>
            {humanize(d.kind)}
            {d.positionId ? (
              <>
                {" "}
                · for{" "}
                <Link
                  to="/p/$projectId/positions/$positionId"
                  params={{ projectId, positionId: d.positionId }}
                  className="hover:underline"
                >
                  {positions.data?.find((p) => p.id === d.positionId)?.title ?? "position"}
                </Link>
              </>
            ) : null}
            {d.downloadName ? <> · downloads as “{d.downloadName}”</> : null}
          </>
        }
        actions={
          can("document:update") ? (
            <>
              <Button variant="outline" onClick={() => setEditingDetails(true)}>
                <Pencil /> Rename
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Plus /> New LaTeX version
              </Button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-muted">
                <FileUp className="size-4" /> Upload file
                <input type="file" className="hidden" onChange={(e) => upload(e.target.files)} />
              </label>
            </>
          ) : null
        }
      />
      {d.versions.length === 0 ? (
        <EmptyState title="No versions yet">Add LaTeX source or upload a file.</EmptyState>
      ) : null}
      {d.versions.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Versions</CardTitle>
            </CardHeader>
            <div className="grid p-1">
              {d.versions.map((ver) => (
                <button
                  key={ver.id}
                  type="button"
                  onClick={() => setSelected(ver.id)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                    ver.id === versionId && "bg-muted font-medium",
                  )}
                >
                  <span>
                    v{ver.versionNo} <span className="text-xs text-muted-foreground">{ver.format}</span>
                  </span>
                  {ver.compileStatus ? <Badge tone={COMPILE_TONE[ver.compileStatus]}>{ver.compileStatus}</Badge> : null}
                </button>
              ))}
            </div>
          </Card>
          {v ? (
            <div className="grid min-w-0 grid-cols-1 gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {v.filename} · {Math.ceil(v.size / 1024)} KB · {formatDateTime(v.createdAt)}
                </span>
                <Button variant="outline" size="sm" asChild>
                  <a href={`${base}/${v.id}/file`}>
                    <Download /> {v.format === "latex" ? ".tex" : "File"}
                  </a>
                </Button>
                {v.hasPdf ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`${base}/${v.id}/pdf`} target="_blank" rel="noreferrer">
                      <Download /> PDF
                    </a>
                  </Button>
                ) : null}
                {v.format === "latex" && can("document:update") ? (
                  <Button variant="ghost" size="sm" onClick={() => recompile.mutate(undefined)}>
                    <RefreshCw /> Compile again
                  </Button>
                ) : null}
              </div>
              <Preview
                projectId={projectId}
                documentId={documentId}
                version={v}
                pdfUrl={`${base}/${v.id}/pdf`}
                editable={can("document:update")}
                onCreated={(id) => setSelected(id)}
              />
            </div>
          ) : (
            <Loading />
          )}
        </div>
      ) : null}
      {editingDetails ? (
        <DocumentDetailsDialog projectId={projectId} doc={d} onClose={() => setEditingDetails(false)} />
      ) : null}
      {editing ? (
        <LatexEditor
          projectId={projectId}
          documentId={documentId}
          initial={v?.source ?? ""}
          initialTemplateVersionId={v?.templateVersionId ?? templates.data?.[0]?.versions[0]?.id ?? ""}
          initialFilename={v?.format === "latex" ? v.filename : "main.tex"}
          templates={templates.data ?? []}
          onClose={() => setEditing(false)}
          onCreated={(id) => setSelected(id)}
        />
      ) : null}
    </div>
  );
}

function DocumentDetailsDialog({
  projectId,
  doc,
  onClose,
}: {
  projectId: string;
  doc: DocumentT;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [downloadName, setDownloadName] = useState(doc.downloadName ?? "");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/documents/{documentId}", {
          params: { path: { projectId, documentId: doc.id } },
          body: { title, downloadName: downloadName.trim() || null, version: doc.version },
        }),
      ),
    { success: "Document updated", onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={onClose} title="Rename document">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field
          label="Download name"
          hint="File name for downloads, without the extension. Empty uses each version's own file name."
        >
          <Input value={downloadName} onChange={(e) => setDownloadName(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type PreviewTab = "pdf" | "source" | "log";

/**
 * A version's formats as tabs: the PDF, the LaTeX source and the compile log, each when the version has it. A tab the
 * user picked stays selected across versions that have it; otherwise the PDF comes first.
 */
function Preview({
  projectId,
  documentId,
  version,
  pdfUrl,
  editable,
  onCreated,
}: {
  projectId: string;
  documentId: string;
  version: VersionDetail;
  pdfUrl: string;
  editable: boolean;
  onCreated: (versionId: string) => void;
}) {
  const [picked, setPicked] = useState<PreviewTab | null>(null);
  const available: PreviewTab[] = [
    ...(version.hasPdf ? (["pdf"] as const) : []),
    ...(version.source !== null ? (["source"] as const) : []),
    ...(version.compileLog ? (["log"] as const) : []),
  ];
  // A failed compile has no PDF; its log explains why, so it comes before the source.
  const fallback = version.compileStatus === "failed" && available.includes("log") ? "log" : available[0];
  const tab = picked && available.includes(picked) ? picked : fallback;
  if (!tab) return null;

  return (
    <Tabs value={tab} onValueChange={(value) => setPicked(value as PreviewTab)}>
      <TabsList>
        {available.includes("pdf") ? <TabsTrigger value="pdf">PDF</TabsTrigger> : null}
        {available.includes("source") ? <TabsTrigger value="source">Source</TabsTrigger> : null}
        {available.includes("log") ? (
          <TabsTrigger value="log" className={cn(version.compileStatus === "failed" && "text-destructive")}>
            Compile log
          </TabsTrigger>
        ) : null}
      </TabsList>
      {available.includes("pdf") ? (
        <TabsContent value="pdf">
          <iframe title="PDF preview" src={pdfUrl} className="h-[75vh] w-full rounded-lg border border-border" />
        </TabsContent>
      ) : null}
      {version.source !== null ? (
        // Kept mounted so an unsaved edit survives a look at the PDF.
        <TabsContent value="source" forceMount className="data-[state=inactive]:hidden">
          <SourceEditor
            key={version.id}
            projectId={projectId}
            documentId={documentId}
            version={version}
            source={version.source}
            editable={editable}
            onCreated={onCreated}
          />
        </TabsContent>
      ) : null}
      {available.includes("log") ? (
        <TabsContent value="log">
          <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-4 text-xs">
            {version.compileLog}
          </pre>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

/** The LaTeX source of a version, edited in place; saving adds a new version with the same template and file name. */
function SourceEditor({
  projectId,
  documentId,
  version,
  source,
  editable,
  onCreated,
}: {
  projectId: string;
  documentId: string;
  version: VersionDetail;
  source: string;
  editable: boolean;
  onCreated: (versionId: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/documents/{documentId}/versions/latex", {
          params: { path: { projectId, documentId } },
          body: { source: draft!, templateVersionId: version.templateVersionId, filename: version.filename },
        }),
      ),
    { success: "Saved as a new version; compiling…", onSuccess: (v) => onCreated(v.id) },
  );
  return (
    <div className="grid gap-2">
      {editable ? (
        <div className="flex justify-end gap-2">
          {draft !== null ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || draft === source || save.isPending}
                onClick={() => save.mutate(undefined)}
              >
                Save as new version
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDraft(source)}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      ) : null}
      {draft !== null ? (
        <Textarea
          aria-label="LaTeX source"
          className="min-h-[70vh] font-mono text-xs"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-4 text-xs">
          {source}
        </pre>
      )}
    </div>
  );
}

function LatexEditor({
  projectId,
  documentId,
  initial,
  initialTemplateVersionId,
  initialFilename,
  templates,
  onClose,
  onCreated,
}: {
  projectId: string;
  documentId: string;
  initial: string;
  initialTemplateVersionId: string;
  initialFilename: string;
  templates: Schemas["Template"][];
  onClose: () => void;
  onCreated: (versionId: string) => void;
}) {
  const [source, setSource] = useState(initial);
  const [templateVersionId, setTemplateVersionId] = useState(initialTemplateVersionId);
  const [filename, setFilename] = useState(initialFilename);
  useEffect(() => setSource(initial), [initial]);
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/documents/{documentId}/versions/latex", {
          params: { path: { projectId, documentId } },
          body: { source, templateVersionId: templateVersionId || null, filename },
        }),
      ),
    {
      success: "Saved; compiling…",
      onSuccess: (v) => {
        onCreated(v.id);
        onClose();
      },
    },
  );
  return (
    <Dialog open onOpenChange={onClose} title="New LaTeX version" className="w-[min(1000px,calc(100vw-2rem))]">
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template version">
            <Select value={templateVersionId} onChange={(e) => setTemplateVersionId(e.target.value)}>
              <option value="">None</option>
              {templates.flatMap((t) =>
                t.versions.map((tv) => (
                  <option key={tv.id} value={tv.id}>
                    {t.name} v{tv.versionNo}
                  </option>
                )),
              )}
            </Select>
          </Field>
          <Field label="File name">
            <Input value={filename} onChange={(e) => setFilename(e.target.value)} />
          </Field>
        </div>
        <Textarea
          className="min-h-[55vh] font-mono text-xs"
          spellCheck={false}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="\documentclass{resume}…"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!source.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
            Save and compile
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// Assistant memory (ADR 0032): what agents saved about the user and about the project, viewable and editable here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/assistant/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Loading } from "@/components/ui/misc";
import { ApiError, api, type Schemas, unwrap } from "@/lib/api";
import { errorMessage, useCan, useProjectMutation } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

type Memory = Schemas["UserMemory"] | Schemas["ProjectMemory"];
type Draft = { title: string; content: string };
/** `memory` is null when creating. */
type SaveArgs = { memory: Memory | null; draft: Draft };

/** Query key for the user's memories; not project-scoped, so the assistant panel invalidates it explicitly. */
export const USER_MEMORIES_KEY = ["user-memories"] as const;

export function UserMemoryCard() {
  const qc = useQueryClient();
  const memories = useQuery({
    queryKey: USER_MEMORIES_KEY,
    queryFn: async () => (await unwrap(api.GET("/api/me/memories"))).items,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: USER_MEMORIES_KEY });
  const onError = async (e: unknown) => {
    if (e instanceof ApiError && e.status === 412) await refresh();
    toast.error(errorMessage(e));
  };
  const save = useMutation({
    mutationFn: ({ memory, draft }: SaveArgs) =>
      memory
        ? unwrap(
            api.PATCH("/api/me/memories/{memoryId}", {
              params: { path: { memoryId: memory.id } },
              body: { ...draft, version: memory.version },
            }),
          )
        : unwrap(api.POST("/api/me/memories", { body: draft })),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (memory: Memory) =>
      unwrap(
        api.DELETE("/api/me/memories/{memoryId}", {
          params: { path: { memoryId: memory.id }, query: { version: memory.version } },
        }),
      ),
    onSuccess: refresh,
    onError,
  });
  return (
    <MemoryCard
      title="Your memory"
      description="About you, private to you, and used in all of your projects: background, preferences, writing style."
      items={memories.data}
      canEdit
      onSave={(args) => save.mutateAsync(args)}
      onDelete={(memory) => remove.mutateAsync(memory)}
    />
  );
}

export function ProjectMemoryCard({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const memories = useQuery({
    queryKey: ["memories", projectId],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/memories", { params: { path: { projectId } } }))).items,
  });
  const save = useProjectMutation(projectId, ({ memory, draft }: SaveArgs) =>
    memory
      ? unwrap(
          api.PATCH("/api/projects/{projectId}/memories/{memoryId}", {
            params: { path: { projectId, memoryId: memory.id } },
            body: { ...draft, version: memory.version },
          }),
        )
      : unwrap(api.POST("/api/projects/{projectId}/memories", { params: { path: { projectId } }, body: draft })),
  );
  const remove = useProjectMutation(projectId, (memory: Memory) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/memories/{memoryId}", {
        params: { path: { projectId, memoryId: memory.id }, query: { version: memory.version } },
      }),
    ),
  );
  return (
    <MemoryCard
      title="Project memory"
      description="About this job search and shared with every member: goals, constraints, decisions."
      items={memories.data}
      canEdit={can("memory:create", "memory:update", "memory:delete")}
      onSave={(args) => save.mutateAsync(args)}
      onDelete={(memory) => remove.mutateAsync(memory)}
    />
  );
}

function MemoryCard({
  title,
  description,
  items,
  canEdit,
  onSave,
  onDelete,
}: {
  title: string;
  description: string;
  items: Memory[] | undefined;
  canEdit: boolean;
  onSave: (args: SaveArgs) => Promise<unknown>;
  onDelete: (memory: Memory) => Promise<unknown>;
}) {
  // undefined: no dialog; null: a new memory.
  const [editing, setEditing] = useState<Memory | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            <Plus /> Add
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">{description}</p>
        {items === undefined ? <Loading /> : null}
        {items?.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing saved yet. Ask the assistant to remember something, or add it here.
          </p>
        ) : null}
        {items?.map((memory) => (
          <article key={memory.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium">{memory.title}</h4>
                <p className="text-xs text-muted-foreground">Updated {formatDateTime(memory.updatedAt)}</p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label="Edit memory" onClick={() => setEditing(memory)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Delete memory" onClick={() => setDeleting(memory)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
            <Markdown text={memory.content} className="mt-2" />
          </article>
        ))}
      </CardContent>
      {editing !== undefined ? (
        <MemoryDialog
          memory={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (draft) => {
            await onSave({ memory: editing, draft });
            setEditing(undefined);
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog
          open
          onOpenChange={() => setDeleting(null)}
          title="Delete this memory?"
          description={`"${deleting.title}" will no longer be available to agents.`}
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await onDelete(deleting).catch(() => undefined);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function MemoryDialog({
  memory,
  onClose,
  onSave,
}: {
  memory: Memory | null;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
}) {
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await onSave({ title: title.trim(), content: content.trim() });
    } catch {
      // The mutation already reported the error; keep the dialog open with the draft.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose} title={memory ? "Edit memory" : "New memory"}>
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Title" hint="What the memory is about, in one line">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </Field>
        <Field label="Content" hint="Markdown">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={10_000}
            required
            className="min-h-48"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !title.trim() || !content.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

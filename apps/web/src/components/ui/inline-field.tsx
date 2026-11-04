// Read-first fields that switch to an editor on demand and save each change on their own.
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input, readOptions, Select, Textarea } from "@/components/ui/form";
import { ApiError } from "@/lib/api";
import { errorMessage, invalidateProject } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** How long a field stays green after it saved. */
const SAVED_MS = 1200;

/**
 * Saves partial updates of one versioned entity, one request at a time so each carries the version the previous
 * one returned. `current` is the entity as last saved (or as refetched, when that is newer); `stateOf(key)` tells
 * a field whether its save is running, done or failed.
 */
export function useInlineSave<T extends { version: number }, B>(
  projectId: string,
  entity: T,
  patch: (body: B, version: number) => Promise<T>,
) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(entity);
  if (entity.version > current.version) setCurrent(entity);
  const confirmed = useRef(entity);
  if (entity.version > confirmed.current.version) confirmed.current = entity;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(new Map<string, number>());
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const setState = (key: string, state: SaveState) => setStates((s) => ({ ...s, [key]: state }));

  function save(key: string, body: B, optimistic?: Partial<T>) {
    if (optimistic) setCurrent((c) => ({ ...c, ...optimistic }));
    pending.current.set(key, (pending.current.get(key) ?? 0) + 1);
    setState(key, "saving");
    const run = queue.current.then(async () => {
      try {
        const next = await patch(body, confirmed.current.version);
        confirmed.current = next;
        setCurrent(next);
        const left = (pending.current.get(key) ?? 1) - 1;
        pending.current.set(key, left);
        if (left === 0) {
          setState(key, "saved");
          setTimeout(() => setStates((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s)), SAVED_MS);
        }
        void invalidateProject(qc, projectId);
      } catch (error) {
        pending.current.set(key, (pending.current.get(key) ?? 1) - 1);
        setCurrent(confirmed.current);
        setState(key, "error");
        toast.error(errorMessage(error));
        if (error instanceof ApiError && error.status === 412) void invalidateProject(qc, projectId);
      }
    });
    queue.current = run;
    return run;
  }

  return { current, save, stateOf: (key: string): SaveState => states[key] ?? "idle" };
}

/**
 * A local draft of a value that saves itself once typing pauses, and right away on `flush` (blur, Done, unmount).
 * `start` resets the draft to the saved value when editing begins.
 */
export function useDraft<T>(value: T, save: (v: T) => void, delay = 800) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ value, save });
  latest.current = { value, save };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next && JSON.stringify(next.value) !== JSON.stringify(latest.current.value)) latest.current.save(next.value);
  }, []);
  useEffect(() => flush, [flush]);

  return {
    draft,
    change(v: T) {
      setDraft(v);
      pending.current = { value: v };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    flush,
    start() {
      pending.current = null;
      setDraft(value);
    },
  };
}

export function InlineField({
  label,
  state = "idle",
  canEdit = true,
  view,
  editor,
  onEdit,
  onDone,
  onBlur,
  className,
}: {
  label: ReactNode;
  state?: SaveState;
  canEdit?: boolean;
  /** What the field shows while not being edited; may hold links. */
  view: ReactNode;
  editor: ReactNode;
  onEdit?: () => void;
  onDone?: () => void;
  /** Called when focus leaves a control in the editor, e.g. to save a pending draft. */
  onBlur?: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("group/field grid gap-1", className)}>
      <div className="flex h-5 items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {canEdit && !editing ? (
          <button
            type="button"
            aria-label={typeof label === "string" ? `Edit ${label.toLowerCase()}` : "Edit"}
            title="Edit"
            className="cursor-pointer rounded p-0.5 opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/field:opacity-100"
            onClick={() => {
              onEdit?.();
              setEditing(true);
            }}
          >
            <Pencil className="size-3" />
          </button>
        ) : null}
        {editing ? (
          <button
            type="button"
            className="ml-auto inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-primary hover:bg-muted"
            onClick={() => {
              onDone?.();
              setEditing(false);
            }}
          >
            <Check className="size-3" /> Done
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "inline-field rounded-md",
          state !== "idle" && `inline-field-${state}`,
          !editing && "-mx-2 px-2 py-1",
        )}
      >
        {editing ? (
          <fieldset className="min-w-0" onBlur={onBlur}>
            {editor}
          </fieldset>
        ) : (
          <div className="min-h-5 text-sm">{view}</div>
        )}
      </div>
    </div>
  );
}

/** Placeholder for an empty value in read mode. */
export function Empty() {
  return <span className="text-muted-foreground">—</span>;
}

export function InlineText({
  label,
  value,
  onSave,
  state,
  canEdit,
  multiline,
  type = "text",
  required,
  placeholder,
  view,
  className,
}: {
  label: ReactNode;
  value: string;
  onSave: (v: string) => void;
  state?: SaveState;
  canEdit?: boolean;
  multiline?: boolean;
  type?: "text" | "url" | "number";
  /** Empty drafts are not saved and revert on Done. */
  required?: boolean;
  placeholder?: string;
  view?: ReactNode;
  className?: string;
}) {
  const draft = useDraft(value, (v) => {
    if (!required || v.trim()) onSave(v);
  });
  const shown =
    view ??
    (value ? (
      multiline ? (
        <p className="whitespace-pre-wrap">{value}</p>
      ) : type === "url" ? (
        <a href={value} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
          {value}
        </a>
      ) : (
        value
      )
    ) : (
      <Empty />
    ));
  const props = {
    autoFocus: true,
    value: draft.draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => draft.change(e.target.value),
    onBlur: draft.flush,
  };
  return (
    <InlineField
      label={label}
      state={state}
      canEdit={canEdit}
      className={className}
      view={shown}
      onEdit={draft.start}
      onDone={draft.flush}
      editor={
        multiline ? (
          <Textarea {...props} className="min-h-28" />
        ) : (
          <Input {...props} type={type} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        )
      }
    />
  );
}

export function InlineSelect({
  label,
  value,
  onSave,
  state,
  canEdit,
  view,
  className,
  children,
}: {
  label: ReactNode;
  value: string;
  onSave: (v: string) => void;
  state?: SaveState;
  canEdit?: boolean;
  /** Read-mode rendering; defaults to the chosen option's label. */
  view?: ReactNode;
  className?: string;
  /** <option> elements, as for Select. */
  children: ReactNode;
}) {
  return (
    <InlineField
      label={label}
      state={state}
      canEdit={canEdit}
      className={className}
      view={view ?? <SelectedLabel value={value}>{children}</SelectedLabel>}
      editor={
        <Select value={value} onChange={(e) => e.target.value !== value && onSave(e.target.value)}>
          {children}
        </Select>
      }
    />
  );
}

/** The label of the <option> child whose value is selected. */
function SelectedLabel({ value, children }: { value: string; children: ReactNode }) {
  const match = readOptions(children)
    .flatMap((g) => g.options)
    .find((o) => o.value === value);
  return match ? match.label : <Empty />;
}

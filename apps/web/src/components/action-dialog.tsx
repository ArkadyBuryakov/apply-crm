import { ACTION_TYPES, type ActionStatus, type ActionType, PARTICIPANT_ROLES, type ParticipantRole } from "@crm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ACTION_META, defaultPayload, type FieldSpec, PAYLOAD_FIELDS, statusesFor } from "@/lib/actions";
import { type Action, api, type Schemas, type Suggestion, unwrap } from "@/lib/api";
import {
  invalidateProject,
  useChannels,
  useContacts,
  useMembers,
  useOrganizations,
  usePositions,
  useProjectMutation,
} from "@/lib/queries";
import { fromLocalInput, humanize, toLocalInput } from "@/lib/utils";

type Subject = { positionId?: string; organizationId?: string };
type Participant = { contactId: string; role: ParticipantRole };

export type ActionDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this action; otherwise create a new one. */
  action?: Action;
  defaults?: { type?: ActionType; subjects?: Subject[]; participants?: Participant[]; title?: string };
  /** Link the new action to this one (previous → new) via logInteraction. */
  previousAction?: Pick<Action, "id" | "title">;
};

export function ActionDialog({ projectId, open, onOpenChange, action, defaults, previousAction }: ActionDialogProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<ActionType>(action?.type ?? defaults?.type ?? "meeting");
  const [title, setTitle] = useState(action?.title ?? defaults?.title ?? "");
  const [status, setStatus] = useState<ActionStatus>(action?.status ?? statusesFor(type)[0]!);
  const [notes, setNotes] = useState(action?.notes ?? "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(action?.scheduledAt));
  const [dueAt, setDueAt] = useState(toLocalInput(action?.dueAt));
  const [channelId, setChannelId] = useState(action?.channelId ?? "");
  const [assigneeId, setAssigneeId] = useState(action?.assigneeId ?? "");
  const [payload, setPayload] = useState<Record<string, unknown>>(action?.payload ?? defaultPayload(type));
  const [subjects, setSubjects] = useState<Subject[]>(
    (action?.subjects as Subject[] | undefined) ?? defaults?.subjects ?? [],
  );
  const [participants, setParticipants] = useState<Participant[]>(
    action?.participants.map((p) => ({ contactId: p.contactId, role: p.role })) ?? defaults?.participants ?? [],
  );
  const [attachments, setAttachments] = useState<string[]>(action?.attachments ?? []);
  const [linkPrevious, setLinkPrevious] = useState(Boolean(previousAction));

  function changeType(next: ActionType) {
    setType(next);
    setPayload(defaultPayload(next));
    const allowed = statusesFor(next);
    if (!allowed.includes(status)) setStatus(allowed[0]!);
  }

  const channels = useChannels(projectId);
  const members = useMembers(projectId);

  const save = useProjectMutation(
    projectId,
    async () => {
      const common = {
        title,
        status,
        notes: notes || null,
        scheduledAt: fromLocalInput(scheduledAt),
        dueAt: fromLocalInput(dueAt),
        channelId: channelId || null,
        assigneeId: assigneeId || null,
        subjects,
        participants,
        attachments,
      };
      if (action) {
        const res = await unwrap(
          api.PATCH("/api/projects/{projectId}/actions/{actionId}", {
            params: { path: { projectId, actionId: action.id } },
            body: { ...common, payload, version: action.version },
          }),
        );
        return res.suggestions;
      }
      const body = { ...common, type, payload } as Schemas["CreateAction"];
      if (previousAction && linkPrevious) {
        const res = await unwrap(
          api.POST("/api/projects/{projectId}/log-interaction", {
            params: { path: { projectId } },
            body: { action: body, previousActionId: previousAction.id, edgeKind: "follow_up" },
          }),
        );
        if (res.warnings.includes("cycle")) toast.warning("This link closes a cycle in the action graph.");
        return res.suggestions;
      }
      const res = await unwrap(
        api.POST("/api/projects/{projectId}/actions", { params: { path: { projectId } }, body }),
      );
      return res.suggestions;
    },
    {
      success: action ? "Action updated" : "Action saved",
      onSuccess: (suggestions) => {
        onOpenChange(false);
        for (const s of suggestions) offerSuggestion(projectId, s, () => invalidateProject(qc, projectId));
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(undefined);
  }

  const Icon = ACTION_META[type].icon;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4" />
          {action ? `Edit ${ACTION_META[type].label.toLowerCase()}` : "Log or plan an action"}
        </span>
      }
      className="w-[min(760px,calc(100vw-2rem))]"
    >
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!action ? (
            <Field label="Type">
              <Select value={type} onChange={(e) => changeType(e.target.value as ActionType)}>
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACTION_META[t].label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ActionStatus)}>
              {statusesFor(type).map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Intro call with recruiter"
            />
          </Field>
          <Field label="When">
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          <Field label="Due">
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Channel">
            <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">—</option>
              {channels.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Me</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {PAYLOAD_FIELDS[type].length ? (
          <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              {ACTION_META[type].label} details
            </legend>
            {PAYLOAD_FIELDS[type].map((f) => (
              <PayloadField
                key={f.key}
                spec={f}
                value={payload[f.key]}
                onChange={(v) => setPayload((p) => ({ ...p, [f.key]: v }))}
              />
            ))}
          </fieldset>
        ) : null}

        <SubjectsEditor projectId={projectId} value={subjects} onChange={setSubjects} />
        <ParticipantsEditor projectId={projectId} value={participants} onChange={setParticipants} />
        <AttachmentsEditor projectId={projectId} value={attachments} onChange={setAttachments} />

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {previousAction && !action ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={linkPrevious} onChange={(e) => setLinkPrevious(e.target.checked)} />
            Follows up on “{previousAction.title}”
          </label>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Shows a suggestion toast; accepting applies it to the position with its current version (ADR 0014). */
export function offerSuggestion(projectId: string, s: Suggestion, refresh: () => void) {
  const text =
    s.kind === "stage" ? `Move position to “${humanize(s.stageKey ?? "")}”?` : "Mark the position as rejected?";
  toast(text, {
    description: s.reason,
    duration: 12_000,
    action: {
      label: "Apply",
      onClick: async () => {
        try {
          const position = await unwrap(
            api.GET("/api/projects/{projectId}/positions/{positionId}", {
              params: { path: { projectId, positionId: s.positionId } },
            }),
          );
          await unwrap(
            api.PATCH("/api/projects/{projectId}/positions/{positionId}", {
              params: { path: { projectId, positionId: s.positionId } },
              body: {
                ...(s.kind === "stage" ? { stageId: s.stageId } : { outcome: s.outcome }),
                version: position.version,
              },
            }),
          );
          toast.success("Position updated");
          refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not update the position");
        }
      },
    },
  });
}

function PayloadField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const orUndefined = (v: string) => (v === "" ? undefined : v);
  switch (spec.kind) {
    case "text":
    case "url":
      return (
        <Field label={spec.label}>
          <Input
            type={spec.kind === "url" ? "url" : "text"}
            value={str(value)}
            onChange={(e) => onChange(orUndefined(e.target.value))}
          />
        </Field>
      );
    case "date":
      return (
        <Field label={spec.label}>
          <Input type="date" value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))} />
        </Field>
      );
    case "textarea":
      return (
        <Field label={spec.label} className="sm:col-span-2">
          <Textarea value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))} />
        </Field>
      );
    case "number":
      return (
        <Field label={spec.label}>
          <Input
            type="number"
            step={spec.step ?? 1}
            min={spec.min}
            max={spec.max}
            value={str(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case "select":
      return (
        <Field label={spec.label}>
          <Select value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))}>
            {!spec.required ? <option value="">—</option> : null}
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {humanize(o)}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "money": {
      const money = (value ?? {}) as { amount?: number; currency?: string; period?: string };
      const set = (patch: Partial<typeof money>) => {
        const next = { ...money, ...patch };
        onChange(next.amount === undefined && !spec.required ? undefined : next);
      };
      return (
        <Field label={spec.label} className="sm:col-span-2">
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              required={spec.required}
              placeholder="Amount"
              value={money.amount ?? ""}
              onChange={(e) => set({ amount: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
            <Input
              className="w-24"
              maxLength={3}
              placeholder="EUR"
              value={money.currency ?? ""}
              onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            />
            {spec.withPeriod ? (
              <Select className="w-32" value={money.period ?? "year"} onChange={(e) => set({ period: e.target.value })}>
                <option value="year">per year</option>
                <option value="month">per month</option>
                <option value="hour">per hour</option>
              </Select>
            ) : null}
          </div>
        </Field>
      );
    }
    case "checklist": {
      const items = (value as { text: string; done: boolean }[] | undefined) ?? [];
      return (
        <div className="grid gap-2 sm:col-span-2">
          <span className="text-sm font-medium">{spec.label}</span>
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: checklist rows have no identity
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
              />
              <Input
                value={item.text}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => onChange([...items, { text: "", done: false }])}
          >
            <Plus /> Add item
          </Button>
        </div>
      );
    }
  }
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="cursor-pointer text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function SubjectsEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: Subject[];
  onChange: (v: Subject[]) => void;
}) {
  const positions = usePositions(projectId);
  const orgs = useOrganizations(projectId);
  const label = (s: Subject) =>
    s.positionId
      ? (positions.data?.find((p) => p.id === s.positionId)?.title ?? "Position")
      : (orgs.data?.find((o) => o.id === s.organizationId)?.name ?? "Organization");
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">About</span>
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nothing specific (project-level)</span>
        ) : null}
        {value.map((s) => (
          <Chip
            key={s.positionId ?? s.organizationId}
            label={label(s)}
            onRemove={() => onChange(value.filter((x) => x !== s))}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value=""
          onChange={(e) => e.target.value && onChange([...value, { positionId: e.target.value }])}
          aria-label="Add position"
        >
          <option value="">+ Position…</option>
          {positions.data
            ?.filter((p) => !value.some((s) => s.positionId === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.company ? ` — ${p.company.name}` : ""}
              </option>
            ))}
        </Select>
        <Select
          value=""
          onChange={(e) => e.target.value && onChange([...value, { organizationId: e.target.value }])}
          aria-label="Add organization"
        >
          <option value="">+ Organization…</option>
          {orgs.data
            ?.filter((o) => !value.some((s) => s.organizationId === o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.kind})
              </option>
            ))}
        </Select>
      </div>
    </div>
  );
}

function ParticipantsEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: Participant[];
  onChange: (v: Participant[]) => void;
}) {
  const contacts = useContacts(projectId);
  const [role, setRole] = useState<ParticipantRole>("attendee");
  const name = (id: string) => contacts.data?.find((c) => c.id === id)?.name ?? "Contact";
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">People</span>
      <div className="flex flex-wrap gap-1.5">
        {value.map((p) => (
          <Chip
            key={`${p.contactId}:${p.role}`}
            label={`${name(p.contactId)} · ${humanize(p.role)}`}
            onRemove={() => onChange(value.filter((x) => x !== p))}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <Select
          value=""
          onChange={(e) => e.target.value && onChange([...value, { contactId: e.target.value, role }])}
          aria-label="Add person"
        >
          <option value="">+ Person…</option>
          {contacts.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.affiliations[0] ? ` — ${c.affiliations[0].organizationName}` : ""}
            </option>
          ))}
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value as ParticipantRole)} aria-label="Role">
          {PARTICIPANT_ROLES.map((r) => (
            <option key={r} value={r}>
              {humanize(r)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function AttachmentsEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const docs = useQuery({
    queryKey: ["documents", projectId, {}],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/documents", { params: { path: { projectId }, query: {} } })))
        .items,
  });
  const versions =
    docs.data?.flatMap((d) =>
      d.versions.map((v) => ({ id: v.id, label: `${d.title} · v${v.versionNo} (${v.filename})` })),
    ) ?? [];
  if (versions.length === 0 && value.length === 0) return null;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Documents sent or received</span>
      <div className="flex flex-wrap gap-1.5">
        {value.map((id) => (
          <Chip
            key={id}
            label={versions.find((v) => v.id === id)?.label ?? id}
            onRemove={() => onChange(value.filter((x) => x !== id))}
          />
        ))}
      </div>
      <Select
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        aria-label="Attach document version"
      >
        <option value="">+ Document version…</option>
        {versions
          .filter((v) => !value.includes(v.id))
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
      </Select>
    </div>
  );
}

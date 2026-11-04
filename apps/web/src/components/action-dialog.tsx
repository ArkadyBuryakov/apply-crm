import { ACTION_TYPES, type ActionStatus, type ActionType, PARTICIPANT_ROLES, type ParticipantRole } from "@crm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput, DateTimeInput } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  Empty,
  InlineField,
  InlineSelect,
  InlineText,
  type SaveState,
  useDraft,
  useInlineSave,
} from "@/components/ui/inline-field";
import { ACTION_META, defaultPayload, type FieldSpec, PAYLOAD_FIELDS, STATUS_TONE, statusesFor } from "@/lib/actions";
import { type Action, api, type Schemas, type Suggestion, unwrap } from "@/lib/api";
import {
  invalidateProject,
  useCan,
  useChannels,
  useContacts,
  useMembers,
  useOrganizations,
  usePositions,
  useProjectMutation,
} from "@/lib/queries";
import { formatDate, formatDateTime, formatMoney, fromLocalInput, humanize, toLocalInput } from "@/lib/utils";

type Subject = { positionId?: string; organizationId?: string };
type Participant = { contactId: string; role: ParticipantRole };

export type ActionDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show this action, its fields editable one by one; otherwise create a new one. */
  action?: Action;
  defaults?: { type?: ActionType; subjects?: Subject[]; participants?: Participant[]; title?: string };
  /** Link the new action to this one (previous → new) via logInteraction. */
  previousAction?: Pick<Action, "id" | "title">;
};

export function ActionDialog({ action, ...props }: ActionDialogProps) {
  return action ? (
    <ActionDetails projectId={props.projectId} open={props.open} onOpenChange={props.onOpenChange} action={action} />
  ) : (
    <ActionForm {...props} />
  );
}

function ActionForm({ projectId, open, onOpenChange, defaults, previousAction }: Omit<ActionDialogProps, "action">) {
  const qc = useQueryClient();
  const formId = useId();
  const [type, setType] = useState<ActionType>(defaults?.type ?? "meeting");
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [status, setStatus] = useState<ActionStatus>(statusesFor(type)[0]!);
  const [notes, setNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [channelId, setChannelId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>(defaultPayload(type));
  const [subjects, setSubjects] = useState<Subject[]>(defaults?.subjects ?? []);
  const [participants, setParticipants] = useState<Participant[]>(defaults?.participants ?? []);
  const [attachments, setAttachments] = useState<string[]>([]);
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
      const body = {
        type,
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
        payload,
      } as Schemas["CreateAction"];
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
      success: "Action saved",
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
          Log or plan an action
        </span>
      }
      className="w-[min(760px,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={type} onChange={(e) => changeType(e.target.value as ActionType)}>
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTION_META[t].label}
                </option>
              ))}
            </Select>
          </Field>
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
            <DateTimeInput value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
          <Field label="Due">
            <DateTimeInput value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
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

        <div className="grid gap-2">
          <span className="text-sm font-medium">About</span>
          <SubjectsEditor projectId={projectId} value={subjects} onChange={setSubjects} />
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">People</span>
          <ParticipantsEditor projectId={projectId} value={participants} onChange={setParticipants} />
        </div>
        <AttachmentsSection projectId={projectId} value={attachments} onChange={setAttachments} />

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {previousAction ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={linkPrevious} onChange={(e) => setLinkPrevious(e.target.checked)} />
            Follows up on “{previousAction.title}”
          </label>
        ) : null}
      </form>
    </Dialog>
  );
}

function ActionDetails({
  projectId,
  open,
  onOpenChange,
  action,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: Action;
}) {
  const qc = useQueryClient();
  const can = useCan(projectId);
  const canEdit = can("action:update");
  const channels = useChannels(projectId);
  const members = useMembers(projectId);
  const contacts = useContacts(projectId);
  const positions = usePositions(projectId);
  const orgs = useOrganizations(projectId);
  const {
    current: a,
    save,
    stateOf,
  } = useInlineSave(projectId, action, async (body: Omit<Schemas["UpdateAction"], "version">, version) => {
    const res = await unwrap(
      api.PATCH("/api/projects/{projectId}/actions/{actionId}", {
        params: { path: { projectId, actionId: action.id } },
        body: { ...body, version },
      }),
    );
    for (const s of res.suggestions) offerSuggestion(projectId, s, () => invalidateProject(qc, projectId));
    return res.action;
  });
  const docVersions = useDocumentVersions(projectId, a.attachments.length > 0);
  const close = () => onOpenChange(false);
  const meta = ACTION_META[a.type];
  const Icon = meta.icon;
  const link = "text-primary hover:underline";

  const subjects = a.subjects as Subject[];
  const setSubjects = (v: Subject[]) =>
    save("subjects", { subjects: v as Action["subjects"] }, { subjects: v as Action["subjects"] });
  const setParticipants = (v: Participant[]) =>
    save(
      "participants",
      { participants: v },
      {
        participants: v.map((p) => ({
          ...p,
          contactName: contacts.data?.find((c) => c.id === p.contactId)?.name ?? "",
        })),
      },
    );
  const setPayload = (key: string, v: unknown) =>
    save(`payload.${key}`, { payload: { [key]: v ?? null } }, { payload: { ...a.payload, [key]: v } });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          {meta.label}
        </span>
      }
      className="w-[min(760px,calc(100vw-2rem))]"
    >
      <div className="grid gap-4">
        <InlineText
          label="Title"
          value={a.title}
          required
          canEdit={canEdit}
          state={stateOf("title")}
          onSave={(title) => save("title", { title }, { title })}
          view={<span className="text-base font-semibold">{a.title}</span>}
        />
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <InlineSelect
            label="Status"
            value={a.status}
            canEdit={canEdit}
            state={stateOf("status")}
            onSave={(v) => save("status", { status: v as ActionStatus }, { status: v as ActionStatus })}
            view={<Badge tone={STATUS_TONE[a.status]}>{humanize(a.status)}</Badge>}
          >
            {statusesFor(a.type).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </InlineSelect>
          <InlineSelect
            label="Assignee"
            value={a.assigneeId ?? ""}
            canEdit={canEdit}
            state={stateOf("assigneeId")}
            onSave={(v) => save("assigneeId", { assigneeId: v || null }, { assigneeId: v || null })}
          >
            <option value="">Me</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </InlineSelect>
          <InlineDateTime
            label="When"
            value={a.scheduledAt}
            canEdit={canEdit}
            state={stateOf("scheduledAt")}
            onSave={(scheduledAt) => save("scheduledAt", { scheduledAt }, { scheduledAt })}
          />
          <InlineDateTime
            label="Due"
            value={a.dueAt}
            canEdit={canEdit}
            state={stateOf("dueAt")}
            onSave={(dueAt) => save("dueAt", { dueAt }, { dueAt })}
          />
          <InlineSelect
            label="Channel"
            value={a.channelId ?? ""}
            canEdit={canEdit}
            state={stateOf("channelId")}
            onSave={(v) => save("channelId", { channelId: v || null }, { channelId: v || null })}
          >
            <option value="">—</option>
            {channels.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </InlineSelect>
          {a.completedAt && a.status !== "planned" ? (
            <InlineField label="Completed" canEdit={false} view={formatDateTime(a.completedAt)} editor={null} />
          ) : null}
        </div>

        {PAYLOAD_FIELDS[a.type].length ? (
          <fieldset className="grid gap-x-4 gap-y-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium text-muted-foreground">{meta.label} details</legend>
            {PAYLOAD_FIELDS[a.type].map((f) => (
              <InlinePayload
                key={f.key}
                spec={f}
                value={a.payload[f.key]}
                canEdit={canEdit}
                state={stateOf(`payload.${f.key}`)}
                onSave={(v) => setPayload(f.key, v)}
              />
            ))}
          </fieldset>
        ) : null}

        <InlineField
          label="About"
          canEdit={canEdit}
          state={stateOf("subjects")}
          view={
            subjects.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {subjects.map((s) => {
                  if (s.positionId) {
                    const p = positions.data?.find((x) => x.id === s.positionId);
                    return (
                      <Link
                        key={s.positionId}
                        to="/p/$projectId/positions/$positionId"
                        params={{ projectId, positionId: s.positionId }}
                        className={link}
                        onClick={close}
                      >
                        {p ? `${p.title}${p.company ? ` — ${p.company.name}` : ""}` : "Position"}
                      </Link>
                    );
                  }
                  const o = orgs.data?.find((x) => x.id === s.organizationId);
                  return (
                    <Link
                      key={s.organizationId}
                      to="/p/$projectId/organizations/$organizationId"
                      params={{ projectId, organizationId: s.organizationId! }}
                      className={link}
                      onClick={close}
                    >
                      {o?.name ?? "Organization"}
                    </Link>
                  );
                })}
              </span>
            ) : (
              <span className="text-muted-foreground">Nothing specific (project-level)</span>
            )
          }
          editor={<SubjectsEditor projectId={projectId} value={subjects} onChange={setSubjects} />}
        />

        <InlineField
          label="People"
          canEdit={canEdit}
          state={stateOf("participants")}
          view={
            a.participants.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {a.participants.map((p) => (
                  <span key={`${p.contactId}:${p.role}`}>
                    <Link
                      to="/p/$projectId/contacts/$contactId"
                      params={{ projectId, contactId: p.contactId }}
                      className={link}
                      onClick={close}
                    >
                      {p.contactName || contacts.data?.find((c) => c.id === p.contactId)?.name || "Contact"}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">{humanize(p.role)}</span>
                  </span>
                ))}
              </span>
            ) : (
              <Empty />
            )
          }
          editor={
            <ParticipantsEditor
              projectId={projectId}
              value={a.participants.map((p) => ({ contactId: p.contactId, role: p.role }))}
              onChange={setParticipants}
            />
          }
        />

        <InlineField
          label="Documents sent or received"
          canEdit={canEdit}
          state={stateOf("attachments")}
          view={
            a.attachments.length ? (
              <span className="grid gap-1">
                {a.attachments.map((id) => {
                  const v = docVersions.all.find((x) => x.id === id);
                  return v ? (
                    <Link
                      key={id}
                      to="/p/$projectId/documents/$documentId"
                      params={{ projectId, documentId: v.documentId }}
                      className={link}
                      onClick={close}
                    >
                      {v.label}
                    </Link>
                  ) : (
                    <span key={id}>{id}</span>
                  );
                })}
              </span>
            ) : (
              <Empty />
            )
          }
          editor={
            <AttachmentsEditor
              versions={docVersions}
              value={a.attachments}
              onChange={(attachments) => save("attachments", { attachments }, { attachments })}
            />
          }
        />

        <InlineText
          label="Notes"
          multiline
          value={a.notes ?? ""}
          canEdit={canEdit}
          state={stateOf("notes")}
          onSave={(v) => save("notes", { notes: v || null }, { notes: v || null })}
        />

        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(a.createdAt)}
          {a.updatedAt !== a.createdAt ? ` · updated ${formatDateTime(a.updatedAt)}` : ""}
        </p>
      </div>
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

function InlineDateTime({
  label,
  value,
  onSave,
  ...props
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  canEdit?: boolean;
  state?: SaveState;
}) {
  return (
    <InlineField
      label={label}
      {...props}
      view={value ? formatDateTime(value) : <Empty />}
      editor={
        <DateTimeInput
          value={toLocalInput(value)}
          onChange={(e) => e.target.value !== toLocalInput(value) && onSave(fromLocalInput(e.target.value))}
        />
      }
    />
  );
}

const isWide = (spec: FieldSpec) => spec.kind === "textarea" || spec.kind === "money" || spec.kind === "checklist";

type Money = { amount?: number; currency?: string; period?: string };
type ChecklistItem = { text: string; done: boolean };

function payloadView(spec: FieldSpec, value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return <Empty />;
  switch (spec.kind) {
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
          {String(value)}
        </a>
      );
    case "textarea":
      return <p className="whitespace-pre-wrap">{String(value)}</p>;
    case "date":
      return formatDate(`${value}T00:00`);
    case "select":
      return humanize(String(value));
    case "money": {
      const m = value as Money;
      if (m.amount === undefined) return <Empty />;
      return `${formatMoney(m.amount, m.currency)}${spec.withPeriod && m.period ? ` / ${m.period}` : ""}`;
    }
    default:
      return String(value);
  }
}

/** A payload field shown read-first; typed values save once typing pauses, picks save right away. */
function InlinePayload({
  spec,
  value,
  onSave,
  canEdit,
  state,
}: {
  spec: FieldSpec;
  value: unknown;
  onSave: (v: unknown) => void;
  canEdit: boolean;
  state: SaveState;
}) {
  const draft = useDraft(value, onSave);
  const immediate = spec.kind === "select" || spec.kind === "date";
  const items = spec.kind === "checklist" ? ((value as ChecklistItem[] | undefined) ?? []) : [];
  // Checklist items can be ticked off without opening the editor.
  const checklistView = items.length ? (
    <ul className="grid gap-1">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: checklist rows have no identity
        <li key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.done}
            disabled={!canEdit}
            aria-label={item.text}
            onChange={(e) => onSave(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
          />
          <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.text}</span>
        </li>
      ))}
    </ul>
  ) : (
    <Empty />
  );
  return (
    <InlineField
      label={spec.label}
      canEdit={canEdit}
      state={state}
      className={isWide(spec) ? "sm:col-span-2" : undefined}
      onEdit={draft.start}
      onDone={draft.flush}
      onBlur={draft.flush}
      view={spec.kind === "checklist" ? checklistView : payloadView(spec, value)}
      editor={
        <PayloadInput
          spec={spec}
          value={draft.draft}
          onChange={(v) => {
            draft.change(v);
            if (immediate) draft.flush();
          }}
        />
      }
    />
  );
}

function PayloadField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  if (spec.kind === "checklist") {
    return (
      <div className="grid gap-2 sm:col-span-2">
        <span className="text-sm font-medium">{spec.label}</span>
        <PayloadInput spec={spec} value={value} onChange={onChange} />
      </div>
    );
  }
  return (
    <Field label={spec.label} className={isWide(spec) ? "sm:col-span-2" : undefined}>
      <PayloadInput spec={spec} value={value} onChange={onChange} />
    </Field>
  );
}

/** The control(s) for one payload field, without a label. */
function PayloadInput({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const orUndefined = (v: string) => (v === "" ? undefined : v);
  switch (spec.kind) {
    case "text":
    case "url":
      return (
        <Input
          type={spec.kind === "url" ? "url" : "text"}
          value={str(value)}
          onChange={(e) => onChange(orUndefined(e.target.value))}
        />
      );
    case "date":
      return <DateInput value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))} />;
    case "textarea":
      return <Textarea value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))} />;
    case "number":
      return (
        <Input
          type="number"
          step={spec.step ?? 1}
          min={spec.min}
          max={spec.max}
          value={str(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "select":
      return (
        <Select value={str(value)} onChange={(e) => onChange(orUndefined(e.target.value))}>
          {!spec.required ? <option value="">—</option> : null}
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </Select>
      );
    case "money": {
      const money = (value ?? {}) as Money;
      const set = (patch: Partial<Money>) => {
        const next = { ...money, ...patch };
        onChange(next.amount === undefined && !spec.required ? undefined : next);
      };
      return (
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
      );
    }
    case "checklist": {
      const items = (value as ChecklistItem[] | undefined) ?? [];
      return (
        <div className="grid gap-2">
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

type DocVersion = { id: string; documentId: string; label: string };

/** Versions that can be attached, and (when needed) those of deleted documents, which attachments keep. */
function useDocumentVersions(projectId: string, withDeleted: boolean) {
  const docs = useQuery({
    queryKey: ["documents", projectId, {}],
    queryFn: async () =>
      (await unwrap(api.GET("/api/projects/{projectId}/documents", { params: { path: { projectId }, query: {} } })))
        .items,
  });
  const deletedDocs = useQuery({
    queryKey: ["documents", projectId, { deleted: "true" }],
    enabled: withDeleted,
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/documents", {
            params: { path: { projectId }, query: { deleted: "true" } },
          }),
        )
      ).items,
  });
  const available: DocVersion[] =
    docs.data?.flatMap((d) =>
      d.versions.map((v) => ({ id: v.id, documentId: d.id, label: `${d.title} · v${v.versionNo} (${v.filename})` })),
    ) ?? [];
  const deleted: DocVersion[] =
    deletedDocs.data?.flatMap((d) =>
      d.versions.map((v) => ({ id: v.id, documentId: d.id, label: `${d.title} · v${v.versionNo} (deleted)` })),
    ) ?? [];
  return { available, all: [...available, ...deleted] };
}

function AttachmentsSection({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const versions = useDocumentVersions(projectId, value.length > 0);
  if (versions.available.length === 0 && value.length === 0) return null;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Documents sent or received</span>
      <AttachmentsEditor versions={versions} value={value} onChange={onChange} />
    </div>
  );
}

function AttachmentsEditor({
  versions,
  value,
  onChange,
}: {
  versions: ReturnType<typeof useDocumentVersions>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((id) => (
          <Chip
            key={id}
            label={versions.all.find((v) => v.id === id)?.label ?? id}
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
        {versions.available
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

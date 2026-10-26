import { canReschedule, EDGE_KINDS, type EdgeKind } from "@crm/shared";
import { CalendarClock, Check, CornerDownRight, Link2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ACTION_META, actionSummary, STATUS_TONE } from "@/lib/actions";
import { type Action, api, unwrap } from "@/lib/api";
import { useCan, useProjectMutation } from "@/lib/queries";
import { cn, formatDateTime, fromLocalInput, humanize, toLocalInput } from "@/lib/utils";

export function ActionItem({
  projectId,
  action,
  candidates = [],
  compact,
}: {
  projectId: string;
  action: Action;
  /** Other actions this one can be linked to. */
  candidates?: Action[];
  compact?: boolean;
}) {
  const can = useCan(projectId);
  const [dialog, setDialog] = useState<"edit" | "follow" | "reschedule" | "link" | null>(null);
  const meta = ACTION_META[action.type];
  const Icon = meta.icon;
  const when = action.completedAt ?? action.scheduledAt ?? action.dueAt;
  const overdue =
    action.status === "planned" &&
    (action.dueAt ?? action.scheduledAt) &&
    new Date(action.dueAt ?? action.scheduledAt!) < new Date();

  const markDone = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/actions/{actionId}", {
          params: { path: { projectId, actionId: action.id } },
          body: { status: "done", version: action.version },
        }),
      ),
    { success: "Marked done" },
  );
  const remove = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.DELETE("/api/projects/{projectId}/actions/{actionId}", {
          params: { path: { projectId, actionId: action.id }, query: { version: action.version } },
        }),
      ),
    { success: "Action deleted" },
  );

  return (
    <div className={cn("flex gap-3 rounded-md px-2 py-2 hover:bg-muted/50", compact && "py-1.5")}>
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="cursor-pointer truncate text-left text-sm font-medium hover:underline"
            onClick={() => setDialog("edit")}
          >
            {action.title}
          </button>
          <Badge tone={STATUS_TONE[action.status]}>{humanize(action.status)}</Badge>
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{meta.label}</span>
          {actionSummary(action.type, action.payload) ? (
            <span>{humanize(actionSummary(action.type, action.payload))}</span>
          ) : null}
          {when ? <span>{formatDateTime(when)}</span> : null}
          {action.participants.length ? (
            <span>with {action.participants.map((p) => p.contactName).join(", ")}</span>
          ) : null}
        </div>
        {!compact && action.notes ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{action.notes}</p>
        ) : null}
      </div>
      {can("action:update") ? (
        <div className="flex shrink-0 items-start gap-1">
          {action.status === "planned" ? (
            <Button variant="ghost" size="icon" title="Mark done" onClick={() => markDone.mutate(undefined)}>
              <Check />
            </Button>
          ) : null}
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            }
          >
            <MenuItem onSelect={() => setDialog("edit")}>
              <Pencil /> Edit
            </MenuItem>
            {can("action:create", "edge:create") ? (
              <MenuItem onSelect={() => setDialog("follow")}>
                <CornerDownRight /> Log follow-up
              </MenuItem>
            ) : null}
            {action.status === "planned" && canReschedule(action.type) ? (
              <MenuItem onSelect={() => setDialog("reschedule")}>
                <CalendarClock /> Reschedule
              </MenuItem>
            ) : null}
            {can("edge:create") && candidates.length ? (
              <MenuItem onSelect={() => setDialog("link")}>
                <Link2 /> Link to another action
              </MenuItem>
            ) : null}
            {can("action:delete") ? (
              <>
                <MenuSeparator />
                <MenuItem destructive onSelect={() => remove.mutate(undefined)}>
                  <Trash2 /> Delete
                </MenuItem>
              </>
            ) : null}
          </Menu>
        </div>
      ) : null}

      {dialog === "edit" ? (
        <ActionDialog projectId={projectId} open onOpenChange={() => setDialog(null)} action={action} />
      ) : null}
      {dialog === "follow" ? (
        <ActionDialog
          projectId={projectId}
          open
          onOpenChange={() => setDialog(null)}
          previousAction={action}
          defaults={{
            subjects: action.subjects as { positionId?: string; organizationId?: string }[],
            participants: action.participants.map((p) => ({ contactId: p.contactId, role: p.role })),
          }}
        />
      ) : null}
      {dialog === "reschedule" ? (
        <RescheduleDialog projectId={projectId} action={action} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "link" ? (
        <LinkDialog projectId={projectId} action={action} candidates={candidates} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function RescheduleDialog({ projectId, action, onClose }: { projectId: string; action: Action; onClose: () => void }) {
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(action.scheduledAt));
  const [dueAt, setDueAt] = useState(toLocalInput(action.dueAt));
  const [notes, setNotes] = useState("");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/actions/{actionId}/reschedule", {
          params: { path: { projectId, actionId: action.id } },
          body: {
            ...(scheduledAt !== toLocalInput(action.scheduledAt) ? { scheduledAt: fromLocalInput(scheduledAt) } : {}),
            ...(dueAt !== toLocalInput(action.dueAt) ? { dueAt: fromLocalInput(dueAt) } : {}),
            ...(notes ? { notes } : {}),
            version: action.version,
          },
        }),
      ),
    { success: "Rescheduled", onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Reschedule"
      description="The original stays in the history as rescheduled."
    >
      <div className="grid gap-3">
        <Field label="New time">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <Field label="New due date">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Notes for the new one">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Keep the current notes" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            Reschedule
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LinkDialog({
  projectId,
  action,
  candidates,
  onClose,
}: {
  projectId: string;
  action: Action;
  candidates: Action[];
  onClose: () => void;
}) {
  const [childId, setChildId] = useState("");
  const [kind, setKind] = useState<EdgeKind>("follow_up");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/actions/{actionId}/edges", {
          params: { path: { projectId, actionId: action.id } },
          body: { childId, kind },
        }),
      ),
    {
      success: "Linked",
      onSuccess: (r) => {
        if (r.warnings.includes("cycle")) toast.warning("This link closes a cycle in the action graph.");
        onClose();
      },
    },
  );
  return (
    <Dialog open onOpenChange={onClose} title={`Link “${action.title}” to…`}>
      <div className="grid gap-3">
        <Field label="Relationship">
          <Select value={kind} onChange={(e) => setKind(e.target.value as EdgeKind)}>
            {EDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EDGE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action">
          <Select value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">Choose…</option>
            {candidates
              .filter((c) => c.id !== action.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {ACTION_META[c.type].label}: {c.title}
                </option>
              ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!childId || save.isPending} onClick={() => save.mutate(undefined)}>
            Link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export const EDGE_LABELS: Record<EdgeKind, string> = {
  follow_up: "…is followed up by",
  subtask: "…has subtask",
  blocks: "…blocks",
  rescheduled: "…was rescheduled to",
  related: "…is related to",
};

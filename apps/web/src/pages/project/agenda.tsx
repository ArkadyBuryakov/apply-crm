import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { ActionItem } from "@/components/action-item";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/form";
import { Loading, PageHeader } from "@/components/ui/misc";
import { type Action, api, unwrap } from "@/lib/api";
import { useCan, useMe, useMembers } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

/** In-app reminders (ADR 0016): planned work in a date range plus everything overdue, computed by the API. */
export function AgendaPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/agenda" });
  const can = useCan(projectId);
  const me = useMe();
  const members = useMembers(projectId);
  const [assigneeId, setAssigneeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [creating, setCreating] = useState(false);
  const agenda = useQuery({
    queryKey: ["agenda", projectId, { assigneeId, from, to }],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/agenda", {
          params: {
            path: { projectId },
            query: { ...(assigneeId ? { assigneeId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) },
          },
        }),
      ),
  });

  const byDay = new Map<string, Action[]>();
  for (const a of agenda.data?.upcoming ?? []) {
    const key = formatDate(a.scheduledAt ?? a.dueAt);
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }

  return (
    <div>
      <PageHeader
        title="Agenda"
        subtitle={
          agenda.data
            ? `${formatDate(agenda.data.from)} – ${formatDate(agenda.data.to)} (${agenda.data.timezone})`
            : null
        }
        actions={
          can("action:create") ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Plan something
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          className="w-48"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          aria-label="Assignee"
        >
          <option value="">Everyone</option>
          {me.data ? <option value={me.data.id}>Me</option> : null}
          {members.data
            ?.filter((m) => m.userId !== me.data?.id)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </Select>
        <DateInput
          className="w-44"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
          placeholder="From"
        />
        <DateInput
          className="w-44"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To"
          placeholder="To"
        />
      </div>
      {agenda.isLoading ? <Loading /> : null}
      {agenda.data ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-destructive">Overdue ({agenda.data.overdue.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0.5 p-2">
              {agenda.data.overdue.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">Nothing overdue.</p>
              ) : null}
              {agenda.data.overdue.map((a) => (
                <ActionItem key={a.id} projectId={projectId} action={a} compact />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Coming up ({agenda.data.upcoming.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-2">
              {agenda.data.upcoming.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">Nothing planned.</p>
              ) : null}
              {[...byDay.entries()].map(([day, items]) => (
                <div key={day}>
                  <div className="px-2 text-xs font-medium text-muted-foreground">{day}</div>
                  {items.map((a) => (
                    <ActionItem key={a.id} projectId={projectId} action={a} compact />
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {creating ? (
        <ActionDialog projectId={projectId} open onOpenChange={setCreating} defaults={{ type: "task" }} />
      ) : null}
    </div>
  );
}

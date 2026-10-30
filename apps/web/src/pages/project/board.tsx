import { Link, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import { PositionDialog } from "@/components/entity-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { api, type Position, unwrap } from "@/lib/api";
import { useCan, usePositions, useProjectMutation, useStages } from "@/lib/queries";
import { cn, formatSalary, humanize } from "@/lib/utils";

export const OUTCOME_TONE = {
  open: "primary",
  accepted: "success",
  rejected: "danger",
  withdrawn: "neutral",
  ghosted: "warning",
} as const;

/** Pipeline board (ADR 0014): columns are stages; by default only open positions are shown. */
export function BoardPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/" });
  const can = useCan(projectId);
  const [showClosed, setShowClosed] = useState(false);
  const stages = useStages(projectId);
  const positions = usePositions(projectId, showClosed ? {} : { outcome: "open" });
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const move = useProjectMutation(projectId, ({ position, stageId }: { position: Position; stageId: string }) =>
    unwrap(
      api.PATCH("/api/projects/{projectId}/positions/{positionId}", {
        params: { path: { projectId, positionId: position.id } },
        body: { stageId, version: position.version },
      }),
    ),
  );

  function drop(e: DragEvent, stageId: string) {
    e.preventDefault();
    setDragOver(null);
    const position = positions.data?.find((p) => p.id === e.dataTransfer.getData("text/position"));
    if (position && position.stageId !== stageId) move.mutate({ position, stageId });
  }

  if (stages.isLoading || positions.isLoading) return <Loading />;
  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle={`${positions.data?.length ?? 0} ${showClosed ? "positions" : "open positions"}`}
        actions={
          <>
            <Select
              className="w-44"
              value={showClosed ? "all" : "open"}
              onChange={(e) => setShowClosed(e.target.value === "all")}
            >
              <option value="open">Open positions</option>
              <option value="all">All outcomes</option>
            </Select>
            {can("position:create") ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New position
              </Button>
            ) : null}
          </>
        }
      />
      {positions.data?.length === 0 && !showClosed ? (
        <EmptyState title="No open positions">Add the first job opening you are pursuing.</EmptyState>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.data?.map((stage) => {
            const items = positions.data?.filter((p) => p.stageId === stage.id) ?? [];
            return (
              <section
                key={stage.id}
                className={cn(
                  "flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 p-2",
                  dragOver === stage.id && "ring-2 ring-primary",
                )}
                onDragOver={(e) => {
                  if (!can("position:update")) return;
                  e.preventDefault();
                  setDragOver(stage.id);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => drop(e, stage.id)}
                aria-label={stage.label}
              >
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                  {stage.label} <span className="text-xs text-muted-foreground">{items.length}</span>
                </h2>
                <div className="grid gap-2">
                  {items.map((p) => (
                    <Link
                      key={p.id}
                      to="/p/$projectId/positions/$positionId"
                      params={{ projectId, positionId: p.id }}
                      draggable={can("position:update")}
                      onDragStart={(e) => e.dataTransfer.setData("text/position", p.id)}
                      className="block rounded-md border border-border bg-card p-3 text-sm shadow-xs hover:border-primary/50"
                    >
                      <div className="font-medium">{p.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.company?.name ?? "Undisclosed company"}
                        {p.agency ? ` · via ${p.agency.name}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {p.outcome !== "open" ? (
                          <Badge tone={OUTCOME_TONE[p.outcome]}>{humanize(p.outcome)}</Badge>
                        ) : null}
                        <SalaryLine salary={p.salary} />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {creating ? <PositionDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function SalaryLine({ salary }: { salary: Position["salary"] }) {
  const formatted = formatSalary(salary);
  if (!formatted) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {formatted.range}
      {formatted.yearly ? <span className="block text-muted-foreground/60">{formatted.yearly}</span> : null}
    </span>
  );
}

import { Link, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import { PositionDialog } from "@/components/entity-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState, Fab, Loading, PageHeader } from "@/components/ui/misc";
import { api, type Position, type Stage, unwrap } from "@/lib/api";
import { usePhone } from "@/lib/media";
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
  const phone = usePhone();

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
        phoneTitle={false}
        subtitle={`${positions.data?.length ?? 0} ${showClosed ? "positions" : "open positions"}`}
        actions={
          <>
            <Select
              className="w-44 max-md:h-9! max-md:w-auto max-md:text-sm"
              value={showClosed ? "all" : "open"}
              onChange={(e) => setShowClosed(e.target.value === "all")}
            >
              <option value="open">Open positions</option>
              <option value="all">All outcomes</option>
            </Select>
            {can("position:create") ? (
              <Button className="max-md:hidden" onClick={() => setCreating(true)}>
                <Plus /> New position
              </Button>
            ) : null}
          </>
        }
      />
      {positions.data?.length === 0 && !showClosed ? (
        <EmptyState title="No open positions">Add the first job opening you are pursuing.</EmptyState>
      ) : phone ? (
        <PhoneBoard
          projectId={projectId}
          stages={stages.data ?? []}
          positions={positions.data ?? []}
          onMove={can("position:update") ? (position, stageId) => move.mutate({ position, stageId }) : undefined}
        />
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
      {can("position:create") ? <Fab label="New position" onClick={() => setCreating(true)} /> : null}
      {creating ? <PositionDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/**
 * The board on phones: drag-and-drop does not work on touch screens and a column fills the screen, so stage chips pick
 * one stage to list and each card moves with a stage picker.
 */
function PhoneBoard({
  projectId,
  stages,
  positions,
  onMove,
}: {
  projectId: string;
  stages: Stage[];
  positions: Position[];
  onMove?: (position: Position, stageId: string) => void;
}) {
  const [picked, setPicked] = useState<string>();
  const current = picked ?? stages.find((s) => positions.some((p) => p.stageId === s.id))?.id ?? stages[0]?.id;
  const items = positions.filter((p) => p.stageId === current);
  return (
    <div>
      <div role="tablist" aria-label="Stages" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {stages.map((stage) => {
          const count = positions.filter((p) => p.stageId === stage.id).length;
          const on = stage.id === current;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPicked(stage.id)}
              className={cn(
                "flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm",
                on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
              )}
            >
              {stage.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-medium",
                  on ? "bg-background/25" : "bg-muted text-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      {items.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Nothing at this stage.</p> : null}
      <div className="grid gap-2">
        {items.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-card p-3 text-sm shadow-xs">
            <Link to="/p/$projectId/positions/$positionId" params={{ projectId, positionId: p.id }} className="block">
              <div className="font-medium">{p.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {p.company?.name ?? "Undisclosed company"}
                {p.agency ? ` · via ${p.agency.name}` : ""}
              </div>
            </Link>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {p.outcome !== "open" ? <Badge tone={OUTCOME_TONE[p.outcome]}>{humanize(p.outcome)}</Badge> : null}
                <SalaryLine salary={p.salary} />
              </div>
              {onMove ? (
                <Select
                  aria-label={`Stage of ${p.title}`}
                  className="h-9! w-auto max-w-40 shrink-0 text-sm"
                  value={p.stageId}
                  onChange={(e) => {
                    // Stay on this stage rather than the default pick, which may now be another one.
                    setPicked(current);
                    onMove(p, e.target.value);
                  }}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </div>
        ))}
      </div>
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

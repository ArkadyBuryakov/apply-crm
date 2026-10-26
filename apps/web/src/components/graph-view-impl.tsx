// Action graph visualization (ADR 0005): React Flow with a dagre top-down layout. Cycles are allowed, so the layout
// cannot assume a topological order; dagre handles cycles by reversing edges internally. Connecting two nodes creates
// an edge after asking for its kind.

import { EDGE_KINDS, type EdgeKind } from "@crm/shared";
import dagre from "@dagrejs/dagre";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { ActionDialog } from "@/components/action-dialog";
import { EDGE_LABELS } from "@/components/action-item";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { ACTION_META, STATUS_TONE } from "@/lib/actions";
import { type Action, type Edge as ApiEdge, api, unwrap } from "@/lib/api";
import { useCan, useProjectMutation } from "@/lib/queries";
import { cn, formatDate, humanize } from "@/lib/utils";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const NODE_W = 230;
const NODE_H = 64;

const EDGE_STYLE: Record<EdgeKind, { stroke: string; dash?: string }> = {
  follow_up: { stroke: "var(--primary)" },
  subtask: { stroke: "var(--muted-foreground)", dash: "2 4" },
  blocks: { stroke: "var(--destructive)" },
  rescheduled: { stroke: "var(--warning)", dash: "6 4" },
  related: { stroke: "var(--muted-foreground)", dash: "4 4" },
};

type ActionNodeData = { action: Action };

function ActionNode({ data }: NodeProps<Node<ActionNodeData>>) {
  const a = data.action;
  const Icon = ACTION_META[a.type].icon;
  const when = a.completedAt ?? a.scheduledAt ?? a.dueAt;
  const tone = STATUS_TONE[a.status];
  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2 text-left shadow-xs",
        tone === "success" && "border-success/50",
        tone === "primary" && "border-primary/50",
        tone === "warning" && "border-warning/50 opacity-75",
        tone === "neutral" && "border-border opacity-60",
        tone === "danger" && "border-destructive/50",
      )}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3" /> {ACTION_META[a.type].label} · {humanize(a.status)}
      </div>
      <div className="truncate text-sm font-medium">{a.title}</div>
      {when ? <div className="text-[11px] text-muted-foreground">{formatDate(when)}</div> : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { action: ActionNode };

function layout(actions: Action[], edges: ApiEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const a of actions) g.setNode(a.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.parentId, e.childId);
  dagre.layout(g);
  const nodes: Node<ActionNodeData>[] = actions.map((a) => {
    const p = g.node(a.id);
    return { id: a.id, type: "action", position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }, data: { action: a } };
  });
  const flowEdges: Edge[] = edges.map((e) => ({
    id: `${e.parentId}-${e.childId}-${e.kind}`,
    source: e.parentId,
    target: e.childId,
    label: humanize(e.kind),
    labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
    labelBgStyle: { fill: "var(--background)" },
    style: { stroke: EDGE_STYLE[e.kind].stroke, strokeDasharray: EDGE_STYLE[e.kind].dash },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLE[e.kind].stroke },
    data: { kind: e.kind },
  }));
  return { nodes, edges: flowEdges };
}

/** True when some edge points back into an ancestor, i.e. the graph has a cycle. */
function hasCycle(edges: ApiEdge[]) {
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.childId]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const c of children.get(n) ?? []) if (visit(c)) return true;
    state.set(n, 2);
    return false;
  };
  return [...children.keys()].some(visit);
}

export function GraphView({
  projectId,
  actions,
  edges,
  height = 520,
}: {
  projectId: string;
  actions: Action[];
  edges: ApiEdge[];
  height?: number;
}) {
  const can = useCan(projectId);
  const flow = useMemo(() => layout(actions, edges), [actions, edges]);
  const cyclic = useMemo(() => hasCycle(edges), [edges]);
  const [pending, setPending] = useState<Connection | null>(null);
  const [editing, setEditing] = useState<Action | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ApiEdge | null>(null);

  if (actions.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No actions yet.</p>;
  }
  return (
    <div className="relative rounded-lg border border-border" style={{ height }}>
      {cyclic ? (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning">
          This graph contains a cycle
        </div>
      ) : null}
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        nodesDraggable
        nodesConnectable={can("edge:create")}
        onConnect={(c) => c.source !== c.target && setPending(c)}
        onNodeClick={(_, node) => setEditing((node.data as ActionNodeData).action)}
        onEdgeClick={(_, e) =>
          can("edge:delete") &&
          setSelectedEdge(edges.find((x) => `${x.parentId}-${x.childId}-${x.kind}` === e.id) ?? null)
        }
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {pending ? <NewEdgeDialog projectId={projectId} connection={pending} onClose={() => setPending(null)} /> : null}
      {editing ? (
        <ActionDialog projectId={projectId} open onOpenChange={() => setEditing(null)} action={editing} />
      ) : null}
      {selectedEdge ? (
        <RemoveEdgeDialog projectId={projectId} edge={selectedEdge} onClose={() => setSelectedEdge(null)} />
      ) : null}
    </div>
  );
}

function NewEdgeDialog({
  projectId,
  connection,
  onClose,
}: {
  projectId: string;
  connection: Connection;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<EdgeKind>("follow_up");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/actions/{actionId}/edges", {
          params: { path: { projectId, actionId: connection.source } },
          body: { childId: connection.target, kind },
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
    <Dialog open onOpenChange={onClose} title="Link actions">
      <div className="grid gap-3">
        <Field label="The upper action…">
          <Select value={kind} onChange={(e) => setKind(e.target.value as EdgeKind)}>
            {EDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EDGE_LABELS[k]} the lower one
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            Link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveEdgeDialog({ projectId, edge, onClose }: { projectId: string; edge: ApiEdge; onClose: () => void }) {
  const remove = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.DELETE("/api/projects/{projectId}/actions/{actionId}/edges/{childId}", {
          params: { path: { projectId, actionId: edge.parentId, childId: edge.childId }, query: { kind: edge.kind } },
        }),
      ),
    { success: "Link removed", onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={onClose} title="Remove this link?" description={`Kind: ${humanize(edge.kind)}`}>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Keep
        </Button>
        <Button variant="destructive" onClick={() => remove.mutate(undefined)} disabled={remove.isPending}>
          Remove
        </Button>
      </div>
    </Dialog>
  );
}

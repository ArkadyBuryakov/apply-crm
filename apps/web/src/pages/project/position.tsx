import { POSITION_OUTCOMES, type PositionOutcome } from "@crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { ActionItem } from "@/components/action-item";
import { Comments } from "@/components/comments";
import { PositionDialog } from "@/components/entity-forms";
import { GraphView } from "@/components/graph-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, unwrap } from "@/lib/api";
import { useCan, useProjectMutation, useStages } from "@/lib/queries";
import { formatDate, formatMoney, humanize } from "@/lib/utils";
import { OUTCOME_TONE } from "./board";

export function PositionPage() {
  const { projectId, positionId } = useParams({ from: "/authed/p/$projectId/positions/$positionId" });
  const can = useCan(projectId);
  const navigate = useNavigate();
  const stages = useStages(projectId);
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const overview = useQuery({
    queryKey: ["position-overview", projectId, positionId],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/positions/{positionId}/overview", {
          params: { path: { projectId, positionId } },
        }),
      ),
  });

  const patch = useProjectMutation(projectId, (body: { stageId?: string; outcome?: PositionOutcome }) =>
    unwrap(
      api.PATCH("/api/projects/{projectId}/positions/{positionId}", {
        params: { path: { projectId, positionId } },
        body: { ...body, version: overview.data!.position.version },
      }),
    ),
  );
  const remove = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.DELETE("/api/projects/{projectId}/positions/{positionId}", {
          params: { path: { projectId, positionId }, query: { version: overview.data!.position.version } },
        }),
      ),
    { success: "Position deleted", onSuccess: () => navigate({ to: "/p/$projectId", params: { projectId } }) },
  );

  if (overview.isLoading) return <Loading />;
  if (!overview.data) return <EmptyState title="Position not found" />;
  const { position, company, agency, contacts, timeline, edges, documents } = overview.data;
  const salary = [
    formatMoney(position.salary.min, position.salary.currency),
    formatMoney(position.salary.max, position.salary.currency),
  ]
    .filter(Boolean)
    .join(" – ");

  return (
    <div>
      <PageHeader
        title={position.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            {company ? (
              <Link
                to="/p/$projectId/organizations/$organizationId"
                params={{ projectId, organizationId: company.id }}
                className="hover:underline"
              >
                {company.name}
              </Link>
            ) : (
              <span>Undisclosed company</span>
            )}
            {agency ? (
              <>
                <span>via</span>
                <Link
                  to="/p/$projectId/organizations/$organizationId"
                  params={{ projectId, organizationId: agency.id }}
                  className="hover:underline"
                >
                  {agency.name}
                </Link>
              </>
            ) : null}
            {salary ? (
              <span>
                · {salary}
                {position.salary.period ? ` / ${position.salary.period}` : ""}
              </span>
            ) : null}
            {position.url ? (
              <a
                href={position.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                · listing <ExternalLink className="size-3" />
              </a>
            ) : null}
          </span>
        }
        actions={
          can("position:update") ? (
            <>
              <Select
                className="w-40"
                aria-label="Stage"
                value={position.stageId}
                onChange={(e) => patch.mutate({ stageId: e.target.value })}
              >
                {stages.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select
                className="w-36"
                aria-label="Outcome"
                value={position.outcome}
                onChange={(e) => patch.mutate({ outcome: e.target.value as PositionOutcome })}
              >
                {POSITION_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              {can("position:delete") ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete position"
                  onClick={() => remove.mutate(undefined)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </>
          ) : (
            <Badge tone={OUTCOME_TONE[position.outcome]}>
              {position.stageKey} · {humanize(position.outcome)}
            </Badge>
          )
        }
      />

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="people">People ({contacts.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          <TabsTrigger value="listing">Listing</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          {can("action:create") ? (
            <Button className="mb-3" onClick={() => setLogging(true)}>
              <Plus /> Log or plan an action
            </Button>
          ) : null}
          {timeline.length === 0 ? <EmptyState title="Nothing logged yet" /> : null}
          <div className="grid gap-0.5">
            {timeline.map((a) => (
              <ActionItem key={a.id} projectId={projectId} action={a} candidates={timeline} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="graph">
          <GraphView projectId={projectId} actions={timeline} edges={edges} />
        </TabsContent>

        <TabsContent value="people">
          {contacts.length === 0 ? (
            <EmptyState title="No people yet">
              Add participants to actions or affiliate contacts with the company.
            </EmptyState>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {contacts.map((c) => (
              <Link key={c.id} to="/p/$projectId/contacts/$contactId" params={{ projectId, contactId: c.id }}>
                <Card className="hover:border-primary/50">
                  <CardContent className="p-3">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.affiliations.map((a) => [a.title, a.organizationName].filter(Boolean).join(" at ")).join("; ")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {c.handles.map((h) => h.value).join(" · ")}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <div className="mb-3">
            <Button variant="outline" asChild>
              <Link to="/p/$projectId/documents" params={{ projectId }}>
                <FileText /> Manage documents
              </Link>
            </Button>
          </div>
          {documents.length === 0 ? <EmptyState title="No tailored documents for this position" /> : null}
          <div className="grid gap-2">
            {documents.map((d) => (
              <Link key={d.id} to="/p/$projectId/documents/$documentId" params={{ projectId, documentId: d.id }}>
                <Card className="hover:border-primary/50">
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span>
                      {d.title} <span className="text-muted-foreground">({humanize(d.kind)})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      v{d.latestVersionNo ?? 0} · {formatDate(d.updatedAt)}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="listing">
          <Card>
            <CardHeader>
              <CardTitle>Listing text</CardTitle>
            </CardHeader>
            <CardContent>
              {position.descriptionMarkdown ? (
                <pre className="whitespace-pre-wrap font-sans text-sm">{position.descriptionMarkdown}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Paste the job description via Edit so it survives the listing going offline.
                </p>
              )}
              {position.notes ? (
                <>
                  <h4 className="mb-1 mt-4 text-sm font-semibold">Notes</h4>
                  <p className="whitespace-pre-wrap text-sm">{position.notes}</p>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comments">
          <Comments projectId={projectId} targetType="position" targetId={positionId} />
        </TabsContent>
      </Tabs>

      {editing ? <PositionDialog projectId={projectId} position={position} onClose={() => setEditing(false)} /> : null}
      {logging ? (
        <ActionDialog
          projectId={projectId}
          open
          onOpenChange={setLogging}
          defaults={{ subjects: [{ positionId }] }}
          previousAction={timeline[0]}
        />
      ) : null}
    </div>
  );
}

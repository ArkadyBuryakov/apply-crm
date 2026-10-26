import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ExternalLink, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { ActionItem } from "@/components/action-item";
import { Comments } from "@/components/comments";
import { ContactDialog, OrganizationDialog, PositionDialog } from "@/components/entity-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, unwrap } from "@/lib/api";
import { useCan, useContacts, useOrganizations, usePositions, useProjectMutation } from "@/lib/queries";
import { humanize } from "@/lib/utils";
import { OUTCOME_TONE } from "./board";

export function OrganizationsPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/organizations" });
  const can = useCan(projectId);
  const [kind, setKind] = useState<"" | "company" | "agency">("");
  const [q, setQ] = useState("");
  const orgs = useOrganizations(projectId, { ...(kind ? { kind } : {}), ...(q ? { q } : {}) });
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Companies you apply to and the agencies that represent them"
        actions={
          can("organization_entity:create") ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New organization
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="">All kinds</option>
          <option value="company">Companies</option>
          <option value="agency">Agencies</option>
        </Select>
      </div>
      {orgs.isLoading ? <Loading /> : null}
      {orgs.data?.length === 0 ? <EmptyState title="No organizations" /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.data?.map((o) => (
          <Link
            key={o.id}
            to="/p/$projectId/organizations/$organizationId"
            params={{ projectId, organizationId: o.id }}
          >
            <Card className="h-full hover:border-primary/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{o.name}</span>
                  <Badge tone={o.kind === "agency" ? "warning" : "primary"}>{o.kind}</Badge>
                </div>
                {o.website ? <div className="mt-1 truncate text-xs text-muted-foreground">{o.website}</div> : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {creating ? <OrganizationDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

export function OrganizationDetailPage() {
  const { projectId, organizationId } = useParams({ from: "/authed/p/$projectId/organizations/$organizationId" });
  const can = useCan(projectId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"edit" | "position" | "contact" | "action" | null>(null);
  const org = useQuery({
    queryKey: ["organization", projectId, organizationId],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/organizations/{organizationId}", {
          params: { path: { projectId, organizationId } },
        }),
      ),
  });
  const positions = usePositions(projectId, { organizationId });
  const people = useContacts(projectId, { organizationId });
  const actions = useQuery({
    queryKey: ["actions", projectId, { organizationId }],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/actions", {
            params: { path: { projectId }, query: { organizationId, limit: 200 } },
          }),
        )
      ).items,
  });
  const remove = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.DELETE("/api/projects/{projectId}/organizations/{organizationId}", {
          params: { path: { projectId, organizationId }, query: { version: org.data!.version } },
        }),
      ),
    {
      success: "Organization deleted",
      onSuccess: () => navigate({ to: "/p/$projectId/organizations", params: { projectId } }),
    },
  );

  if (org.isLoading) return <Loading />;
  if (!org.data) return <EmptyState title="Organization not found" />;
  const o = org.data;
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {o.name} <Badge tone={o.kind === "agency" ? "warning" : "primary"}>{o.kind}</Badge>
          </span>
        }
        subtitle={
          o.website ? (
            <a
              href={o.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              {o.website} <ExternalLink className="size-3" />
            </a>
          ) : null
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/p/$projectId/graph" params={{ projectId }} search={{ organizationId }}>
                <Network /> Graph
              </Link>
            </Button>
            {can("organization_entity:update") ? (
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {can("organization_entity:delete") ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete organization"
                onClick={() => remove.mutate(undefined)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </>
        }
      />
      {o.notes ? <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">{o.notes}</p> : null}
      <Tabs defaultValue="positions">
        <TabsList>
          <TabsTrigger value="positions">Positions ({positions.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="people">People ({people.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({actions.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          {can("position:create") ? (
            <Button className="mb-3" onClick={() => setDialog("position")}>
              <Plus /> New position here
            </Button>
          ) : null}
          <div className="grid gap-2">
            {positions.data?.map((p) => (
              <Link key={p.id} to="/p/$projectId/positions/$positionId" params={{ projectId, positionId: p.id }}>
                <Card className="hover:border-primary/50">
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span className="font-medium">{p.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {humanize(p.stageKey)}
                      <Badge tone={OUTCOME_TONE[p.outcome]}>{humanize(p.outcome)}</Badge>
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="people">
          {can("contact:create") ? (
            <Button className="mb-3" onClick={() => setDialog("contact")}>
              <Plus /> New contact here
            </Button>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {people.data?.map((c) => (
              <Link key={c.id} to="/p/$projectId/contacts/$contactId" params={{ projectId, contactId: c.id }}>
                <Card className="hover:border-primary/50">
                  <CardContent className="p-3 text-sm">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.affiliations.find((a) => a.organizationId === organizationId)?.title ?? ""}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="timeline">
          {can("action:create") ? (
            <Button className="mb-3" onClick={() => setDialog("action")}>
              <Plus /> Log or plan an action
            </Button>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Actions about {o.name} and its positions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0.5 p-2">
              {actions.data?.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Nothing yet.</p> : null}
              {actions.data?.map((a) => (
                <ActionItem key={a.id} projectId={projectId} action={a} candidates={actions.data} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="comments">
          <Comments projectId={projectId} targetType="organization" targetId={organizationId} />
        </TabsContent>
      </Tabs>
      {dialog === "edit" ? (
        <OrganizationDialog projectId={projectId} organization={o} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "position" ? (
        <PositionDialog
          projectId={projectId}
          defaults={o.kind === "company" ? { companyId: o.id } : { agencyId: o.id }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "contact" ? (
        <ContactDialog projectId={projectId} defaultOrganizationId={o.id} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "action" ? (
        <ActionDialog
          projectId={projectId}
          open
          onOpenChange={() => setDialog(null)}
          defaults={{ subjects: [{ organizationId }] }}
        />
      ) : null}
    </div>
  );
}

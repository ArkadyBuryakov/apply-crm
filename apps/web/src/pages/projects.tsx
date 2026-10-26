import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { errorMessage, useProjects } from "@/lib/queries";
import { humanize } from "@/lib/utils";

export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader
        title="Your projects"
        subtitle="A project is one job search. Share it with a coach, a recruiter or a partner."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/account">
                <UserRound /> Account
              </Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New project
            </Button>
          </>
        }
      />
      <PendingInvitations />
      {projects.isLoading ? <Loading /> : null}
      {projects.data?.items.length === 0 ? (
        <EmptyState title="No projects yet">Create one to start tracking your applications.</EmptyState>
      ) : null}
      <div className="grid gap-3">
        {projects.data?.items.map((p) => (
          <Link key={p.id} to="/p/$projectId" params={{ projectId: p.id }}>
            <Card className="transition-colors hover:border-primary/50">
              <CardContent className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">{humanize(p.role)}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {creating ? <CreateProjectDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/projects", { body: { name } })),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      navigate({ to: "/p/$projectId", params: { projectId: p.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={onClose} title="New project">
      <form
        className="grid gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job search 2026"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PendingInvitations() {
  const qc = useQueryClient();
  const invitations = useQuery({ queryKey: ["my-invitations"], queryFn: () => unwrap(api.GET("/api/invitations")) });
  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "accept" | "decline" }) =>
      unwrap(
        api.POST("/api/invitations/{invitationId}/{decision}", { params: { path: { invitationId: id, decision } } }),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-invitations"] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!invitations.data?.items.length) return null;
  return (
    <div className="mb-6 grid gap-2">
      {invitations.data.items.map((inv) => (
        <Card key={inv.id} className="border-primary/40 bg-accent/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              You are invited to <strong>{inv.projectName}</strong> as {inv.role}.
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => respond.mutate({ id: inv.id, decision: "decline" })}>
                Decline
              </Button>
              <Button size="sm" onClick={() => respond.mutate({ id: inv.id, decision: "accept" })}>
                Accept
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

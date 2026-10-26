import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Pencil, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ActionItem } from "@/components/action-item";
import { Comments } from "@/components/comments";
import { ContactDialog } from "@/components/entity-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { useCan, useChannels, useContacts, useOrganizations, useProjectMutation } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

export function ContactsPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/contacts" });
  const can = useCan(projectId);
  const [q, setQ] = useState("");
  const contacts = useContacts(projectId, q ? { q } : {});
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Recruiters, hiring managers, interviewers, referees"
        actions={
          can("contact:create") ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New contact
            </Button>
          ) : null
        }
      />
      <Input
        className="mb-4 max-w-xs"
        placeholder="Search by name or email…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {contacts.isLoading ? <Loading /> : null}
      {contacts.data?.length === 0 ? <EmptyState title="No contacts" /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {contacts.data?.map((c) => (
          <Link key={c.id} to="/p/$projectId/contacts/$contactId" params={{ projectId, contactId: c.id }}>
            <Card className="h-full hover:border-primary/50">
              <CardContent className="p-3 text-sm">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.affiliations
                    .filter((a) => !a.to)
                    .map((a) => [a.title, a.organizationName].filter(Boolean).join(" at "))
                    .join("; ")}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {creating ? <ContactDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

export function ContactDetailPage() {
  const { projectId, contactId } = useParams({ from: "/authed/p/$projectId/contacts/$contactId" });
  const can = useCan(projectId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"edit" | "affiliation" | "handle" | "purge" | null>(null);
  const contact = useQuery({
    queryKey: ["contact", projectId, contactId],
    queryFn: () =>
      unwrap(api.GET("/api/projects/{projectId}/contacts/{contactId}", { params: { path: { projectId, contactId } } })),
  });
  const actions = useQuery({
    queryKey: ["actions", projectId, { contactId }],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/actions", {
            params: { path: { projectId }, query: { contactId, limit: 200 } },
          }),
        )
      ).items,
  });
  const removeAffiliation = useProjectMutation(projectId, ({ id, version }: { id: string; version: number }) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/contacts/{contactId}/affiliations/{affiliationId}", {
        params: { path: { projectId, contactId, affiliationId: id }, query: { version } },
      }),
    ),
  );
  const removeHandle = useProjectMutation(projectId, ({ id, version }: { id: string; version: number }) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/contacts/{contactId}/handles/{handleId}", {
        params: { path: { projectId, contactId, handleId: id }, query: { version } },
      }),
    ),
  );
  const remove = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.DELETE("/api/projects/{projectId}/contacts/{contactId}", {
          params: { path: { projectId, contactId }, query: { version: contact.data!.version } },
        }),
      ),
    { success: "Contact deleted", onSuccess: () => navigate({ to: "/p/$projectId/contacts", params: { projectId } }) },
  );

  if (contact.isLoading) return <Loading />;
  if (!contact.data) return <EmptyState title="Contact not found" />;
  const c = contact.data;
  return (
    <div>
      <PageHeader
        title={c.name}
        actions={
          <>
            {can("contact:update") ? (
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {can("contact:delete") ? (
              <Button variant="ghost" size="icon" aria-label="Delete contact" onClick={() => remove.mutate(undefined)}>
                <Trash2 />
              </Button>
            ) : null}
            {can("contact:purge") ? (
              <Button variant="ghost" size="icon" aria-label="Erase personal data" onClick={() => setDialog("purge")}>
                <ShieldAlert />
              </Button>
            ) : null}
          </>
        }
      />
      {c.notes ? <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">{c.notes}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Works / worked at</CardTitle>
            {can("contact:update") ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("affiliation")}>
                <Plus /> Add
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {c.affiliations.length === 0 ? <p className="text-muted-foreground">No affiliations.</p> : null}
            {c.affiliations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2">
                <span>
                  {a.title ? `${a.title} at ` : ""}
                  <Link
                    to="/p/$projectId/organizations/$organizationId"
                    params={{ projectId, organizationId: a.organizationId }}
                    className="hover:underline"
                  >
                    {a.organizationName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    {a.from ? formatDate(a.from) : ""}
                    {a.to ? ` – ${formatDate(a.to)}` : a.from ? " – now" : ""}
                  </span>
                </span>
                {can("contact:update") ? (
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => removeAffiliation.mutate(a)}>
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How to reach</CardTitle>
            {can("contact:update") ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("handle")}>
                <Plus /> Add
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {c.handles.length === 0 ? <p className="text-muted-foreground">No handles.</p> : null}
            {c.handles.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground">{h.channelName}:</span> {h.value}
                </span>
                {can("contact:update") ? (
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => removeHandle.mutate(h)}>
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Interactions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-0.5 p-2">
          {actions.data?.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No interactions yet.</p>
          ) : null}
          {actions.data?.map((a) => (
            <ActionItem key={a.id} projectId={projectId} action={a} candidates={actions.data} />
          ))}
        </CardContent>
      </Card>
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">Comments</h3>
        <Comments projectId={projectId} targetType="contact" targetId={contactId} />
      </div>
      {dialog === "edit" ? <ContactDialog projectId={projectId} contact={c} onClose={() => setDialog(null)} /> : null}
      {dialog === "affiliation" ? (
        <AffiliationDialog projectId={projectId} contactId={contactId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "handle" ? (
        <HandleDialog projectId={projectId} contactId={contactId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "purge" ? (
        <PurgeDialog projectId={projectId} contactId={contactId} name={c.name} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function AffiliationDialog({
  projectId,
  contactId,
  onClose,
}: {
  projectId: string;
  contactId: string;
  onClose: () => void;
}) {
  const orgs = useOrganizations(projectId);
  const [organizationId, setOrganizationId] = useState("");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/contacts/{contactId}/affiliations", {
          params: { path: { projectId, contactId } },
          body: { organizationId, title: title || null, from: from || null, to: to || null },
        }),
      ),
    { onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add affiliation"
      description="Dates are optional. Leave “to” empty while current."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Organization" className="sm:col-span-2">
          <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
            <option value="">Choose…</option>
            {orgs.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!organizationId || save.isPending} onClick={() => save.mutate(undefined)}>
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function HandleDialog({
  projectId,
  contactId,
  onClose,
}: {
  projectId: string;
  contactId: string;
  onClose: () => void;
}) {
  const channels = useChannels(projectId);
  const [channelId, setChannelId] = useState("");
  const [value, setValue] = useState("");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/contacts/{contactId}/handles", {
          params: { path: { projectId, contactId } },
          body: { channelId, value },
        }),
      ),
    { onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={onClose} title="Add a way to reach them">
      <div className="grid gap-3">
        <Field label="Channel">
          <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Choose…</option>
            {channels.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Address, URL or number">
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!channelId || !value || save.isPending} onClick={() => save.mutate(undefined)}>
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PurgeDialog({
  projectId,
  contactId,
  name,
  onClose,
}: {
  projectId: string;
  contactId: string;
  name: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const purge = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/contacts/{contactId}/purge", {
          params: { path: { projectId, contactId } },
        }),
      ),
    { success: "Contact erased", onSuccess: () => navigate({ to: "/p/$projectId/contacts", params: { projectId } }) },
  );
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Erase this person permanently?"
      description="Removes the contact, their handles, affiliations and participation in actions, and redacts them from the change history. This cannot be undone."
    >
      <div className="grid gap-3">
        <Field label={`Type “${name}” to confirm`}>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirm !== name || purge.isPending}
            onClick={() => purge.mutate(undefined)}
          >
            Erase permanently
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

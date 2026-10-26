import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Copy, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { errorMessage, useMe } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

export function AccountPage() {
  const me = useMe();
  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3" /> Projects
      </Link>
      <PageHeader
        title="Account"
        subtitle={me.data?.email}
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut /> Sign out
          </Button>
        }
      />
      {me.data ? <ProfileCard name={me.data.name} timezone={me.data.timezone} /> : null}
      <ApiKeysCard />
      {me.data?.isInstanceAdmin ? <InstanceInvitationsCard /> : null}
    </div>
  );
}

function ProfileCard({ name: initialName, timezone: initialTz }: { name: string; timezone: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTz);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH("/api/me", { body: { name, timezone } })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Timezone"
          hint={
            timezone !== browserTz ? (
              <button
                type="button"
                className="cursor-pointer text-primary hover:underline"
                onClick={() => setTimezone(browserTz)}
              >
                Use this browser's timezone ({browserTz})
              </button>
            ) : (
              "Used for the agenda's day boundaries"
            )
          }
        >
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeysCard() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await authClient.apiKey.list();
      if (error) throw new Error(error.message);
      const list = Array.isArray(data) ? data : ((data as { apiKeys?: unknown[] } | null)?.apiKeys ?? []);
      return list as { id: string; name: string | null; start: string | null; createdAt: string | Date }[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.apiKey.create({ name });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (data) => {
      setCreated(data?.key ?? null);
      setName("");
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await authClient.apiKey.delete({ keyId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          For scripts and MCP clients without OAuth. A key acts as you, with your role in each project. Send it as{" "}
          <code className="rounded bg-muted px-1">Authorization: Bearer crm_…</code>.
        </p>
        {created ? (
          <div className="grid gap-2 rounded-md border border-warning/50 bg-warning/10 p-3">
            <span className="font-medium">Copy your new key now; it will not be shown again.</span>
            <div className="flex gap-2">
              <Input readOnly value={created} className="font-mono text-xs" aria-label="New API key" />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(created);
                  toast.success("Copied");
                }}
              >
                <Copy />
              </Button>
            </div>
          </div>
        ) : null}
        {keys.data?.map((k) => (
          <div key={k.id} className="flex items-center justify-between">
            <span>
              {k.name ?? "Unnamed"} <span className="font-mono text-xs text-muted-foreground">{k.start}…</span>
              <span className="text-xs text-muted-foreground"> · {formatDateTime(String(k.createdAt))}</span>
            </span>
            <Button variant="ghost" size="icon" aria-label="Revoke key" onClick={() => remove.mutate(k.id)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex max-w-md gap-2">
          <Input placeholder="Key name, e.g. laptop script" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Create key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InstanceInvitationsCard() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const invitations = useQuery({
    queryKey: ["instance-invitations"],
    queryFn: () => unwrap(api.GET("/api/admin/invitations")),
  });
  const invite = useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/invitations", { body: { email } })),
    onSuccess: async () => {
      setEmail("");
      toast.success("They can now sign up with that email");
      await qc.invalidateQueries({ queryKey: ["instance-invitations"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instance sign-ups (admin)</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          Sign-up is invite-only. Invitations to a project also allow sign-up; use this to let someone in without one.
        </p>
        {invitations.data?.items.map((i) => (
          <div key={i.email} className="flex justify-between">
            <span>{i.email}</span>
            <span className="text-xs text-muted-foreground">
              {i.usedAt ? `joined ${formatDateTime(i.usedAt)}` : "pending"}
            </span>
          </div>
        ))}
        <div className="flex max-w-md gap-2">
          <Input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button disabled={!email || invite.isPending} onClick={() => invite.mutate()}>
            Allow sign-up
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

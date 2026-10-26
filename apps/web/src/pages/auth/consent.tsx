import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorText } from "@/components/ui/misc";
import { authClient } from "@/lib/auth";

const SCOPE_TEXT: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected without asking again",
};

/** OAuth consent for MCP clients (ADR 0010). The client gets access only to the project in its MCP URL. */
export function ConsentPage() {
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get("client_id") ?? "an application";
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const resource = params.get("resource");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function decide(accept: boolean) {
    setPending(true);
    const { data, error } = await authClient.oauth2.consent({ accept });
    setPending(false);
    if (error) return setError(new Error(error.message ?? "Could not complete the request"));
    const url = (data as { url?: string } | null)?.url;
    if (url) window.location.href = url;
  }

  return (
    <div className="grid min-h-full place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="grid gap-4 p-6">
          <h1 className="text-base font-semibold">Allow access to Apply CRM?</h1>
          <p className="text-sm">
            <span className="font-mono text-xs">{clientId}</span> wants to use your CRM through MCP.
          </p>
          {resource ? (
            <p className="rounded-md bg-muted p-2 text-xs break-all text-muted-foreground">
              Project endpoint: {resource}
            </p>
          ) : null}
          <ul className="grid gap-1 text-sm">
            {scopes.map((s) => (
              <li key={s}>• {SCOPE_TEXT[s] ?? s}</li>
            ))}
            <li>• Read and change data in that project, limited by your role</li>
          </ul>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
              Deny
            </Button>
            <Button disabled={pending} onClick={() => decide(true)}>
              Allow
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

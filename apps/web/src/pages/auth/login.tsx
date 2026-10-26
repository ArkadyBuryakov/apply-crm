import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ErrorText } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { authClient } from "@/lib/auth";

function useInstanceConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => unwrap(api.GET("/api/config")) });
}

/** After sign-in: continue an OAuth authorization (MCP client) if one is pending, else go where the user was headed. */
function finish(result: unknown) {
  const url = (result as { url?: string; redirect?: boolean } | null)?.url;
  if (url) {
    window.location.href = url;
    return;
  }
  const target = new URLSearchParams(window.location.search).get("redirect");
  window.location.href = target?.startsWith("/") ? target : "/";
}

function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold">Apply CRM</span>
        </div>
        <Card>
          <CardContent className="grid gap-4 p-6">
            <h1 className="text-base font-semibold">{title}</h1>
            {children}
          </CardContent>
        </Card>
        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}

function SocialButtons() {
  const { data } = useInstanceConfig();
  if (!data?.socialProviders.length) return null;
  return (
    <div className="grid gap-2">
      {data.socialProviders.map((provider) => (
        <Button
          key={provider}
          variant="outline"
          onClick={() => authClient.signIn.social({ provider, callbackURL: window.location.origin })}
        >
          Continue with {provider === "github" ? "GitHub" : "Google"}
        </Button>
      ))}
      <div className="text-center text-xs text-muted-foreground">or</div>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const { data: config } = useInstanceConfig();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) return setError(new Error(error.message ?? "Sign-in failed"));
    finish(data);
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          {config?.unclaimed ? "This instance has no users yet. " : "Invited? "}
          <Link to="/signup" search={(s) => s} className="text-primary hover:underline">
            Create your account
          </Link>
        </>
      }
    >
      <SocialButtons />
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

export function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const { data: config } = useInstanceConfig();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (error) return setError(new Error(error.message ?? "Sign-up failed"));
    finish(data);
  }

  return (
    <AuthCard
      title={config?.unclaimed ? "Set up this instance" : "Create your account"}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={(s) => s} className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {config?.unclaimed
          ? "You are the first user: your account becomes the instance admin."
          : "Sign-up is invite-only. Use the email address your invitation was sent to."}
      </p>
      <SocialButtons />
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Name">
          <Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}

import { Loader2, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Spinner /> Loading…
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  phoneTitle = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** False on project pages whose title the phone header already shows; the heading is then only read out there. */
  phoneTitle?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-start justify-between gap-3",
        !phoneTitle && !subtitle && !actions && "max-md:mb-0",
      )}
    >
      <div className="min-w-0">
        <h1 className={cn("truncate text-xl font-semibold", !phoneTitle && "max-md:sr-only")}>{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 max-md:w-full">{actions}</div> : null}
    </div>
  );
}

/** A page's main create action on phones, floating above the tab bar; pages hide their header button there. */
export function Fab({ label, text, onClick }: { label: string; text?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-13 cursor-pointer items-center justify-center gap-1.5 rounded-2xl bg-primary font-medium text-primary-foreground shadow-lg shadow-primary/30 md:hidden",
        text ? "px-4" : "w-13",
      )}
    >
      <Plus className="size-5" />
      {text}
    </button>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</p>;
}

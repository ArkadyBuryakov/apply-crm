import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Stays in view below the scrolling body, e.g. for the submit buttons. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none",
            className,
          )}
        >
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
              )}
            </div>
            <D.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="-mx-5 -my-1 min-h-0 overflow-y-auto px-5 py-1">{children}</div>
          {footer ? (
            <div className="-mx-5 -mb-5 mt-4 flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

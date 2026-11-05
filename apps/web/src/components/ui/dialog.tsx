import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Full screen on phones, so the keyboard cannot hide the footer; a centered box from `sm` up. */
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
  /** Widths only apply from `sm` up, so prefix them: `sm:w-[…]`. */
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-card p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] focus:outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:w-[min(640px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-lg sm:border sm:border-border sm:p-5 sm:shadow-xl",
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
            <D.Close
              className="-m-1 rounded-md p-2 text-muted-foreground hover:bg-muted sm:m-0 sm:p-1"
              aria-label="Close"
            >
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="-mx-4 -my-1 min-h-0 flex-1 overflow-y-auto px-4 py-1 sm:-mx-5 sm:flex-initial sm:px-5">
            {children}
          </div>
          {footer ? (
            <div className="-mx-4 mb-[calc(-1rem-env(safe-area-inset-bottom))] mt-4 flex shrink-0 justify-end gap-2 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-3">
              {footer}
            </div>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** A panel that slides up from the bottom of the screen, for phone menus. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl focus:outline-none">
          <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-border" />
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

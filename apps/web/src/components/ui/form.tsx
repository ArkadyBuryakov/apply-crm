import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-9 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or nest the control
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children and nested in the label */}
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{label}</span>
        {children}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

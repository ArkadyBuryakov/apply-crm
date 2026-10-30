import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import { Children, type ComponentProps, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

type Option = { value: string; label: ReactNode; disabled?: boolean };
type OptionGroup = { label?: string; options: Option[] };
type ElementProps = { value?: string | number; label?: string; disabled?: boolean; children?: ReactNode };

// Radix reserves the empty string for "no value", which native selects use for their "none" options.
const EMPTY = "\u0000";

/** The <option> and <optgroup> children of a Select, read the way a native select would. */
function readOptions(children: ReactNode) {
  const groups: OptionGroup[] = [];
  let current: OptionGroup = { options: [] };
  groups.push(current);
  function visit(nodes: ReactNode, group?: OptionGroup) {
    for (const child of Children.toArray(nodes)) {
      if (!isValidElement(child)) continue;
      const { props } = child as ReactElement<ElementProps>;
      if (child.type === Fragment) visit(props.children, group);
      else if (child.type === "optgroup") {
        const labelled: OptionGroup = { label: props.label, options: [] };
        groups.push(labelled);
        visit(props.children, labelled);
        current = { options: [] };
        groups.push(current);
      } else if (child.type === "option") {
        (group ?? current).options.push({
          value: String(props.value ?? ""),
          label: props.children,
          disabled: props.disabled,
        });
      }
    }
  }
  visit(children);
  return groups.filter((g) => g.options.length);
}

/**
 * A select in the app's style that takes the same <option>/<optgroup> children and change handler as a native one.
 */
export function Select({
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  id,
  title,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  title?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const groups = readOptions(children);
  const toRadix = (v: string | undefined) => (v === "" ? EMPTY : v);
  return (
    <S.Root
      value={toRadix(value)}
      defaultValue={toRadix(defaultValue)}
      onValueChange={(v) => onChange?.({ target: { value: v === EMPTY ? "" : v } })}
      disabled={disabled}
      required={required}
      name={name}
    >
      <S.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        className={cn(
          control,
          "flex h-9 cursor-pointer items-center justify-between gap-2 pr-2 text-left data-[placeholder]:text-muted-foreground",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <S.Value />
        </span>
        <S.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card text-sm shadow-lg"
        >
          <S.Viewport className="p-1">
            {groups.map((group, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: groups have no identity besides their order
              <S.Group key={i}>
                {group.label ? (
                  <S.Label className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label}</S.Label>
                ) : null}
                {group.options.map((o) => (
                  <S.Item
                    key={o.value}
                    value={toRadix(o.value)!}
                    disabled={o.disabled}
                    className="flex cursor-pointer select-none items-center gap-2 rounded py-1.5 pl-2 pr-8 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 relative"
                  >
                    <S.ItemText>{o.label}</S.ItemText>
                    <S.ItemIndicator className="absolute right-2">
                      <Check className="size-4 text-primary" />
                    </S.ItemIndicator>
                  </S.Item>
                ))}
              </S.Group>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
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

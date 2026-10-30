import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Values use the native input formats ("2026-10-30" and "2026-10-30T09:00"), so these replace <input type="date"> and
// <input type="datetime-local"> without changing how callers read them.

type ChangeHandler = (e: { target: { value: string } }) => void;
type PickerProps = {
  value: string;
  onChange: ChangeHandler;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const monthTitle = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

export function DateInput({ value, onChange, className, placeholder = "Pick a date", ...props }: PickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Picker
      open={open}
      onOpenChange={setOpen}
      className={className}
      aria-label={props["aria-label"]}
      label={value ? dateLabel.format(fromKey(value)) : null}
      placeholder={placeholder}
    >
      <Calendar
        selected={value || null}
        onSelect={(day) => {
          onChange({ target: { value: day } });
          setOpen(false);
        }}
        onClear={() => {
          onChange({ target: { value: "" } });
          setOpen(false);
        }}
      />
    </Picker>
  );
}

export function DateTimeInput({
  value,
  onChange,
  className,
  placeholder = "Pick a date and time",
  ...props
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [day = "", time = ""] = value.split("T");
  const set = (d: string, t: string) => onChange({ target: { value: d ? `${d}T${t || "09:00"}` : "" } });
  return (
    <Picker
      open={open}
      onOpenChange={setOpen}
      className={className}
      aria-label={props["aria-label"]}
      label={value ? dateTimeLabel.format(new Date(value)) : null}
      placeholder={placeholder}
    >
      <Calendar
        selected={day || null}
        onSelect={(d) => set(d, time)}
        onClear={() => {
          onChange({ target: { value: "" } });
          setOpen(false);
        }}
      />
      <div className="flex items-center gap-2 border-t border-border p-2">
        <input
          type="time"
          aria-label="Time"
          value={time}
          onChange={(e) => set(day || toKey(new Date()), e.target.value)}
          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-calendar-picker-indicator]:hidden"
        />
        <Button size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Picker>
  );
}

function Picker({
  open,
  onOpenChange,
  label,
  placeholder,
  className,
  children,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string | null;
  placeholder: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={props["aria-label"]}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !label && "text-muted-foreground")}>{label ?? placeholder}</span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-md border border-border bg-card shadow-lg focus:outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A month grid starting on Monday. */
function Calendar({
  selected,
  onSelect,
  onClear,
}: {
  selected: string | null;
  onSelect: (day: string) => void;
  onClear: () => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = selected ? fromKey(selected) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = toKey(new Date());
  const offset = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - offset + 1));
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="p-2">
      <div className="mb-1 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium">{monthTitle.format(month)}</span>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="py-1">
            {weekday.format(d)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const key = toKey(d);
          const outside = d.getMonth() !== month.getMonth();
          return (
            <button
              key={key}
              type="button"
              aria-label={dayLabel.format(d)}
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
              className={cn(
                "h-8 cursor-pointer rounded-md text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                outside && "text-muted-foreground/60",
                key === today && "font-semibold text-primary",
                key === selected && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onSelect(today)}>
          Today
        </Button>
      </div>
    </div>
  );
}

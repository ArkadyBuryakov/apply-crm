import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";

export const PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

type Model = Schemas["AiModel"];

const providerLabel = (provider: string) => PROVIDER_LABELS[provider] ?? provider;

/** Model select with a search box that matches the provider's name as well as the model's. */
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: Model[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models.filter((m) => {
    const text = `${providerLabel(m.provider)} ${m.name} ${m.modelId}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const groups = new Map<string, Model[]>();
  for (const m of matches) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  // Options in display order, so arrow keys follow what is on screen.
  const ordered = [...groups.values()].flat();
  const selected = models.find((m) => m.id === value);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openChange(next: boolean) {
    setOpen(next);
    setQuery("");
    setActive(
      Math.max(
        0,
        ordered.findIndex((m) => m.id === value),
      ),
    );
  }

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (ordered.length ? (i + step + ordered.length) % ordered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const model = ordered[active];
      if (model) pick(model.id);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={openChange}>
      <Popover.Trigger
        aria-label="Model"
        title={selected ? `${providerLabel(selected.provider)} · ${selected.name}` : undefined}
        className="flex h-8 min-w-0 max-w-40 flex-1 cursor-pointer items-center gap-1 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.name ?? "Pick a model"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-md border border-border bg-card shadow-lg"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search models…"
              aria-label="Search models"
              aria-activedescendant={ordered[active] ? `model-${ordered[active].id}` : undefined}
              aria-controls="model-options"
              role="combobox"
              aria-expanded
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={list} id="model-options" role="listbox" className="max-h-72 overflow-y-auto p-1">
            {ordered.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">No models match.</p>
            ) : null}
            {[...groups].map(([provider, items]) => (
              // biome-ignore lint/a11y/useSemanticElements: a listbox option group, which <fieldset> is not
              <div key={provider} role="group" aria-label={providerLabel(provider)}>
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {providerLabel(provider)}
                </div>
                {items.map((m) => {
                  const index = ordered.indexOf(m);
                  return (
                    <div
                      key={m.id}
                      id={`model-${m.id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={m.id === value}
                      data-index={index}
                      onClick={() => pick(m.id)}
                      onKeyDown={onKeyDown}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm",
                        index === active && "bg-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {m.id === value ? <Check className="size-4 shrink-0 text-primary" /> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

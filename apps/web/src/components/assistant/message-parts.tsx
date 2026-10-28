import { type DynamicToolUIPart, getToolName, isToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import {
  Brain,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, humanize } from "@/lib/utils";
import { Markdown } from "./markdown";

type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ApprovalHandler = (approvalId: string, approved: boolean) => void;

export function MessageView({
  message,
  streaming,
  onApprove,
}: {
  message: UIMessage;
  streaming: boolean;
  onApprove: ApprovalHandler;
}) {
  if (message.role === "user") {
    const files = message.parts.filter((p) => p.type === "file");
    const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
    return (
      <div className="ml-8 grid justify-items-end gap-1.5">
        {files.length ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {files.map((f) => (
              <Attachment key={f.url} url={f.url} mediaType={f.mediaType} filename={f.filename} />
            ))}
          </div>
        ) : null}
        {text ? (
          <div className="whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground [overflow-wrap:anywhere]">
            {text}
          </div>
        ) : null}
      </div>
    );
  }

  const sources = message.parts.filter((p) => p.type === "source-url");
  const last = message.parts.at(-1);
  return (
    <div className="grid gap-2">
      {message.parts.map((part, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are only ever appended
        if (part.type === "text") return part.text ? <Markdown key={i} text={part.text} /> : null;
        if (part.type === "reasoning") {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are only ever appended
          return part.text ? <Reasoning key={i} text={part.text} active={streaming && part === last} /> : null;
        }
        if (isToolUIPart(part)) {
          return <ToolCall key={part.toolCallId} part={part} onApprove={onApprove} />;
        }
        if (part.type === "file") {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are only ever appended
          return <Attachment key={i} url={part.url} mediaType={part.mediaType} filename={part.filename} />;
        }
        return null;
      })}
      {sources.length ? (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) =>
            s.type === "source-url" ? (
              <a
                key={s.sourceId}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Globe className="size-3 shrink-0" />
                <span className="truncate">{s.title || new URL(s.url).hostname}</span>
              </a>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

function Reasoning({ text, active }: { text: string; active: boolean }) {
  return (
    <details className="group rounded-md text-xs text-muted-foreground" open={active || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-1 select-none hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Brain className="size-3" /> {active ? "Thinking…" : "Thought"}
      </summary>
      <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3">{text}</div>
    </details>
  );
}

const WEB_TOOLS = new Set(["web_search", "web_fetch", "google_search"]);

function toolLabel(name: string) {
  if (name === "navigate") return "Navigate";
  if (WEB_TOOLS.has(name)) return humanize(name);
  // listOrganizations → List organizations
  return humanize(name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
}

function ToolIcon({ name }: { name: string }) {
  if (name === "navigate") return <Compass className="size-3.5" />;
  if (WEB_TOOLS.has(name)) return <Globe className="size-3.5" />;
  return <Wrench className="size-3.5" />;
}

function ToolCall({ part, onApprove }: { part: ToolPart; onApprove: ApprovalHandler }) {
  const name = getToolName(part);
  const pending = part.state === "approval-requested" && !part.approval.isAutomatic;
  const status =
    part.state === "output-available" ? (
      <Check className="size-3.5 text-success" />
    ) : part.state === "output-error" || part.state === "output-denied" ? (
      <X className="size-3.5 text-destructive" />
    ) : pending ? (
      <ShieldQuestion className="size-3.5 text-warning" />
    ) : (
      <Loader2 className="size-3.5 animate-spin" />
    );
  const note =
    part.state === "output-denied"
      ? "denied"
      : part.state === "output-error"
        ? "failed"
        : part.state === "input-available" && name === "navigate"
          ? "opening…"
          : null;

  return (
    <div className={cn("rounded-md border text-xs", pending ? "border-warning/60 bg-warning/5" : "border-border")}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted-foreground select-none hover:text-foreground">
          <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
          <ToolIcon name={name} />
          <span className="truncate font-medium text-foreground">{toolLabel(name)}</span>
          {note ? <span>{note}</span> : null}
          <span className="ml-auto">{status}</span>
        </summary>
        <div className="grid gap-1.5 border-t border-border px-2 py-1.5">
          {part.input !== undefined ? <Json label="Input" value={part.input} /> : null}
          {part.state === "output-available" ? <Json label="Result" value={part.output} /> : null}
          {part.state === "output-error" ? <p className="text-destructive">{part.errorText}</p> : null}
        </div>
      </details>
      {pending ? (
        <div className="flex items-center gap-2 border-t border-warning/40 px-2 py-1.5">
          <span className="mr-auto text-muted-foreground">Allow this change?</span>
          <Button size="sm" variant="outline" onClick={() => onApprove(part.approval.id, false)}>
            Deny
          </Button>
          <Button size="sm" onClick={() => onApprove(part.approval.id, true)}>
            Allow
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <pre className="max-h-48 overflow-auto rounded bg-muted p-1.5 font-mono text-[11px]">{text}</pre>
    </div>
  );
}

export function Attachment({
  url,
  mediaType,
  filename,
  onRemove,
}: {
  url: string;
  mediaType: string;
  filename?: string | undefined;
  onRemove?: () => void;
}) {
  const image = mediaType.startsWith("image/");
  return (
    <div className="group relative">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card text-xs hover:bg-muted"
        title={filename}
      >
        {image ? (
          <img src={url} alt={filename ?? "Attachment"} className="h-16 max-w-40 object-cover" />
        ) : (
          <span className="flex max-w-48 items-center gap-1.5 px-2 py-1.5">
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">{filename ?? "File"}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
          </span>
        )}
      </a>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename ?? "attachment"}`}
          className="absolute -right-1.5 -top-1.5 grid size-4 cursor-pointer place-items-center rounded-full bg-foreground text-background"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

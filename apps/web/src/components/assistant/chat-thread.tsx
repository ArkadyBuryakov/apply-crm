import { useChat } from "@ai-sdk/react";
import { useRouter } from "@tanstack/react-router";
import {
  DefaultChatTransport,
  type FileUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Globe, Paperclip, RotateCcw, Square } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { Spinner } from "@/components/ui/misc";
import { type Schemas, uploadForm } from "@/lib/api";
import type { ApprovalMode } from "@/lib/assistant-prefs";
import { type NavigationInput, navigationToolDefinition, runNavigation } from "@/lib/navigation-tool";
import { errorMessage } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { ChatSettings } from "./assistant-panel";
import { Attachment, MessageView } from "./message-parts";

const APPROVAL_MODES: { value: ApprovalMode; label: string; title: string }[] = [
  { value: "manual", label: "Ask always", title: "Ask before every CRM action, even lookups" },
  { value: "read", label: "Allow reads", title: "Look things up freely; ask before changing or deleting" },
  { value: "write", label: "Allow writes", title: "Look things up and make changes freely; ask before deleting" },
  { value: "all", label: "Allow all", title: "Run every CRM action without asking, including deletes" },
];

const PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.tex,.cls,.bib,.csv,.json,.yaml,.yml";

export function ChatThread({
  projectId,
  chatId,
  initialMessages,
  ensureChat,
  settings,
  models,
  onSettingsChange,
  onTurnEnd,
}: {
  projectId: string;
  chatId: RefObject<string | null>;
  initialMessages: UIMessage[];
  ensureChat: () => Promise<string>;
  settings: ChatSettings;
  models: Schemas["AiModel"][];
  onSettingsChange: (change: Partial<ChatSettings>) => void;
  onTurnEnd: () => void;
}) {
  const router = useRouter();
  // Set when the browser has answered a navigation call, so the turn continues with its result.
  const navigated = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/projects/${projectId}/chats`,
        credentials: "include",
        prepareSendMessagesRequest: ({ messages }) => ({
          api: `/api/projects/${projectId}/chats/${chatId.current}/messages`,
          body: {
            message: messages.at(-1),
            navigation: navigationToolDefinition(router),
            page: router.state.location.href,
          },
        }),
      }),
    [chatId, projectId, router],
  );

  const { messages, sendMessage, status, error, stop, regenerate, addToolOutput, addToolApprovalResponse, clearError } =
    useChat({
      messages: initialMessages,
      transport,
      sendAutomaticallyWhen: ({ messages }) => {
        if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) return true;
        if (navigated.current && lastAssistantMessageIsCompleteWithToolCalls({ messages })) {
          navigated.current = false;
          return true;
        }
        return false;
      },
      onToolCall: async ({ toolCall }) => {
        if (toolCall.toolName !== "navigate") return;
        const output = await runNavigation(router, toolCall.input as NavigationInput, projectId);
        navigated.current = true;
        addToolOutput({ tool: "navigate", toolCallId: toolCall.toolCallId, output });
      },
      onFinish: onTurnEnd,
    });

  const busy = status === "submitted" || status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the messages change
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 ? <Intro /> : null}
        <div className="grid gap-4">
          {messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              streaming={busy && i === messages.length - 1}
              onApprove={(id, approved) => addToolApprovalResponse({ id, approved })}
            />
          ))}
          {status === "submitted" ? <Spinner /> : null}
          {error ? (
            <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <p className="text-destructive">{readableError(error)}</p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearError();
                    regenerate();
                  }}
                >
                  <RotateCcw /> Try again
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Composer
        projectId={projectId}
        busy={busy}
        ensureChat={ensureChat}
        onSend={(text, files) => sendMessage({ text, files })}
        onStop={stop}
        settings={settings}
        models={models}
        onSettingsChange={onSettingsChange}
      />
    </>
  );
}

function Intro() {
  return (
    <div className="mb-4 grid gap-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Ask about your job search.</p>
      <p>
        The assistant can look things up and record what happened in this project, open pages for you, read screenshots
        and documents you attach, and search the web when that is turned on.
      </p>
    </div>
  );
}

/** The transport reports failed requests with the response body as the message. */
function readableError(error: Error) {
  try {
    const body = JSON.parse(error.message) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {}
  return error.message || "Something went wrong";
}

type Uploaded = { url: string; mediaType: string; filename: string };

function Composer({
  projectId,
  busy,
  ensureChat,
  onSend,
  onStop,
  settings,
  models,
  onSettingsChange,
}: {
  projectId: string;
  busy: boolean;
  ensureChat: () => Promise<string>;
  onSend: (text: string, files: FileUIPart[]) => void;
  onStop: () => void;
  settings: ChatSettings;
  models: Schemas["AiModel"][];
  onSettingsChange: (change: Partial<ChatSettings>) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function upload(list: File[]) {
    if (!list.length) return;
    setUploading((n) => n + list.length);
    try {
      const chatId = await ensureChat();
      for (const file of list) {
        const form = new FormData();
        form.append("file", file, file.name || `screenshot-${Date.now()}.png`);
        try {
          const uploaded = await uploadForm<Uploaded>(`/api/projects/${projectId}/chats/${chatId}/attachments`, form);
          setFiles((f) => [...f, uploaded]);
        } catch (e) {
          toast.error(`${file.name || "File"}: ${errorMessage(e)}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    } catch (e) {
      setUploading(0);
      toast.error(errorMessage(e));
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || uploading || (!text.trim() && files.length === 0)) return;
    try {
      await ensureChat();
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    onSend(
      text.trim(),
      files.map((f) => ({ type: "file", url: f.url, mediaType: f.mediaType, filename: f.filename })),
    );
    setText("");
    setFiles([]);
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) {
      e.preventDefault();
      upload(pasted);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    upload([...e.dataTransfer.files]);
  }

  const byProvider = new Map<string, Schemas["AiModel"][]>();
  for (const m of models) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn("grid gap-2 border-t border-border p-2", dragging && "bg-accent")}
    >
      {files.length || uploading ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {files.map((f) => (
            <Attachment key={f.url} {...f} onRemove={() => setFiles((list) => list.filter((x) => x.url !== f.url))} />
          ))}
          {uploading ? <Spinner /> : null}
        </div>
      ) : null}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask, or paste a screenshot…"
        aria-label="Message"
        rows={2}
        className="max-h-48 min-h-16 resize-none"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Attach files"
          title="Attach files"
          onClick={() => picker.current?.click()}
        >
          <Paperclip />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Web search"
          aria-pressed={settings.webSearch}
          title={settings.webSearch ? "Web search is on" : "Web search is off"}
          className={cn(settings.webSearch && "bg-accent text-primary")}
          onClick={() => onSettingsChange({ webSearch: !settings.webSearch })}
        >
          <Globe />
        </Button>
        <Select
          aria-label="Model"
          className="h-8 w-auto min-w-0 max-w-40 flex-1 text-xs"
          value={settings.model ?? ""}
          onChange={(e) => onSettingsChange({ model: e.target.value })}
        >
          {[...byProvider].map(([provider, list]) => (
            <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select
          aria-label="Approval mode"
          title={APPROVAL_MODES.find((m) => m.value === settings.approvalMode)?.title}
          className="h-8 w-auto min-w-0 max-w-40 flex-1 text-xs"
          value={settings.approvalMode}
          onChange={(e) => onSettingsChange({ approvalMode: e.target.value as ApprovalMode })}
        >
          {APPROVAL_MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.title}>
              {m.label}
            </option>
          ))}
        </Select>
        {busy ? (
          <Button size="icon" variant="outline" aria-label="Stop" title="Stop" className="ml-auto" onClick={onStop}>
            <Square />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            title="Send (Enter)"
            className="ml-auto"
            disabled={uploading > 0 || (!text.trim() && files.length === 0)}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}

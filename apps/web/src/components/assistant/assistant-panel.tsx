// The in-app assistant (ADR 0031): a right sidebar with the current chat, its history and its settings.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, MessageSquarePlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { USER_MEMORIES_KEY } from "@/components/memory";
import { Button } from "@/components/ui/button";
import { Loading, Spinner } from "@/components/ui/misc";
import { api, type Schemas, unwrap } from "@/lib/api";
import { type ApprovalMode, activeChat, getDefaults, saveDefaults } from "@/lib/assistant-prefs";
import { errorMessage, invalidateProject } from "@/lib/queries";
import { cn, formatDateTime } from "@/lib/utils";
import { ChatThread } from "./chat-thread";

export type ChatSettings = { model: string | null; approvalMode: ApprovalMode; webSearch: boolean };
type ChatWithMessages = Schemas["Chat"] & { messages: Schemas["ChatMessage"][] };

const chatKey = (chatId: string | null) => ["assistant-chat", chatId] as const;

export function useAiModels() {
  return useQuery({
    queryKey: ["ai-models"],
    queryFn: () => unwrap(api.GET("/api/me/ai/models")),
    staleTime: 10 * 60_000,
  });
}

export function AssistantPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [chatId, setChatId] = useState<string | null>(() => activeChat.get(projectId));
  const chatIdRef = useRef(chatId);
  // The thread is remounted when another chat is opened, not when a new chat gets its id on the first message.
  const [threadKey, setThreadKey] = useState(() => chatId ?? `draft-${Date.now()}`);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState<ChatSettings>(getDefaults);
  const models = useAiModels();

  const chat = useQuery({
    queryKey: chatKey(chatId),
    enabled: chatId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () =>
      unwrap(api.GET("/api/projects/{projectId}/chats/{chatId}", { params: { path: { projectId, chatId: chatId! } } })),
  });

  const open = useCallback(
    (id: string | null) => {
      // Reopened chats are loaded fresh: the cached copy has only the messages it had when it was first loaded.
      if (id) qc.removeQueries({ queryKey: chatKey(id) });
      chatIdRef.current = id;
      setChatId(id);
      activeChat.set(projectId, id);
      setThreadKey(id ?? `draft-${Date.now()}`);
      setShowHistory(false);
      if (!id) setDraft(getDefaults());
    },
    [projectId, qc],
  );

  // A chat deleted elsewhere starts a new one.
  useEffect(() => {
    if (chat.isError && chatId) open(null);
  }, [chat.isError, chatId, open]);

  const available = models.data?.items ?? [];
  const settings: ChatSettings = chat.data
    ? { model: chat.data.model, approvalMode: chat.data.approvalMode, webSearch: chat.data.webSearch }
    : draft;
  const model = settings.model && available.some((m) => m.id === settings.model) ? settings.model : available[0]?.id;

  async function updateSettings(change: Partial<ChatSettings>) {
    saveDefaults(change);
    const id = chatIdRef.current;
    if (!id) {
      setDraft((d) => ({ ...d, ...change }));
      return;
    }
    try {
      const updated = await unwrap(
        api.PATCH("/api/projects/{projectId}/chats/{chatId}", {
          params: { path: { projectId, chatId: id } },
          body: { ...change, ...(change.model === null ? { model: undefined } : {}) } as never,
        }),
      );
      qc.setQueryData<ChatWithMessages>(chatKey(id), (old) => (old ? { ...old, ...updated } : old));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** New chats are created when the first message or attachment needs them. */
  const ensureChat = useCallback(async () => {
    if (chatIdRef.current) return chatIdRef.current;
    if (!model) throw new Error("Pick a model first");
    const created = await unwrap(
      api.POST("/api/projects/{projectId}/chats", {
        params: { path: { projectId } },
        body: { model, approvalMode: settings.approvalMode, webSearch: settings.webSearch },
      }),
    );
    chatIdRef.current = created.id;
    qc.setQueryData<ChatWithMessages>(chatKey(created.id), { ...created, messages: [] });
    setChatId(created.id);
    activeChat.set(projectId, created.id);
    return created.id;
  }, [model, projectId, qc, settings.approvalMode, settings.webSearch]);

  const loading = chatId !== null && chat.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Chat history"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((v) => !v)}
          className={cn(showHistory && "bg-muted")}
        >
          <History />
        </Button>
        <div className="min-w-0 flex-1 truncate px-1 text-sm font-medium" title={chat.data?.title}>
          {showHistory ? "Chats" : (chat.data?.title ?? "New chat")}
        </div>
        <Button variant="ghost" size="icon" aria-label="New chat" title="New chat" onClick={() => open(null)}>
          <MessageSquarePlus />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close assistant" title="Close (Ctrl+J)" onClick={onClose}>
          <X />
        </Button>
      </div>

      {showHistory ? (
        <ChatHistory projectId={projectId} currentId={chatId} onOpen={open} />
      ) : loading ? (
        <Loading />
      ) : models.isLoading ? (
        <Loading />
      ) : available.length === 0 ? (
        <NoModels errors={models.data?.errors ?? []} />
      ) : (
        <ChatThread
          key={threadKey}
          projectId={projectId}
          chatId={chatIdRef}
          initialMessages={(chat.data?.messages ?? []) as never}
          ensureChat={ensureChat}
          settings={{ ...settings, model: model ?? null }}
          models={available}
          onSettingsChange={updateSettings}
          onTurnEnd={() => {
            // Tools may have changed project data or the user's memory; the chat list shows the new title and order.
            invalidateProject(qc, projectId);
            qc.invalidateQueries({ queryKey: USER_MEMORIES_KEY });
            qc.invalidateQueries({ queryKey: ["assistant-chats", projectId] });
          }}
        />
      )}
    </div>
  );
}

function NoModels({ errors }: { errors: { provider: string; message: string }[] }) {
  return (
    <div className="grid gap-2 p-4 text-sm">
      <p>To chat, add an API key for Anthropic, OpenAI or Google.</p>
      {errors.map((e) => (
        <p key={e.provider} className="text-destructive">
          {e.provider}: {e.message}
        </p>
      ))}
      <Link to="/account" hash="ai" className="text-primary hover:underline">
        Add a key in Account → AI
      </Link>
    </div>
  );
}

function ChatHistory({
  projectId,
  currentId,
  onOpen,
}: {
  projectId: string;
  currentId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const chats = useQuery({
    queryKey: ["assistant-chats", projectId],
    queryFn: () => unwrap(api.GET("/api/projects/{projectId}/chats", { params: { path: { projectId } } })),
  });

  async function remove(chatId: string) {
    try {
      await unwrap(api.DELETE("/api/projects/{projectId}/chats/{chatId}", { params: { path: { projectId, chatId } } }));
      qc.removeQueries({ queryKey: chatKey(chatId) });
      await qc.invalidateQueries({ queryKey: ["assistant-chats", projectId] });
      if (chatId === currentId) onOpen(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setConfirming(null);
    }
  }

  if (chats.isLoading) return <Loading />;
  const items = chats.data?.items ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {items.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No chats yet.</p> : null}
      {items.map((c) => (
        <div
          key={c.id}
          className={cn("group flex items-center gap-1 rounded-md hover:bg-muted", c.id === currentId && "bg-muted")}
        >
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-left"
            onClick={() => onOpen(c.id)}
          >
            <div className="truncate text-sm">{c.title}</div>
            <div className="text-xs text-muted-foreground">{formatDateTime(c.updatedAt)}</div>
          </button>
          {confirming === c.id ? (
            <Button size="sm" variant="destructive" onClick={() => remove(c.id)}>
              Delete
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${c.title}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setConfirming(c.id)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
      {chats.isFetching ? <Spinner className="m-2" /> : null}
    </div>
  );
}

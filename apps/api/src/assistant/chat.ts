// One assistant turn (ADR 0031): merge the incoming message into the stored history, inline attachments, run the tool
// loop against the user's provider and stream it to the SPA, then store the updated history.
import { chat, chatAttachment, chatMessage, type Db, project } from "@crm/db";
import { type ChatApprovalMode, fromPublicId, type ProjectRole } from "@crm/shared";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModel,
  type SystemModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { and, asc, eq } from "drizzle-orm";
import { badRequest } from "../http/errors.js";
import type { Actor, AppEnv } from "../http/types.js";
import type { ToolDefinition } from "../mcp/catalog.js";
import { CRM_INSTRUCTIONS } from "../mcp/server.js";
import type { BlobStore } from "../services/blobs.js";
import { loadMemories, renderMemories } from "../services/memory.js";
import { cacheBreakpoint, type ModelRef, providerOptions, webSearchTools } from "./providers.js";
import { approvalPolicy, crmTools, NAVIGATE_TOOL, type NavigationDefinition, navigationTool } from "./tools.js";

const MAX_STEPS = 25;
// Assistant message ids are made on the server so the stored history and the client agree on them.
const messageId = createIdGenerator({ prefix: "msg", size: 16 });
const TITLE_LENGTH = 60;
export const NEW_CHAT_TITLE = "New chat";

type ChatRow = typeof chat.$inferSelect;

export async function loadMessages(db: Db, chatId: string): Promise<UIMessage[]> {
  const rows = await db.select().from(chatMessage).where(eq(chatMessage.chatId, chatId)).orderBy(asc(chatMessage.seq));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage["role"],
    parts: r.parts as UIMessage["parts"],
    ...(r.metadata ? { metadata: r.metadata } : {}),
  }));
}

/**
 * The client sends only its newest message. A resubmitted assistant message (after an approval or a navigation result)
 * replaces the stored one with the same id; resubmitting the latest user message retries it and drops the replies
 * that followed it. Anything else is appended.
 */
export function mergeIncoming(history: UIMessage[], incoming: UIMessage): UIMessage[] {
  const index = history.findIndex((m) => m.id === incoming.id);
  if (index === -1) {
    if (incoming.role !== "user") throw badRequest("Only user messages can start a new turn");
    return [...history, incoming];
  }
  if (incoming.role !== history[index]!.role) throw badRequest("A resubmitted message cannot change its role");
  const later = history.slice(index + 1);
  const retry = incoming.role === "user" && later.every((m) => m.role === "assistant");
  if (later.length && !retry) throw badRequest("Only the latest message can be resubmitted");
  return [...history.slice(0, index), incoming];
}

export async function saveMessages(db: Db, row: ChatRow, messages: UIMessage[]) {
  await db.transaction(async (tx) => {
    await tx.delete(chatMessage).where(eq(chatMessage.chatId, row.id));
    if (messages.length) {
      await tx.insert(chatMessage).values(
        messages.map((m, seq) => ({
          chatId: row.id,
          id: m.id,
          seq,
          role: m.role,
          parts: m.parts,
          metadata: m.metadata ?? null,
        })),
      );
    }
    const title = row.title === NEW_CHAT_TITLE ? titleFrom(messages) : null;
    await tx
      .update(chat)
      .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
      .where(eq(chat.id, row.id));
  });
}

function titleFrom(messages: UIMessage[]) {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Attachments

const ATTACHMENT_URL = /^\/api\/projects\/[^/]+\/chats\/([^/]+)\/attachments\/([^/?#]+)$/;

export function attachmentUrl(projectPublicId: string, chatPublicId: string, attachmentPublicId: string) {
  return `/api/projects/${projectPublicId}/chats/${chatPublicId}/attachments/${attachmentPublicId}`;
}

export const isTextMime = (mime: string) => mime.startsWith("text/") || mime === "application/json";

/**
 * Messages reference uploads by URL; models need the bytes. Text files become text parts so every provider can read
 * them. Only this chat's attachments are resolved.
 */
async function inlineAttachments(db: Db, blobs: BlobStore, chatId: string, messages: UIMessage[]) {
  const rows = await db.select().from(chatAttachment).where(eq(chatAttachment.chatId, chatId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const contents = new Map<string, Uint8Array>();
  const load = async (key: string) => {
    if (!contents.has(key)) {
      const bytes = await blobs.get(key);
      if (!bytes) throw badRequest("An attachment of this chat is missing");
      contents.set(key, bytes);
    }
    return contents.get(key)!;
  };

  const out: UIMessage[] = [];
  for (const message of messages) {
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type !== "file") {
        parts.push(part);
        continue;
      }
      const match = ATTACHMENT_URL.exec(part.url);
      const attachment = match ? byId.get(fromPublicId("chatAttachment", match[2]!) ?? "") : undefined;
      if (!attachment || fromPublicId("chat", match![1]!) !== chatId) {
        throw badRequest(`Unknown attachment ${part.filename ?? part.url}`);
      }
      const bytes = await load(attachment.blobKey);
      if (isTextMime(attachment.mime)) {
        const text = new TextDecoder().decode(bytes);
        parts.push({ type: "text", text: `<file name="${attachment.filename}">\n${text}\n</file>` });
      } else {
        const data = Buffer.from(bytes).toString("base64");
        parts.push({ ...part, url: `data:${attachment.mime};base64,${data}` });
      }
    }
    out.push({ ...message, parts });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The turn

export type TurnInput = {
  app: OpenAPIHono<AppEnv>;
  db: Db;
  blobs: BlobStore;
  catalog: ToolDefinition[];
  actor: Actor;
  role: ProjectRole;
  projectId: string;
  projectPublicId: string;
  chat: ChatRow;
  model: ModelRef;
  languageModel: LanguageModel;
  apiKey: string;
  message: UIMessage;
  navigation?: NavigationDefinition;
  page?: string;
  signal?: AbortSignal;
};

export async function runTurn(input: TurnInput): Promise<Response> {
  const history = mergeIncoming(await loadMessages(input.db, input.chat.id), input.message);
  const tools = {
    ...crmTools(input.app, input.catalog, {
      actor: { ...input.actor, via: "chat" },
      role: input.role,
      projectPublicId: input.projectPublicId,
    }),
    ...(input.navigation ? navigationTool(input.navigation) : {}),
    ...(input.chat.webSearch ? webSearchTools(input.model, input.apiKey) : {}),
  };
  const [[projectRow], memories] = await Promise.all([
    input.db.select({ name: project.name }).from(project).where(eq(project.id, input.projectId)),
    loadMemories(input.db, input.actor.userId, input.projectId),
  ]);
  const modelMessages = await convertToModelMessages(
    await inlineAttachments(input.db, input.blobs, input.chat.id, history),
    { tools, ignoreIncompleteToolCalls: true },
  );

  const result = streamText({
    model: input.languageModel,
    instructions: instructions(input, projectRow?.name ?? "this project", renderMemories(memories)),
    messages: modelMessages,
    tools,
    toolApproval: approvalPolicy(input.chat.approvalMode as ChatApprovalMode, input.catalog),
    stopWhen: isStepCount(MAX_STEPS),
    providerOptions: providerOptions(input.model),
    abortSignal: input.signal,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: history,
      generateMessageId: messageId,
      sendReasoning: true,
      sendSources: true,
      // The key belongs to the user, so provider errors (bad key, unknown model, quota) are theirs to see.
      onError: (error) => (error instanceof Error ? error.message : String(error)),
      onEnd: async ({ messages }) => {
        await saveMessages(input.db, input.chat, messages);
      },
    }),
  });
}

function instructions(input: TurnInput, projectName: string, memory: string): SystemModelMessage[] {
  const stable = [
    `You are the assistant built into Apply CRM, a self-hosted job-search CRM. You work inside the project ` +
      `"${projectName}", where the user's role is ${input.role}.`,
    CRM_INSTRUCTIONS,
    "Use the CRM tools to look things up instead of guessing, and to make the changes the user asks for. Some tool " +
      "calls wait for the user's approval; if the user denies one, do not retry it, ask what they want instead.",
    `Use the \`${NAVIGATE_TOOL}\` tool to open a page in the app when the user asks to see something or when ` +
      "showing it helps more than describing it. Navigating does not change any data.",
    "Answer in Markdown. Refer to records by their names; mention IDs only when the user needs them.",
  ].join("\n\n");
  const now = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: input.actor.timezone,
  }).format(new Date());
  const context = [
    `The user is ${input.actor.name} (${input.actor.email}). It is ${now} in their timezone (${input.actor.timezone}).`,
    input.chat.webSearch ? "Web search is on." : "Web search is off; say so if the user asks for something on the web.",
    input.page ? `The user is looking at the page ${input.page}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: stable, providerOptions: cacheBreakpoint(input.model) },
    // Memory changes when the assistant saves something, so it stays out of the cached prefix.
    { role: "system", content: memory },
    { role: "system", content: context },
  ];
}

export async function chatOwnedBy(db: Db, chatId: string, projectId: string, userId: string) {
  const [row] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.projectId, projectId), eq(chat.userId, userId)));
  return row ?? null;
}

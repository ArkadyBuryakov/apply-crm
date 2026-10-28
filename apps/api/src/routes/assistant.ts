// In-app assistant (ADR 0031): the user's provider keys and models, and their private chats in a project.

import { aiCredential, chat, chatAttachment } from "@crm/db";
import { AI_PROVIDERS, type AiProvider, CHAT_APPROVAL_MODES, newUuid } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { UIMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { attachmentUrl, chatOwnedBy, isTextMime, loadMessages, NEW_CHAT_TITLE, runTurn } from "../assistant/chat.js";
import { encryptApiKey, loadApiKey, loadApiKeys } from "../assistant/credentials.js";
import { type ModelInfo, PROVIDER_NAMES, ProviderKeyError, parseModelRef } from "../assistant/providers.js";
import { badRequest, errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  jsonBody,
  jsonResponse,
  NoContent,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  withProject,
} from "../http/route.js";
import { iso, pid } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import type { ToolDefinition } from "../mcp/catalog.js";
import { blobKeys } from "../services/blobs.js";
import { asFiles, MAX_UPLOAD_BYTES, safeFilename } from "./documents.js";

const ProviderSchema = z.enum(AI_PROVIDERS).openapi("AiProvider");
const ApprovalModeSchema = z.enum(CHAT_APPROVAL_MODES).openapi("ChatApprovalMode", {
  description:
    "Which CRM tool calls run without asking: manual (none), read (reads), write (reads and writes), all (also deletes)",
});

const ProviderStatusSchema = z
  .object({
    provider: ProviderSchema,
    name: z.string(),
    configured: z.boolean(),
    last4: z.string().nullable().openapi({ description: "Last four characters of the stored key" }),
    updatedAt: Timestamp.nullable(),
  })
  .openapi("AiProviderStatus");

const ModelSchema = z
  .object({
    id: z
      .string()
      .openapi({ description: "provider:modelId, as stored on chats", example: "anthropic:claude-opus-5-5" }),
    provider: ProviderSchema,
    modelId: z.string(),
    name: z.string(),
  })
  .openapi("AiModel");

const ModelRefSchema = z
  .string()
  .refine((v) => parseModelRef(v) !== null, { message: "Use provider:modelId" })
  .openapi({ example: "anthropic:claude-opus-5-5" });

const ChatSchema = z
  .object({
    id: publicId("chat"),
    title: z.string(),
    model: z.string(),
    approvalMode: ApprovalModeSchema,
    webSearch: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Chat");

const UIMessageSchema = z
  .looseObject({
    id: z.string().min(1).max(200),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.looseObject({ type: z.string() })),
    metadata: z.unknown().optional(),
  })
  .openapi("ChatMessage", { description: "An AI SDK UIMessage" });

const AttachmentSchema = z
  .object({
    id: publicId("chatAttachment"),
    url: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    size: z.int(),
  })
  .openapi("ChatAttachment");

const ChatParams = withProject({ chatId: pathId("chat", "chatId") });
const ProviderParams = z.object({ provider: ProviderSchema.openapi({ param: { name: "provider", in: "path" } }) });

const tags = ["Assistant"];

const listProviders = defineRoute({
  method: "get",
  path: "/api/me/ai/providers",
  operationId: "listAiProviders",
  summary: "List model providers and whether you have a key for each",
  description: "Keys are never returned, only their last four characters.",
  scope: "user",
  permissions: [],
  tags,
  responses: { 200: jsonResponse(z.object({ items: z.array(ProviderStatusSchema) }), "Providers") },
});

const setProviderKey = defineRoute({
  method: "put",
  path: "/api/me/ai/providers/{provider}",
  operationId: "setAiProviderKey",
  summary: "Save your API key for a model provider",
  description: "The key is checked by listing the provider's models, then stored encrypted.",
  scope: "user",
  permissions: [],
  tags,
  request: {
    params: ProviderParams,
    body: jsonBody(z.object({ apiKey: z.string().trim().min(8).max(500) })),
  },
  responses: { 200: jsonResponse(ProviderStatusSchema, "Saved"), ...errorResponses(400) },
});

const deleteProviderKey = defineRoute({
  method: "delete",
  path: "/api/me/ai/providers/{provider}",
  operationId: "deleteAiProviderKey",
  summary: "Remove your API key for a model provider",
  description: "Chats using this provider's models stop working until a key is saved again.",
  scope: "user",
  permissions: [],
  tags,
  request: { params: ProviderParams },
  responses: { 204: NoContent },
});

const listAiModels = defineRoute({
  method: "get",
  path: "/api/me/ai/models",
  operationId: "listAiModels",
  summary: "List the models your keys can use",
  description: "Fetched live from each provider you have a key for. Providers that fail are listed in `errors`.",
  scope: "user",
  permissions: [],
  tags,
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(ModelSchema),
        errors: z.array(z.object({ provider: ProviderSchema, message: z.string() })),
      }),
      "Models",
    ),
  },
});

const listChats = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/chats",
  operationId: "listChats",
  summary: "List your chats in this project",
  description: "Most recently used first. Chats are private: other members never see them.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: {
    params: withProject({}),
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
  },
  responses: { 200: jsonResponse(z.object({ items: z.array(ChatSchema) }), "Chats") },
});

const createChat = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/chats",
  operationId: "createChat",
  summary: "Start a chat",
  description: "Creates an empty chat; send messages to it with sendChatMessage.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: {
    params: withProject({}),
    body: jsonBody(
      z.object({
        model: ModelRefSchema,
        approvalMode: ApprovalModeSchema.default("read"),
        webSearch: z.boolean().default(false),
      }),
    ),
  },
  responses: { 201: jsonResponse(ChatSchema, "Created") },
});

const getChat = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/chats/{chatId}",
  operationId: "getChat",
  summary: "Get a chat with its messages",
  description: "Messages are AI SDK UIMessages, oldest first.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: { params: ChatParams },
  responses: {
    200: jsonResponse(ChatSchema.extend({ messages: z.array(UIMessageSchema) }), "Chat"),
    ...errorResponses(404),
  },
});

const updateChat = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/chats/{chatId}",
  operationId: "updateChat",
  summary: "Rename a chat or change its model, approval mode or web search",
  description: "Changes apply from the next message on.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: {
    params: ChatParams,
    body: jsonBody(
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        model: ModelRefSchema.optional(),
        approvalMode: ApprovalModeSchema.optional(),
        webSearch: z.boolean().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse(ChatSchema, "Updated"), ...errorResponses(404) },
});

const deleteChat = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/chats/{chatId}",
  operationId: "deleteChat",
  summary: "Delete a chat",
  description: "Deletes the chat, its messages and its attachments permanently.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: { params: ChatParams },
  responses: { 204: NoContent, ...errorResponses(404) },
});

const sendMessage = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/chats/{chatId}/messages",
  operationId: "sendChatMessage",
  summary: "Send a message and stream the assistant's reply",
  description:
    "Send only the newest message: a new user message, or the latest assistant message again after answering an " +
    "approval request or a navigation call. The reply is an AI SDK UI message stream (server-sent events). " +
    "`navigation` is the browser-executed navigation tool; `page` is the path the user is looking at.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: {
    params: ChatParams,
    body: jsonBody(
      z.object({
        message: UIMessageSchema,
        navigation: z
          .object({ description: z.string().max(50_000), inputSchema: z.record(z.string(), z.unknown()) })
          .optional(),
        page: z.string().max(2000).optional(),
      }),
    ),
  },
  responses: {
    200: { description: "UI message stream", content: { "text/event-stream": { schema: z.string() } } },
    ...errorResponses(400, 404),
  },
});

const uploadAttachment = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/chats/{chatId}/attachments",
  operationId: "uploadChatAttachment",
  summary: "Attach a file to a chat",
  description:
    `Images (PNG, JPEG, WebP, GIF), PDFs and text files (Markdown, LaTeX, CSV, JSON, …) up to ` +
    `${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Reference the returned URL in a message's file part.`,
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: {
    params: ChatParams,
    body: {
      required: true,
      content: {
        "multipart/form-data": { schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }) },
      },
    },
  },
  responses: { 201: jsonResponse(AttachmentSchema, "Attached"), ...errorResponses(400, 404) },
});

const downloadAttachment = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/chats/{chatId}/attachments/{attachmentId}",
  operationId: "downloadChatAttachment",
  summary: "Download a chat attachment",
  description: "The file as uploaded.",
  scope: "project",
  permissions: ["project:read"],
  tags,
  request: { params: ChatParams.extend({ attachmentId: pathId("chatAttachment", "attachmentId") }) },
  responses: {
    200: {
      description: "File",
      content: { "application/octet-stream": { schema: z.any().openapi({ type: "string", format: "binary" }) } },
    },
    ...errorResponses(404),
  },
});

// ---------------------------------------------------------------------------

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TEXT_EXTENSIONS = /\.(md|markdown|txt|tex|cls|sty|bib|csv|tsv|json|ya?ml|xml|html?|log)$/i;

/** The media type the model will see, or null when the file is not something models can read. */
function attachmentMime(filename: string, type: string): string | null {
  if (IMAGE_TYPES.includes(type) || type === "application/pdf") return type;
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  if (isTextMime(type)) return type;
  if (TEXT_EXTENSIONS.test(filename)) return "text/plain";
  return null;
}

type ChatRow = typeof chat.$inferSelect;

function chatJson(row: ChatRow) {
  return {
    id: pid("chat", row.id),
    title: row.title,
    model: row.model,
    approvalMode: row.approvalMode as (typeof CHAT_APPROVAL_MODES)[number],
    webSearch: row.webSearch,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function providerName(provider: AiProvider) {
  return PROVIDER_NAMES[provider];
}

export function registerAssistantRoutes(app: OpenAPIHono<AppEnv>, catalog: () => ToolDefinition[]) {
  app.openapi(listProviders, async (c) => {
    const { db } = c.var.deps;
    const rows = await db.select().from(aiCredential).where(eq(aiCredential.userId, c.var.actor!.userId));
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return c.json(
      {
        items: AI_PROVIDERS.map((provider) => {
          const row = byProvider.get(provider);
          return {
            provider,
            name: providerName(provider),
            configured: Boolean(row),
            last4: row?.last4 ?? null,
            updatedAt: row ? iso(row.updatedAt) : null,
          };
        }),
      },
      200,
    );
  });

  app.openapi(setProviderKey, async (c) => {
    const { db, env } = c.var.deps;
    const { provider } = c.req.valid("param");
    const { apiKey } = c.req.valid("json");
    try {
      await c.var.deps.services.ai.listModels(provider, apiKey);
    } catch (err) {
      throw badRequest(
        err instanceof ProviderKeyError
          ? `${providerName(provider)} rejected this key`
          : `Could not check the key with ${providerName(provider)}: ${(err as Error).message}`,
      );
    }
    const now = new Date();
    const values = {
      encryptedKey: encryptApiKey(env.BETTER_AUTH_SECRET, apiKey),
      last4: apiKey.slice(-4),
      updatedAt: now,
    };
    const [row] = await db
      .insert(aiCredential)
      .values({ userId: c.var.actor!.userId, provider, ...values })
      .onConflictDoUpdate({ target: [aiCredential.userId, aiCredential.provider], set: values })
      .returning();
    return c.json(
      { provider, name: providerName(provider), configured: true, last4: row!.last4, updatedAt: iso(row!.updatedAt) },
      200,
    );
  });

  app.openapi(deleteProviderKey, async (c) => {
    const { provider } = c.req.valid("param");
    await c.var.deps.db
      .delete(aiCredential)
      .where(and(eq(aiCredential.userId, c.var.actor!.userId), eq(aiCredential.provider, provider)));
    return c.body(null, 204);
  });

  app.openapi(listAiModels, async (c) => {
    const { db, env } = c.var.deps;
    const keys = await loadApiKeys(db, env.BETTER_AUTH_SECRET, c.var.actor!.userId);
    const items: ModelInfo[] = [];
    const errors: { provider: AiProvider; message: string }[] = [];
    await Promise.all(
      [...keys].map(async ([provider, key]) => {
        try {
          items.push(...(await c.var.deps.services.ai.listModels(provider, key)));
        } catch (err) {
          errors.push({ provider, message: (err as Error).message });
        }
      }),
    );
    items.sort((a, b) => AI_PROVIDERS.indexOf(a.provider) - AI_PROVIDERS.indexOf(b.provider));
    return c.json({ items, errors }, 200);
  });

  app.openapi(listChats, async (c) => {
    const { db } = c.var.deps;
    const rows = await db
      .select()
      .from(chat)
      .where(and(eq(chat.projectId, c.var.project.id), eq(chat.userId, c.var.actor!.userId)))
      .orderBy(desc(chat.updatedAt))
      .limit(c.req.valid("query").limit);
    return c.json({ items: rows.map(chatJson) }, 200);
  });

  app.openapi(createChat, async (c) => {
    const body = c.req.valid("json");
    const [row] = await c.var.deps.db
      .insert(chat)
      .values({
        id: newUuid(),
        projectId: c.var.project.id,
        userId: c.var.actor!.userId,
        title: NEW_CHAT_TITLE,
        model: body.model,
        approvalMode: body.approvalMode,
        webSearch: body.webSearch,
      })
      .returning();
    return c.json(chatJson(row!), 201);
  });

  /** The caller's own chat; other members' chats are reported as not found. */
  async function ownChat(c: { var: AppEnv["Variables"] }, chatPublicId: string) {
    const row = await chatOwnedBy(c.var.deps.db, uuidOf("chat", chatPublicId), c.var.project.id, c.var.actor!.userId);
    if (!row) throw notFound("Chat");
    return row;
  }

  app.openapi(getChat, async (c) => {
    const row = await ownChat(c, c.req.valid("param").chatId);
    const messages = await loadMessages(c.var.deps.db, row.id);
    return c.json({ ...chatJson(row), messages: messages as z.infer<typeof UIMessageSchema>[] }, 200);
  });

  app.openapi(updateChat, async (c) => {
    const row = await ownChat(c, c.req.valid("param").chatId);
    const body = c.req.valid("json");
    const [updated] = await c.var.deps.db
      .update(chat)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(chat.id, row.id))
      .returning();
    return c.json(chatJson(updated!), 200);
  });

  app.openapi(deleteChat, async (c) => {
    const row = await ownChat(c, c.req.valid("param").chatId);
    const { db, services } = c.var.deps;
    const attachments = await db
      .select({ blobKey: chatAttachment.blobKey })
      .from(chatAttachment)
      .where(eq(chatAttachment.chatId, row.id));
    await db.delete(chat).where(eq(chat.id, row.id));
    await Promise.all(attachments.map((a) => services.blobs.delete(a.blobKey)));
    return c.body(null, 204);
  });

  app.openapi(sendMessage, async (c) => {
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const row = await ownChat(c, params.chatId);
    const { db, env, services } = c.var.deps;
    const model = parseModelRef(row.model);
    if (!model) throw badRequest("This chat has no valid model; pick one");
    const apiKey = await loadApiKey(db, env.BETTER_AUTH_SECRET, c.var.actor!.userId, model.provider);
    if (!apiKey) throw badRequest(`Add your ${providerName(model.provider)} API key in Account → AI`);
    const response = await runTurn({
      app,
      db,
      blobs: services.blobs,
      catalog: catalog(),
      actor: c.var.actor!,
      role: c.var.project.role,
      projectId: c.var.project.id,
      projectPublicId: params.projectId,
      chat: row,
      model,
      languageModel: services.ai.languageModel(model, apiKey),
      apiKey,
      message: body.message as UIMessage,
      ...(body.navigation ? { navigation: body.navigation } : {}),
      ...(body.page ? { page: body.page } : {}),
      signal: c.req.raw.signal,
    });
    return response as never;
  });

  app.openapi(uploadAttachment, async (c) => {
    const params = c.req.valid("param");
    const row = await ownChat(c, params.chatId);
    const [file] = asFiles(c.req.valid("form").file);
    if (file!.size > MAX_UPLOAD_BYTES) throw badRequest("File too large");
    const filename = safeFilename(file!.name);
    const mime = attachmentMime(filename, file!.type);
    if (!mime) throw badRequest("Attach images, PDFs or text files");
    const bytes = new Uint8Array(await file!.arrayBuffer());
    const id = newUuid();
    const blobKey = blobKeys.chatAttachment(c.var.project.id, row.id, id);
    await c.var.deps.services.blobs.put(blobKey, bytes, mime);
    await c.var.deps.db
      .insert(chatAttachment)
      .values({ id, chatId: row.id, blobKey, filename, mime, size: bytes.byteLength });
    const attachmentId = pid("chatAttachment", id);
    return c.json(
      {
        id: attachmentId,
        url: attachmentUrl(params.projectId, params.chatId, attachmentId),
        filename,
        mediaType: mime,
        size: bytes.byteLength,
      },
      201,
    );
  });

  app.openapi(downloadAttachment, async (c) => {
    const params = c.req.valid("param");
    const row = await ownChat(c, params.chatId);
    const [attachment] = await c.var.deps.db
      .select()
      .from(chatAttachment)
      .where(
        and(eq(chatAttachment.chatId, row.id), eq(chatAttachment.id, uuidOf("chatAttachment", params.attachmentId))),
      );
    if (!attachment) throw notFound("Attachment");
    const bytes = await c.var.deps.services.blobs.get(attachment.blobKey);
    if (!bytes) throw notFound("Attachment");
    return new Response(bytes, {
      headers: {
        "content-type": attachment.mime,
        "content-disposition": `inline; filename="${attachment.filename}"`,
        "cache-control": "private, max-age=3600",
      },
    }) as never;
  });
}

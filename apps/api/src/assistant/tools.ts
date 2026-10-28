// Assistant tools (ADR 0031): the MCP catalog executed in-process as the user, the approval policy per chat, and the
// browser-executed navigation tool whose schema the SPA derives from its router.
import { type ChatApprovalMode, type ProjectRole, roleHas } from "@crm/shared";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { jsonSchema, type ToolApprovalStatus, type ToolSet, tool } from "ai";
import type { Actor, AppEnv } from "../http/types.js";
import type { ToolDefinition } from "../mcp/catalog.js";
import { invokeTool } from "../mcp/server.js";

export const NAVIGATE_TOOL = "navigate";

type ToolKind = "read" | "write" | "delete";

export function toolKind(tool: ToolDefinition): ToolKind {
  return tool.destructive ? "delete" : tool.readOnly ? "read" : "write";
}

const AUTO_APPROVED: Record<ChatApprovalMode, readonly ToolKind[]> = {
  manual: [],
  read: ["read"],
  write: ["read", "write"],
  all: ["read", "write", "delete"],
};

/** The catalog tools the caller's role allows, each running the matching API operation as the caller. */
export function crmTools(
  app: OpenAPIHono<AppEnv>,
  catalog: ToolDefinition[],
  caller: { actor: Actor; role: ProjectRole; projectPublicId: string },
): ToolSet {
  const tools: ToolSet = {};
  for (const definition of catalog) {
    if (!roleHas(caller.role, ...definition.permissions)) continue;
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema as never),
      execute: async (args) => {
        const result = await invokeTool(app, definition, caller.actor, caller.projectPublicId, args ?? {});
        if (!result.ok) {
          const detail = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
          throw new Error(`${result.status}: ${detail}`);
        }
        return result.status === 204 ? "Done." : result.body;
      },
    });
  }
  return tools;
}

/** Catalog tools run automatically or wait for the user depending on the chat's mode; other tools never wait. */
export function approvalPolicy(mode: ChatApprovalMode, catalog: ToolDefinition[]) {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  return ({ toolCall }: { toolCall: { toolName: string } }): ToolApprovalStatus => {
    const definition = byName.get(toolCall.toolName);
    if (!definition) return undefined;
    return AUTO_APPROVED[mode].includes(toolKind(definition)) ? undefined : "user-approval";
  };
}

export type NavigationDefinition = { description: string; inputSchema: Record<string, unknown> };

/** No `execute`: the call is streamed to the SPA, which navigates and sends the result back. */
export function navigationTool(definition: NavigationDefinition): ToolSet {
  return {
    [NAVIGATE_TOOL]: tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema as never),
    }),
  };
}

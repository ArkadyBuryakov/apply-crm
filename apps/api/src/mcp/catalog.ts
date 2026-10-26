// Builds MCP tool definitions from the OpenAPI document (ADR 0010): only operations marked `x-mcp.expose` become
// tools; each tool remembers which permissions it needs so the server can filter by the caller's role.
import type { Permission } from "@crm/shared";

type JsonSchema = Record<string, unknown>;

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

type OpenApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
  "x-permissions"?: Permission[];
  "x-mcp"?: { expose?: boolean; name?: string; description?: string };
};

export type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  /** Where the request body comes from: the whole `body` argument, the remaining top-level arguments, or none. */
  body: "argument" | "flattened" | "none";
  permissions: Permission[];
  readOnly: boolean;
  destructive: boolean;
};

/** Inlines `#/components/schemas/*` references so every tool schema is self-contained. */
export function dereference(schema: unknown, components: Record<string, JsonSchema>, seen: string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((s) => dereference(s, components, seen));
  if (!schema || typeof schema !== "object") return schema;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const name = obj.$ref.replace("#/components/schemas/", "");
    if (seen.includes(name)) return {};
    const target = components[name];
    if (!target) throw new Error(`Unresolvable $ref ${obj.$ref}`);
    const { $ref: _ref, ...rest } = obj;
    return { ...(dereference(target, components, [...seen, name]) as JsonSchema), ...rest };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // OpenAPI's discriminator mapping points at $refs that no longer exist once inlined.
    if (key === "discriminator") continue;
    out[key] = dereference(value, components, seen);
  }
  return out;
}

function isPlainObjectSchema(schema: JsonSchema): schema is JsonSchema & { properties: Record<string, JsonSchema> } {
  return schema.type === "object" && typeof schema.properties === "object" && !schema.oneOf && !schema.anyOf;
}

export function buildToolCatalog(doc: OpenApiDocument): ToolDefinition[] {
  const components = doc.components?.schemas ?? {};
  const tools: ToolDefinition[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const mcp = op["x-mcp"];
      if (!mcp?.expose) continue;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      for (const param of op.parameters ?? []) {
        // The project is bound by the MCP endpoint URL, never passed by the model.
        if (param.in === "path" && param.name === "projectId") continue;
        if (param.in !== "path" && param.in !== "query") continue;
        properties[param.name] = {
          ...(dereference(param.schema ?? {}, components) as JsonSchema),
          ...(param.description ? { description: param.description } : {}),
        };
        if (param.required || param.in === "path") required.push(param.name);
        (param.in === "path" ? pathParams : queryParams).push(param.name);
      }

      let body: ToolDefinition["body"] = "none";
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        const resolved = dereference(bodySchema, components) as JsonSchema;
        const collides = isPlainObjectSchema(resolved) && Object.keys(resolved.properties).some((k) => k in properties);
        if (isPlainObjectSchema(resolved) && !collides) {
          body = "flattened";
          Object.assign(properties, resolved.properties);
          for (const r of (resolved.required as string[] | undefined) ?? []) required.push(r);
        } else {
          body = "argument";
          properties.body = resolved;
          if (op.requestBody?.required) required.push("body");
        }
      }

      const text = mcp.description ?? [op.summary, op.description].filter(Boolean).join("\n\n");
      tools.push({
        name: mcp.name ?? op.operationId,
        description: text,
        inputSchema: {
          type: "object",
          properties,
          ...(required.length ? { required: [...new Set(required)] } : {}),
          additionalProperties: false,
        },
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        body,
        permissions: op["x-permissions"] ?? [],
        readOnly: method === "get",
        destructive: method === "delete",
      });
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** Turns tool arguments back into the HTTP request the operation expects. */
export function toHttpRequest(tool: ToolDefinition, projectPublicId: string, args: Record<string, unknown>) {
  let path = tool.path.replace("{projectId}", encodeURIComponent(projectPublicId));
  for (const name of tool.pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === "") throw new Error(`Missing required argument ${name}`);
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const query = new URLSearchParams();
  for (const name of tool.queryParams) {
    const value = args[name];
    if (value !== undefined && value !== null) query.set(name, String(value));
  }
  let body: unknown;
  if (tool.body === "argument") body = args.body;
  if (tool.body === "flattened") {
    body = Object.fromEntries(
      Object.entries(args).filter(([k]) => !tool.pathParams.includes(k) && !tool.queryParams.includes(k)),
    );
  }
  const qs = query.toString();
  return { method: tool.method, url: qs ? `${path}?${qs}` : path, body };
}

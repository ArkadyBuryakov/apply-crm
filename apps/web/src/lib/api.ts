// Typed client for the REST API, generated from the same OpenAPI document MCP uses (ADR 0019).

import createClient from "openapi-fetch";
import type { components, paths } from "@/api/schema";

export const api = createClient<paths>({ baseUrl: "", credentials: "include" });

export type Schemas = components["schemas"];
export type Project = Schemas["Project"];
export type Position = Schemas["Position"];
export type Organization = Schemas["Organization"];
export type Contact = Schemas["Contact"];
export type Action = Schemas["Action"];
export type Edge = Schemas["Edge"];
export type Stage = Schemas["Stage"];
export type Channel = Schemas["Channel"];
export type Member = Schemas["Member"];
export type Suggestion = Schemas["Suggestion"];
export type DocumentT = Schemas["Document"];
export type CommentT = Schemas["Comment"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Returns the data of an openapi-fetch call or throws an ApiError carrying the server's error body. */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok) return data as T;
  const body = (error ?? {}) as { error?: { code?: string; message?: string; details?: unknown } };
  throw new ApiError(
    response.status,
    body.error?.code ?? "error",
    body.error?.message ?? response.statusText ?? "Request failed",
    body.error?.details,
  );
}

/** Uploads multipart form data (openapi-fetch's typing for multipart bodies is awkward). */
export async function uploadForm<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body: form, credentials: "include" });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, json?.error?.code ?? "error", json?.error?.message ?? "Upload failed");
  }
  return json as T;
}

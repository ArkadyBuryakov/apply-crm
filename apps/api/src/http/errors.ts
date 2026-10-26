import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ERROR_CODES = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "validation_failed",
  428: "precondition_required",
} as const;

export type ErrorStatus = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  constructor(
    readonly status: ErrorStatus,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const forbidden = (message = "You do not have permission to do this") => new ApiError(403, message);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, details);
export const conflict = (message: string, details?: unknown) => new ApiError(409, message, details);

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export function errorBody(status: ContentfulStatusCode, message: string, details?: unknown) {
  const code = ERROR_CODES[status as ErrorStatus] ?? "internal_error";
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: "Malformed request",
  401: "Not signed in",
  403: "Missing permission",
  404: "Not found, or not visible to the caller",
  409: "Conflicts with existing data",
  412: "The entity was changed by someone else; the response carries the current state",
  422: "Validation failed",
  428: "An If-Match header or a version field is required",
};

/** OpenAPI response entries for the given error statuses. */
export function errorResponses<const S extends ErrorStatus>(...statuses: S[]) {
  const all = [...new Set([401, 422, ...statuses] as ErrorStatus[])];
  return Object.fromEntries(
    all.map((s) => [s, { description: DESCRIPTIONS[s], content: { "application/json": { schema: ErrorSchema } } }]),
  ) as Record<S | 401 | 422, { description: string; content: { "application/json": { schema: typeof ErrorSchema } } }>;
}

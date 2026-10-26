import type { Scope } from "../services/core.js";
import type { AppEnv } from "./types.js";

/** The project scope of a request that passed the project middleware and the route guard. */
export function scopeOf(c: { var: AppEnv["Variables"] }): Scope {
  return { db: c.var.deps.db, actor: c.var.actor!, projectId: c.var.project.id };
}

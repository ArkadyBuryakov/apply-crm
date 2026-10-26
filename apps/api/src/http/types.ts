import type { Db } from "@crm/db";
import type { AuditVia, ProjectRole } from "@crm/shared";
import type { Auth } from "../auth.js";
import type { Env } from "../env.js";
import type { Services } from "../services/index.js";

export type Actor = {
  userId: string;
  email: string;
  name: string;
  isInstanceAdmin: boolean;
  timezone: string;
  via: AuditVia;
};

export type ProjectContext = {
  /** Project UUID (BetterAuth organization id). */
  id: string;
  role: ProjectRole;
};

export type Deps = {
  db: Db;
  auth: Auth;
  env: Env;
  services: Services;
};

/** Passed as Hono `env` by the MCP server when it calls the API in-process on behalf of a verified user. */
export type InternalBindings = { internalActor?: Actor };

export type AppEnv = {
  Bindings: InternalBindings;
  Variables: {
    deps: Deps;
    actor: Actor | null;
    project: ProjectContext;
  };
};

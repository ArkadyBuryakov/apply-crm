import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../http/types.js";
import { registerActionRoutes } from "./actions.js";
import { registerCollaborationRoutes } from "./collaboration.js";
import { registerCompositeRoutes } from "./composite.js";
import { registerContactRoutes } from "./contacts.js";
import { registerDataRoutes } from "./data.js";
import { registerDocumentRoutes } from "./documents.js";
import { registerGraphRoutes } from "./graph.js";
import { registerLookupRoutes } from "./lookups.js";
import { registerOrganizationRoutes } from "./organizations.js";
import { registerPositionRoutes } from "./positions.js";
import { registerProjectRoutes } from "./projects.js";

export function registerApiRoutes(app: OpenAPIHono<AppEnv>) {
  registerProjectRoutes(app);
  registerLookupRoutes(app);
  registerOrganizationRoutes(app);
  registerContactRoutes(app);
  registerPositionRoutes(app);
  registerActionRoutes(app);
  registerGraphRoutes(app);
  registerCollaborationRoutes(app);
  registerCompositeRoutes(app);
  registerDocumentRoutes(app);
  registerDataRoutes(app);
}

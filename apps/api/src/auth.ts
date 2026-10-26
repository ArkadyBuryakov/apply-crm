// BetterAuth configuration (ADR 0007, 0010, 0021).
import { apiKey } from "@better-auth/api-key";
import { mcp } from "@better-auth/mcp";
import { type Db, instanceInvitation, projectInvitation, user } from "@crm/db";
import { ac, newUuid, roles } from "@crm/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { jwt, organization } from "better-auth/plugins";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Env } from "./env.js";

export const API_KEY_PREFIX = "crm_";

export function mcpBaseResource(env: Pick<Env, "PUBLIC_URL">): string {
  return new URL("/mcp", env.PUBLIC_URL).toString();
}

/** `offline` silences BetterAuth for tooling that builds the app without a database (e.g. OpenAPI generation). */
export function createAuth(db: Db, env: Env, options: { offline?: boolean } = {}) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }

  return betterAuth({
    appName: "Apply CRM",
    ...(options.offline ? { logger: { disabled: true } } : {}),
    baseURL: env.PUBLIC_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", usePlural: false }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders,
    trustedOrigins: [env.PUBLIC_URL],
    advanced: {
      database: { generateId: () => newUuid() },
    },
    user: {
      additionalFields: {
        isInstanceAdmin: { type: "boolean", defaultValue: false, input: false },
        timezone: { type: "string", defaultValue: "UTC", input: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (candidate) => {
            const email = candidate.email.toLowerCase();
            const [{ value: users } = { value: 0 }] = await db.select({ value: count() }).from(user);
            if (users === 0) {
              if (env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() !== email) {
                throw new APIError("FORBIDDEN", { message: "This instance is reserved for its bootstrap admin" });
              }
              return { data: { ...candidate, isInstanceAdmin: true } };
            }
            if (!(await isInvited(db, email))) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is invite-only on this instance" });
            }
            return { data: { ...candidate, isInstanceAdmin: false } };
          },
          after: async (created) => {
            await db
              .update(instanceInvitation)
              .set({ usedAt: new Date() })
              .where(and(eq(instanceInvitation.email, created.email.toLowerCase()), isNull(instanceInvitation.usedAt)));
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        teams: { enabled: false },
        invitationExpiresIn: 60 * 60 * 24 * 14,
        schema: {
          organization: { modelName: "project" },
          member: { modelName: "projectMember" },
          invitation: { modelName: "projectInvitation" },
        },
      }),
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        enableSessionForAPIKeys: true,
        apiKeyHeaders: ["x-api-key"],
        rateLimit: { enabled: false },
      }),
      jwt(),
      mcp({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        resource: mcpBaseResource(env),
        // Each project registers its own resource (<PUBLIC_URL>/mcp/projects/<id>); access to a project is
        // decided by membership at request time, so clients are not linked to individual resources.
        enforcePerClientResources: false,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
  });
}

async function isInvited(db: Db, email: string): Promise<boolean> {
  const [instance] = await db
    .select({ id: instanceInvitation.id })
    .from(instanceInvitation)
    .where(and(eq(instanceInvitation.email, email), isNull(instanceInvitation.usedAt)))
    .limit(1);
  if (instance) return true;
  const [projectInvite] = await db
    .select({ id: projectInvitation.id })
    .from(projectInvitation)
    .where(
      and(
        eq(projectInvitation.email, email),
        eq(projectInvitation.status, "pending"),
        gt(projectInvitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(projectInvite);
}

export type Auth = ReturnType<typeof createAuth>;

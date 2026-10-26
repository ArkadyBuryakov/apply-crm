// Single source of project permissions (ADR 0008, amended by ADR 0015).
// Used by API route guards, the OpenAPI `x-permissions` extension, MCP tool filtering and frontend gating.
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

const crud = ["read", "create", "update", "delete"] as const;

export const statements = {
  // BetterAuth organization plugin statements, so its own endpoints honour our roles.
  ...defaultStatements,
  project: ["read", "update", "transfer"],
  membership: ["read", "manage"],
  channel: crud,
  stage: crud,
  organization_entity: crud,
  position: crud,
  contact: [...crud, "purge"],
  action: crud,
  edge: ["read", "create", "delete"],
  comment: ["read", "create", "moderate"],
  document: crud,
  template: crud,
  audit: ["read"],
  data: ["export", "import"],
} as const;

export const ac = createAccessControl(statements);

type Statements = typeof statements;
type Grants = { [K in keyof Statements]?: Statements[K][number][] };

const readAll = {
  project: ["read"],
  membership: ["read"],
  channel: ["read"],
  stage: ["read"],
  organization_entity: ["read"],
  position: ["read"],
  contact: ["read"],
  action: ["read"],
  edge: ["read"],
  comment: ["read"],
  document: ["read"],
  template: ["read"],
  audit: ["read"],
  ac: ["read"],
} satisfies Grants;

const writeAll = {
  ...readAll,
  channel: [...crud],
  stage: [...crud],
  organization_entity: [...crud],
  position: [...crud],
  contact: [...crud],
  action: [...crud],
  edge: ["read", "create", "delete"],
  comment: ["read", "create"],
  document: [...crud],
  template: [...crud],
  data: ["export", "import"],
} satisfies Grants;

const ownerGrants = {
  ...writeAll,
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  project: ["read", "update", "transfer"],
  membership: ["read", "manage"],
  contact: [...crud, "purge"],
  comment: ["read", "create", "moderate"],
} satisfies Grants;

const commenterGrants = { ...readAll, comment: ["read", "create"] } satisfies Grants;

export const ROLE_GRANTS = {
  owner: ownerGrants,
  editor: writeAll,
  commenter: commenterGrants,
  viewer: readAll,
} as const satisfies Record<string, Grants>;

export const PROJECT_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const roles = {
  owner: ac.newRole(ownerGrants),
  editor: ac.newRole(writeAll),
  commenter: ac.newRole(commenterGrants),
  viewer: ac.newRole(readAll),
};

/** A permission as written on routes: `resource:action`. */
export type Permission = {
  [K in keyof Statements]: `${K & string}:${Statements[K][number]}`;
}[keyof Statements];

export function permissionsOf(role: ProjectRole): Permission[] {
  const grants = ROLE_GRANTS[role] as Grants;
  return Object.entries(grants).flatMap(([resource, actions]) =>
    (actions ?? []).map((a) => `${resource}:${a}` as Permission),
  );
}

export function roleHas(role: ProjectRole, ...required: Permission[]): boolean {
  const granted = new Set(permissionsOf(role));
  return required.every((p) => granted.has(p));
}

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema.js";
import * as domainSchema from "./schema.js";

export const schema = { ...authSchema, ...domainSchema };

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction or the root database handle. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

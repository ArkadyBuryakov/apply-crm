import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client.js";

// Bundled builds set MIGRATIONS_DIR, since import.meta.url then points at the bundle instead of this package.
export const MIGRATIONS_FOLDER = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../drizzle", import.meta.url));

// Arbitrary constant; serializes migrations when several replicas start at once.
const MIGRATION_LOCK = 4_242_001;

export async function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER) {
  await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK})`);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK})`);
  }
}

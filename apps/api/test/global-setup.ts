// Starts one Postgres container for the whole run and migrates a template database; each test file clones it.
import { createDb, runMigrations } from "@crm/db";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  let baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    baseUrl = container.getConnectionUri();
  }
  const admin = createDb(baseUrl, { max: 1 });
  await admin.client.unsafe("drop database if exists crm_template");
  await admin.client.unsafe("create database crm_template");
  await admin.client.end();

  const templateUrl = withDatabase(baseUrl, "crm_template");
  const template = createDb(templateUrl, { max: 1 });
  await runMigrations(template.db);
  await template.client.end();

  project.provide("databaseUrl", baseUrl);
}

export async function teardown() {
  await container?.stop();
}

export function withDatabase(url: string, database: string) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

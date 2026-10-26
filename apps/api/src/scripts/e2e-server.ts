// Boots the real server on a freshly created database for Playwright (apps/web/e2e). Never point it at real data:
// it drops and recreates the database named in E2E_DATABASE.
import { createDb } from "@crm/db";

const base = process.env.E2E_DATABASE_URL ?? "postgres://crm:crm@localhost:5433/crm";
const name = process.env.E2E_DATABASE ?? "crm_e2e";
if (!/^[a-z_][a-z0-9_]*$/.test(name) || !name.includes("e2e")) throw new Error(`Refusing to recreate database ${name}`);

const admin = createDb(base, { max: 1 });
await admin.client.unsafe(`drop database if exists ${name} with (force)`);
await admin.client.unsafe(`create database ${name}`);
await admin.client.end();

const url = new URL(base);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();
await import("../main.js");

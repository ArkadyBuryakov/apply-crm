# Apply CRM

A self-hosted CRM for running a job search: companies and recruiting agencies, the positions you pursue, the people
involved, and a graph of everything that happened (emails, calls, interviews, applications, take-homes, offers, …).
Share a project with a coach, a recruiter or a partner; let an AI assistant work with it through MCP.

- **Web app**: pipeline board, position timelines, action graph, agenda, contacts, LaTeX resumes compiled to PDF.
- **REST API**: every operation is described in a generated OpenAPI document (`/api/openapi.json`).
- **MCP server**: one URL per project (`/mcp/projects/<id>`), OAuth sign-in or API key, tools generated from the
  OpenAPI document and filtered by your role.

Design decisions are recorded in [`docs/adr/`](docs/adr/README.md); [`docs/architecture.md`](docs/architecture.md) is
the overview.

## Development

Requirements: Node 24+, pnpm 12, Docker.

```sh
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -hex 32)
pnpm db:up                      # Postgres on :5433 and RustFS (S3) on :9000
pnpm --filter @crm/api dev      # API on :3000, applies migrations on start
pnpm --filter @crm/api worker:dev   # optional: compiles LaTeX documents (needs `tectonic` on PATH)
pnpm --filter @crm/web dev      # SPA on :5173, proxies /api and /mcp to :3000
```

Open http://localhost:5173. The first account you create becomes the instance admin; after that, sign-up is
invite-only.

| Command | What it does |
|---|---|
| `pnpm test` | Unit and integration tests (starts a Postgres container) |
| `pnpm test:e2e` | Builds the SPA and runs the Playwright smoke test against a fresh database |
| `pnpm typecheck` / `pnpm lint` | TypeScript and Biome |
| `pnpm check-licenses` | Verifies production dependencies are AGPL-compatible |
| `pnpm --filter @crm/api openapi` | Regenerates `apps/api/openapi.json` (committed; CI checks it is current) |
| `pnpm --filter @crm/db db:generate` | Generates a migration after changing `packages/db/src/schema.ts` |

### Layout

```
apps/api        Hono API, BetterAuth, MCP endpoint, worker entrypoint
apps/web        React SPA (TanStack Router/Query, Tailwind, React Flow)
packages/shared Enums, action payload schemas, permissions, public ID codec
packages/db     Drizzle schema and migrations
scripts         Resume import, license check
config          Defaults seeded into new projects (channels, pipeline stages)
```

### Importing existing LaTeX resumes

If you keep one folder per position with a `.tex` file and a shared class file:

```sh
CRM_API_KEY=crm_… pnpm --filter @crm/scripts import-resumes ~/path/to/resumes --project prj_… --dry-run
```

Drop `--dry-run` to import. See the header of `scripts/src/import-resumes.ts` for details.

## Connecting an AI assistant

Project **Settings → Connect an AI assistant** shows the project's MCP URL. Add it as a remote MCP server in your client;
it will open a sign-in and consent page. Scripts can use a personal API key (**Account → API keys**) as a bearer token.

## Deployment

See [`docs/deploy.md`](docs/deploy.md) (Coolify, object storage, backups).

## License

[AGPL-3.0-only](LICENSE).

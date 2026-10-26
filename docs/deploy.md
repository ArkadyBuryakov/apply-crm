# Deploying

The target is a single VPS running [Coolify](https://coolify.io), with Postgres managed by Coolify and documents in
Hetzner Object Storage (ADR 0027). The same image runs as two services: `api` and `worker`.

## 1. Object storage

Create two buckets, ideally in different Hetzner projects (or with different providers):

| Bucket | Used by | Credentials |
|---|---|---|
| documents (e.g. `crm-documents`) | the app | read/write key for the app |
| backups (e.g. `crm-backups`) | Coolify backups and the mirror job | a key the app does **not** have |

Enable versioning on the documents bucket if the location supports it. Production does not create buckets on start.

## 2. Postgres

Create a PostgreSQL 17 database in Coolify. Under **Backups**, schedule daily backups to an S3 destination pointing at the
backups bucket.

## 3. Application

Create a **Docker Compose** or **Dockerfile** resource from this repository:

- `api`: build target `api`, port 3000, health check `/api/config`, attach your domain (Coolify's proxy terminates TLS).
- `worker`: build target `worker`, no port. Give it a CPU and memory limit (e.g. 1 CPU, 1 GB): LaTeX compilation runs
  here.

Environment for both (see `.env.example`):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Coolify's internal Postgres URL |
| `PUBLIC_URL` | `https://crm.example.com`, must be the public HTTPS origin; OAuth and MCP URLs derive from it |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32`; same value for api and worker |
| `BOOTSTRAP_ADMIN_EMAIL` | your email, so nobody else can claim the fresh instance |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Hetzner endpoint, e.g. `https://fsn1.your-objectstorage.com`, region `fsn1` |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | optional social login; callback `https://<domain>/api/auth/callback/<provider>` |
| `TECTONIC_ONLY_CACHED` | worker only; `true` forbids downloading TeX packages at compile time (only those cached in the image work) |

The API applies database migrations on start (serialized with an advisory lock, so several replicas are safe). To run
them as a separate step instead, set `MIGRATE_ON_START=false` on `api` and run `node dist/migrate.js` (same image) as a
pre-deploy command.

After the first deploy, open the site and **sign up immediately**: the first account becomes the instance admin.

## 4. Document mirror

If the documents bucket has no versioning, add a Coolify scheduled task (daily) that mirrors it into the backups bucket:

```sh
rclone sync hetzner-docs:crm-documents hetzner-backups:crm-backups/documents --fast-list
```

with an rclone config for both remotes stored as a Coolify secret.

## 5. Restore drill

Do this once after setting up, and after any change to the backup configuration:

1. Create a scratch Postgres in Coolify and restore the latest backup into it (`pg_restore -d <scratch-url> <dump>`).
2. Start a temporary `api` container with `DATABASE_URL` pointing at the scratch database and `S3_BUCKET` at a copy of
   the mirrored documents.
3. Sign in, open a position with documents, and download a PDF.
4. Delete the scratch resources.

JSON export (**Settings → Export**) is a portable copy of one project, not a backup of the instance.

## Without Coolify

`docker-compose.yml` runs Postgres, `api` and `worker`. Fill in `.env` (including `POSTGRES_PASSWORD`) and run
`docker compose up -d --build`, then put a TLS-terminating reverse proxy in front of port 3000.

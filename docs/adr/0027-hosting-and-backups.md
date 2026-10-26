# 0027. Hosting on Coolify and backups

- Status: Accepted (refines 0011)
- Date: 2026-10-26
- Source: round-3 Q8, Q9, round-4 Q2

## Decision

### Hosting
- A VPS running **Coolify**. Postgres is a Coolify-managed database.
- Two app services from one image: `api` (HTTP: REST, MCP, SPA) and `worker` (ADR 0024). Coolify's proxy terminates TLS.
- Configuration comes from env vars only. `.env.example` lists them all with placeholder values.
- A generic `docker-compose.yml` is kept for people who don't use Coolify.

### Object storage
Documents live in **Hetzner Object Storage** (S3-compatible), accessed through the `BlobStore` S3 implementation. Endpoint, region, bucket
and credentials come from env vars. Local development uses MinIO in `docker-compose`.

### Backups
- **Postgres**: Coolify's scheduled database backups, uploaded to a **private S3-compatible backup bucket**.
- **Documents**: enable bucket versioning on the documents bucket if Hetzner supports it for the chosen location, so that
  deletions and overwrites can be recovered. Otherwise, or in addition, mirror it into the backup bucket with a scheduled `rclone sync`.
- The backup bucket is separate from the documents bucket and uses credentials that the app does not have, so a compromised app can't
  delete its own backups. Ideally it lives in a different Hetzner project, or with a different provider, so one account problem can't take out both.
- The deploy docs include a restore procedure, and it should be rehearsed once.

## Consequences
- The app has no backup code. Backups are an operations concern configured in Coolify.
- JSON export (ADR 0017) stays a portability feature, not a backup.

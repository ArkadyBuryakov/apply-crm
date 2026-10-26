# Requirements grilling — round 4

Short round. Also review `docs/domain/action-types.md` in place (it has its own `> Q:` lines).

---

### 1. v1 scope, asked properly this time
In round 2, Q20 had no default, so "agree" was ambiguous and I misread it as cutting MCP. Each of these needs its own answer:

| Item | In v1? |
|---|---|
| Project members, invitations, commenter role, comments | |
| Documents + LaTeX templates + compile worker + resume import | |
| Audit log UI (history panel per entity) | |

**Default:** members **yes** (sharing with a coach was part of the original requirement), documents **yes** (the worker and
pg-boss were just decided for them), audit UI **no** (the data is recorded either way, and the UI can come later).

**Answer:** agree

### 2. Where do documents live?
- (a) MinIO as a Coolify service on the same VPS: free, but if the disk is lost, the documents are lost too unless the backup mirror runs
- (b) an external S3-compatible provider (Cloudflare R2, Backblaze B2, Hetzner Object Storage): cheap at this size, durable,
  and versioning can replace the mirror job

Backups go to a separate bucket either way (ADR 0027).

**Default:** (b) for documents, with Postgres backups in a separate bucket, ideally under a different provider or account.

**Answer:** Hetzner object storage

### 3. License
Copyleft and "no commercial use" are different things:
- **Copyleft** (GPL, AGPL) lets anyone use the code commercially, but derivatives must stay open under the same license.
  **AGPL-3.0** extends that to hosted services, so a company can't run a modified closed version as SaaS. In practice
  this deters most commercial reuse, and it is a real open-source license.
- **No commercial use** is not open source by definition. Options include **PolyForm Noncommercial 1.0.0** (designed for software,
  but not copyleft) and **CC BY-NC-SA 4.0** (copyleft and non-commercial, but Creative Commons advises against using it for software).

Options:
- (a) AGPL-3.0: open source, copyleft, commercial use allowed only if they open their changes
- (b) PolyForm Noncommercial 1.0.0: commercial use prohibited, not copyleft
- (c) PolyForm Noncommercial now, with the option of dual licensing (e.g. AGPL + a paid commercial license) later

**Default:** (a). If forbidding commercial use is a hard requirement, pick (b) or (c). No copyleft license can do that.

**Answer:** agree

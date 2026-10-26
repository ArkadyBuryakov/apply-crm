# 0028. Repository hygiene and license

- Status: Accepted
- Date: 2026-10-26
- Source: round-3 Q10, round-4 Q3

## Decision

### Nothing personal or private is committed
- No real resumes, company or contact names, emails, paths from the author's machine, or credentials.
- Seeds and test fixtures are **synthetic** (generated with fake data).
- Tools that work with personal data (e.g. the resume import, ADR 0025) take paths and credentials as arguments or env vars.
- `.gitignore` covers `.env*` (except `.env.example`), `data/`, `*.pdf` and `*.tex` outside `fixtures/`.
- **gitleaks** runs as a pre-commit hook and in CI.

### License
**AGPL-3.0-only.** It is copyleft and also covers network use: anyone who runs a modified version as a service must publish
their changes. Commercial use is not forbidden (no OSI license can forbid it), but closed commercial forks are.
- Full text in `LICENSE`, and `"license": "AGPL-3.0-only"` in every `package.json`.
- Dependencies must be AGPL-compatible. A license check (e.g. `license-checker` with an allowlist) runs in CI.

## Consequences
- Example LaTeX templates in the repo must be original or permissively licensed, not the author's own class file
  unless it is cleared for publishing.

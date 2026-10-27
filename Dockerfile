# syntax=docker/dockerfile:1.7
# One image, two targets (ADR 0024, 0027): `api` serves REST, MCP and the SPA; `worker` adds Tectonic for compiling.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @crm/web build \
 && pnpm --filter @crm/api build \
 && pnpm --filter @crm/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/web/dist /out/web \
 && cp -r packages/db/drizzle /out/drizzle

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM ${NODE_IMAGE} AS worker
ARG TECTONIC_VERSION=0.17.0
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && case "${TARGETARCH:-amd64}" in amd64) arch=x86_64 ;; arm64) arch=aarch64 ;; *) echo "unsupported arch" && exit 1 ;; esac \
 && curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${arch}-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin tectonic \
 && tectonic --version
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/drizzle \
    TECTONIC_CACHE_DIR=/var/cache/tectonic \
    COMPILE_TIMEOUT_MS=60000
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY docker/tectonic-warmup.tex /tmp/warmup/warmup.tex
RUN mkdir -p /var/cache/tectonic && chown node:node /var/cache/tectonic /tmp/warmup
USER node
RUN tectonic -X compile --untrusted --outdir /tmp/warmup /tmp/warmup/warmup.tex && rm -rf /tmp/warmup
# The worker writes this file once it is connected to the job queue. Coolify also requires a health check on every
# target once the Dockerfile contains one.
HEALTHCHECK --interval=30s --timeout=5s CMD test -f /tmp/worker-ready
CMD ["node", "--enable-source-maps", "dist/worker.js"]

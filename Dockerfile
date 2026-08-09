# syntax=docker/dockerfile:1

ARG DENO_VERSION=2.9.5
ARG NODE_VERSION=22

# -----------------------------------------------------------------------------
# Base: Deno + Node (npx) + uv (uvx) + git
# -----------------------------------------------------------------------------
FROM denoland/deno:bin-${DENO_VERSION} AS deno-bin

FROM node:${NODE_VERSION}-bookworm-slim AS base

COPY --from=deno-bin /deno /usr/local/bin/deno

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bubblewrap \
    ca-certificates \
    curl \
    git \
    python3 \
    unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -LsSf https://astral.sh/uv/install.sh | sh \
  && ln -sf /root/.local/bin/uv /usr/local/bin/uv \
  && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx

ENV DENO_DIR=/deno-dir \
    NPM_CONFIG_CACHE=/var/cache/npm \
    UV_CACHE_DIR=/var/cache/uv \
    DATA_DIR=/data \
    HOST_BIND=0.0.0.0 \
    HOST_PORT=8080 \
    DATABASE_URL=sqlite:///data/mcp-hoster.db \
    SEED_PATH=/app/seed.example.json \
    LIBRARY_SEED_PATH=/app/seed/library.json \
    MIGRATIONS_DIR=/app/migrations

RUN mkdir -p /data /deno-dir /var/cache/npm /var/cache/uv \
  && groupadd --gid 10001 mcp \
  && useradd --uid 10001 --gid mcp --home-dir /home/mcp --create-home mcp \
  && chown -R mcp:mcp /data /deno-dir

WORKDIR /app

# -----------------------------------------------------------------------------
# Development: full toolchain, workspace mounted by devcontainer/compose
# -----------------------------------------------------------------------------
FROM base AS development

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    procps \
    vim-tiny \
  && rm -rf /var/lib/apt/lists/*

# Keep root for convenience in the devcontainer (volume mounts, docker sock, etc.)
USER root
WORKDIR /workspaces/mcp_hoster

EXPOSE 8080
CMD ["deno", "task", "dev"]

# -----------------------------------------------------------------------------
# Frontend build (Vue + Vite + Naive UI)
# -----------------------------------------------------------------------------
FROM base AS ui-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/deno.lock* frontend/package-lock.json* ./
COPY frontend/ ./
RUN deno install \
  && deno task build

# -----------------------------------------------------------------------------
# Production build: cache deps then copy sources
# -----------------------------------------------------------------------------
FROM base AS deps

WORKDIR /app
COPY deno.json deno.lock* ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY seed.example.json ./
COPY seed ./seed
COPY --from=ui-build /app/frontend/dist ./frontend/dist

RUN deno install \
  && deno cache src/main.ts

# -----------------------------------------------------------------------------
# Production runtime
# -----------------------------------------------------------------------------
FROM base AS production

WORKDIR /app
COPY --from=deps /deno-dir /deno-dir
COPY --from=deps /app /app

RUN chown -R mcp:mcp /app /data /deno-dir

USER mcp
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD deno eval "const r=await fetch('http://127.0.0.1:8080/health'); if(!r.ok) Deno.exit(1)"

CMD ["deno", "run", "--allow-all", "src/main.ts"]

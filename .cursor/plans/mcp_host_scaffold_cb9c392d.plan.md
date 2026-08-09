---
name: MCP Host Scaffold
overview: Build an open-source Deno MCP host that runs many stdio MCP servers as sandboxed processes, persists state in SQLite (portable to Postgres later), aggregates them behind a unified Streamable HTTP gateway, and ships a simple admin UI. Deno for the POC; architecture kept swappable toward a future Go rewrite.
todos:
  - id: scaffold
    content: Scaffold Deno project (deno.json, LICENSE, README, folder layout)
    status: completed
  - id: db-layer
    content: SQLite store + migrations + repository interfaces (servers, settings) designed for later Postgres
    status: completed
  - id: config-lifecycle
    content: Process manager (spawn/stop/restart/logs) driven by DB server records
    status: completed
  - id: gateway
    content: Unified MCP gateway with namespaced tool aggregation and Streamable HTTP /mcp
    status: completed
  - id: admin-api-ui
    content: Admin REST API + simple web UI (list/add/start/stop/logs)
    status: completed
  - id: docker
    content: Dockerfile with Deno/Node/uv, docker-compose, seed example servers
    status: completed
  - id: smoke-test
    content: End-to-end smoke test with 1–2 real MCP servers through the gateway
    status: completed
isProject: false
---

# MCP Hoster — Unified Gateway POC

## Goal

One self-hosted container that:

1. Runs company/community MCP servers as **processes** (npx, uvx, binaries, git clones) — not one Docker container per server
2. Exposes a **single unified MCP endpoint** with namespaced tools (sets up later permission scoping)
3. Provides a **simple admin UI** to manage servers and inspect logs
4. Persists configuration in **SQLite**, with a clean path to **Postgres** later

Differentiation vs Docker MCP Gateway: isolation is process/sandbox level inside one host image, not N sibling containers.

## Language strategy

- **Now (POC):** Deno + TypeScript — fastest path with the official MCP SDK
- **Later (likely):** Go rewrite of the host/supervisor when hard sandboxing and ops maturity matter more
- **Implication for code shape:** Keep a thin boundary between (a) MCP gateway / HTTP / UI and (b) process supervisor + persistence. Prefer small modules and repository interfaces so a Go port can reimplement packages without a big-bang rewrite of concepts.

## Architecture

```mermaid
flowchart LR
  Client[MCP_Client] -->|Streamable_HTTP_/mcp| Gateway[Unified_Gateway]
  AdminUI[Admin_UI] -->|REST_/api| AdminAPI[Admin_API]
  Gateway --> Registry[Server_Registry]
  AdminAPI --> Registry
  Registry --> Repos[Repositories]
  Repos --> DB[(SQLite)]
  Registry --> PM[Process_Manager]
  PM --> S1[Sandbox_npx_server]
  PM --> S2[Sandbox_uvx_server]
  PM --> S3[Sandbox_git_clone]
```

- **Gateway**: MCP server (official TS SDK v2) that is also an MCP client to each backend stdio server
- **Registry**: runtime view of servers + tool catalogs; durable state via repositories
- **DB**: SQLite file under `/data` by default; driver behind a `Database` / repository interface
- **Process manager**: spawn/kill/restart, capture logs, health
- **Admin**: REST + small UI for POC operations

## Stack (decided)

- **Runtime**: Deno + TypeScript (POC); Go deferred
- **MCP**: `@modelcontextprotocol/server` + `@modelcontextprotocol/client` (v2)
- **HTTP**: Hono on `Deno.serve` — public `/mcp`, admin `/api/*` + `/ui`
- **DB**: SQLite (default) via a Deno-friendly driver; SQL + migrations kept portable
- **ORM/query**: thin SQL repositories (or Kysely-style) — **no** SQLite-only APIs in business logic
- **Bootstrap config**: env vars only (`HOST_BIND`, `HOST_PORT`, `DATABASE_URL`) — server definitions live in the DB
- **UI**: server-rendered HTML + small vanilla JS
- **License**: MIT

## Persistence

### Connection

- Default: `DATABASE_URL=sqlite:///data/mcp-hoster.db`
- Future: `DATABASE_URL=postgres://user:pass@host:5432/mcp_hoster`
- Boot selects driver from URL scheme; repositories share the same SQL schema (migrations)

### Core tables (POC)

- `servers` — id, name, transport, command, args (JSON), env (JSON), cwd, source_git, source_ref, enabled, created_at, updated_at
- `server_runtime` — server_id, desired_state, last_status, last_error, pid (ephemeral fields OK to reset on boot), updated_at
- `settings` — key/value for host-level options (future auth, tool policies)
- `schema_migrations` — version tracking

Process logs stay on disk under `/data/logs/{server_id}.log` (not in SQLite) for POC simplicity.

### Portability rules

- Standard SQL types where possible (`TEXT`, `INTEGER`, JSON as `TEXT`)
- Migrations as numbered SQL files applied in order
- All reads/writes go through `src/db/repos/*` — no ad-hoc SQL in gateway/UI
- Postgres support is **interface-ready**, not implemented in the POC (stub driver selection + docs)

### Seed

- On empty DB, optionally load `seed.example.json` (or insert two demo server rows) so first `docker compose up` is usable
- YAML is **not** the system of record (avoids dual-write); import helper can come later

## Server record shape (DB / API)

```json
{
  "id": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/workspaces/fs"],
  "env": {},
  "enabled": true,
  "source": null
}
```

Git-backed example: `source: { "git": "https://github.com/example/mcp-server.git", "ref": "main" }` with `cwd` relative to checkout.

Tool names exposed to clients: `{serverId}__{toolName}`. Same for resources/prompts — hook for later permission scoping.

## POC sandbox model

- Dedicated workdir per server under `/data/servers/{id}`
- Env whitelist from DB record only (plus minimal PATH/HOME)
- Restart on crash with backoff; max restart budget
- stdout/stderr ring buffer + on-disk log files
- Docker image runs as non-root
- **Out of POC**: bubblewrap/seccomp, per-tool ACLs, OAuth

## Gateway behavior

1. On start: load enabled servers from DB, spawn, open MCP clients, discover tools
2. Register aggregated capabilities on the unified server
3. On `tools/call`: strip namespace → route → return result
4. On stop/remove/restart: update registry + persist desired state
5. Streamable HTTP at `/mcp`

Health: `GET /health` — host + DB + per-server process state.

## Admin API + UI

**API** (`/api`):

- `GET/POST /servers`, `PATCH/DELETE /servers/:id`
- `POST /servers/:id/start|stop|restart`
- `GET /servers/:id/logs?tail=200`
- `GET /servers/:id/tools`

**UI** (`/ui`): server table, add form, lifecycle controls, log viewer, gateway URL hint.

## Docker packaging

- Deno + Node (`npx`) + `uv` (`uvx`)
- Volume `./data:/data` (SQLite file, logs, checkouts)
- `DATABASE_URL` / port via compose env
- Document: compose up → `/ui` → point clients at `http://localhost:8080/mcp`

## Repo layout

```
mcp_hoster/
  deno.json
  LICENSE
  README.md
  Dockerfile
  docker-compose.yml
  seed.example.json
  migrations/
    001_init.sql
  src/
    main.ts
    config.ts                 # env bootstrap only
    db/
      client.ts               # open SQLite from DATABASE_URL
      migrate.ts
      repos/
        servers.ts
        settings.ts
    registry.ts
    process_manager.ts
    sandbox.ts
    gateway/
      aggregator.ts
      mcp_server.ts
      backend_client.ts
    admin/
      api.ts
      ui.ts
  data/                       # gitignored
```

## Implementation order

1. Scaffold Deno project + MIT + README (note Deno-now / Go-later)
2. DB layer: migrations, SQLite client, server repository
3. Process manager + log capture driven by DB rows
4. Backend client + aggregator + `/mcp`
5. Admin API + UI
6. Docker / compose / seed
7. E2E smoke with 1–2 real MCP servers

## Explicitly deferred (post-POC)

- Postgres driver implementation (keep URL + repo boundary ready)
- Go rewrite of supervisor
- Authn/authz and per-client tool scopes
- Remote SSE/HTTP upstream backends
- Multi-tenant isolation / hard sandboxing
- Kubernetes operator / HA

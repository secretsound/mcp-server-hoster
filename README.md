# MCP Server Hoster

Self-hosted [Model Context Protocol](https://modelcontextprotocol.io/) server hoster. I was tired of having to spin up multiple containers just to run an NPX, UVX, or other MCP server seperately. That's why this project was created. To simplify the process, this project allows you to run an MCP server as a local process, expose it on one Streamable HTTP endpoint, and manage it from a web UI.

## Quick start

```bash
cp .env.example .env   # set BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
docker compose up -d
```

Pulls `ghcr.io/secretsound/mcp_host_server:latest` by default. Local rebuild: `docker compose up --build`.

- Admin UI: http://localhost:8080/ui
- MCP gateway: http://localhost:8080/mcp

Point your MCP client at `http://localhost:8080/mcp`. Sign in with OAuth, or use an API key (`Authorization: Bearer mch_…`) from the UI.

## Development

The easiest path is the **Dev Container**: open the repo in VS Code or Cursor and choose **Reopen in Container**. That image includes Deno, Node, and uv.

Then:

```bash
deno task ui:install
deno task dev:api    # API on :8080
deno task ui:dev     # Vite on :5173 (proxies /api, /health, /mcp)
```

UI during development: http://localhost:5173/ui/

Without a Dev Container, install [Deno](https://deno.land/), Node.js, and optionally [uv](https://github.com/astral-sh/uv), then:

```bash
export DATA_DIR=./data
export DATABASE_URL=sqlite:///$(pwd)/data/mcp-hoster.db
export BOOTSTRAP_ADMIN_EMAIL=admin@example.com
export BOOTSTRAP_ADMIN_PASSWORD=changeme-at-least-8-chars
export HOST_PUBLIC_URL=http://localhost:8080

deno task ui:install && deno task ui:build
deno task start
```

## Configuration

Most options live in **Settings** after first boot. Bootstrap via env (see [`.env.example`](.env.example)):

| Variable | Description |
|----------|-------------|
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | First admin (required unless auth is opened/disabled) |
| `DATA_DIR` | Data root (default `./data`) |
| `DATABASE_URL` | `sqlite://…` (default) or `postgres://…` |
| `HOST_PUBLIC_URL` | Public origin for OAuth |
| `GATEWAY_PUBLIC_URL` | Public `/mcp` URL for clients |
| `MCP_BACKEND_CONNECT_TIMEOUT_MS` | Max wait for MCP child handshake on start (default `300000` = 5m; first `uvx`/`npx` downloads can be slow) |

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal, educational, research, and other noncommercial use. Commercial use (including selling the software or using it to operate a business) requires a separate license from the copyright holder.

import { Hono } from "hono";
import { ensureDir } from "@std/fs";
import { loadBootstrapConfig } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";
import { seedIfEmpty } from "./db/seed.ts";
import { ServerRepository } from "./db/repos/servers.ts";
import { SettingsRepository } from "./db/repos/settings.ts";
import { AuthRepository } from "./db/repos/auth.ts";
import { AuditRepository } from "./db/repos/audit.ts";
import { LibraryRepository } from "./db/repos/library.ts";
import { AuthService } from "./auth/service.ts";
import { ProcessManager } from "./process_manager.ts";
import { ServerRegistry } from "./registry.ts";
import { createAdminApi } from "./admin/api.ts";
import { mountAdminUi } from "./admin/static.ts";
import { mountMcpOAuthRoutes } from "./auth/mcp_oauth_routes.ts";
import { createMcpFetch } from "./gateway/mcp_server.ts";
import { buildHealthChecks } from "./health.ts";
import {
  parseSandboxMode,
  parseSandboxNetwork,
  SANDBOX_MODE_SETTING_KEY,
  SANDBOX_NETWORK_SETTING_KEY,
  SandboxController,
} from "./sandbox_wrap.ts";
import { seedSettingsFromBootstrap } from "./settings/registry.ts";
import { join } from "@std/path";

const config = await loadBootstrapConfig();
await ensureDir(config.dataDir);
await ensureDir(config.logsDir);
await ensureDir(config.serversDir);
await ensureDir(config.workspacesDir);
await ensureDir(`${config.workspacesDir}/fs`);

if (config.engine === "sqlite" && config.sqlitePath) {
  const restoreStaging = `${config.sqlitePath}.restore`;
  try {
    await Deno.stat(restoreStaging);
    await Deno.copyFile(restoreStaging, config.sqlitePath);
    await Deno.remove(restoreStaging);
    console.error(`[db] applied staged restore → ${config.sqlitePath}`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

const db = await openDatabase(config.databaseUrl, config.sqlitePath);
await migrate(db, config.migrationsDir);

const servers = new ServerRepository(db);
const settings = new SettingsRepository(db);
const authRepo = new AuthRepository(db);
const audit = new AuditRepository(db);
const library = new LibraryRepository(db);

await seedSettingsFromBootstrap(settings, config);

// Overlay hot settings onto live config (DB wins over file when set)
const gwSetting = (await settings.get("host.gateway_public_url"))?.trim();
if (gwSetting) {
  config.gatewayPublicUrl = gwSetting.endsWith("/mcp")
    ? gwSetting
    : `${gwSetting.replace(/\/$/, "")}/mcp`;
}
const publicSetting = (await settings.get("host.public_url"))?.trim();
if (publicSetting) {
  config.publicUrl = publicSetting.replace(/\/$/, "");
}

const auth = new AuthService(authRepo, {
  disabled: config.authDisabled,
  allowOpen: config.authAllowOpen,
  bootstrapEmail: config.bootstrapAdminEmail,
  bootstrapPassword: config.bootstrapAdminPassword,
  bootstrapDisplayName: config.bootstrapAdminDisplayName,
  publicUrl: config.publicUrl ??
    (config.gatewayPublicUrl
      ? config.gatewayPublicUrl.replace(/\/mcp\/?$/, "")
      : null),
}, audit);
try {
  await auth.bootstrap();
} catch (err) {
  console.error(`[auth] ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
}

await servers.resetEphemeralRuntime();
await seedIfEmpty(servers, config.seedPath, library, config.librarySeedPath);

if (!await settings.get(SANDBOX_MODE_SETTING_KEY)) {
  await settings.set(SANDBOX_MODE_SETTING_KEY, "auto");
}
if (!await settings.get(SANDBOX_NETWORK_SETTING_KEY)) {
  await settings.set(SANDBOX_NETWORK_SETTING_KEY, "share");
}

const sandbox = new SandboxController();
const sandboxRuntime = await sandbox.apply(
  parseSandboxMode(await settings.get(SANDBOX_MODE_SETTING_KEY)),
  parseSandboxNetwork(await settings.get(SANDBOX_NETWORK_SETTING_KEY)),
);
console.error(
  `[sandbox] mode=${sandboxRuntime.mode} network=${sandboxRuntime.network} (requested=${sandbox.getRequested()})${
    sandboxRuntime.detail ? ` — ${sandboxRuntime.detail}` : ""
  }`,
);

const pm = new ProcessManager(config, servers, sandbox, (event) => {
  void auth.recordAudit({
    tenantId: "default",
    actorUserId: null,
    actorEmail: null,
    action: event.action,
    resourceType: "server",
    resourceId: event.serverId,
    summary: event.summary,
    metadata: event.metadata,
  });
});
const registry = new ServerRegistry(config, servers, pm);
const mcpFetch = createMcpFetch(pm, (id) => registry.get(id).then((s) => s != null), auth);

const app = new Hono();

function baseUrlForRequest(c: { req: { header: (name: string) => string | undefined } }): string {
  if (config.gatewayPublicUrl) {
    return config.gatewayPublicUrl.replace(/\/mcp\/?$/, "");
  }
  const host = c.req.header("host") ?? `localhost:${config.port}`;
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

app.get("/health", async (c) => {
  const list = await registry.list();
  const base = baseUrlForRequest(c);
  const gateway = `${base}/mcp`;
  const runtime = sandbox.getRuntime();
  const checks = await buildHealthChecks({
    config,
    auth,
    gateway,
    servers: list,
    sandbox: runtime,
    sandboxRequested: sandbox.getRequested(),
  });
  const ok = checks.every((ch) => ch.ok || ch.severity === "info");
  const oauthSettings = await auth.getOAuthSettings();
  return c.json({
    ok,
    bind: config.bind,
    port: config.port,
    gateway,
    publicUrl: oauthSettings.publicUrl ?? config.publicUrl,
    database: config.engine,
    displayName: (await settings.get("host.display_name")) || "MCP Hoster",
    sandbox: runtime.mode,
    sandboxRequested: sandbox.getRequested(),
    checks,
    warnings: checks.filter((ch) => !ch.ok).map((ch) => ch.message),
    servers: list.map((s) => ({
      id: s.id,
      status: s.runtime.lastStatus,
      desired: s.runtime.desiredState,
      tools: s.toolCount,
      pid: s.runtime.pid,
      error: s.runtime.lastError,
      mcp: `${base}/mcp/${encodeURIComponent(s.id)}`,
    })),
  });
});

app.route("/api", createAdminApi(registry, settings, auth, db, audit, library, sandbox));

// MCP OAuth AS (well-known + /oauth/*) — browser login for clients; keys still work.
mountMcpOAuthRoutes(app, auth);

app.get("/", (c) => c.redirect("/ui/"));
mountAdminUi(app, join(Deno.cwd(), "frontend", "dist"));

app.all("/mcp", (c) => mcpFetch(c.req.raw));
app.all("/mcp/*", (c) => mcpFetch(c.req.raw));

console.error(`[mcp-hoster] data dir: ${config.dataDir}`);
console.error(
  `[mcp-hoster] database: ${config.engine} ${
    config.engine === "sqlite" ? config.sqlitePath : config.databaseUrl.replace(/:([^:@/]+)@/, ":***@")
  }`,
);

const server = Deno.serve({ hostname: config.bind, port: config.port }, app.fetch);
console.error(`[mcp-hoster] listening on http://${config.bind}:${config.port} (all interfaces)`);
console.error(`[mcp-hoster] admin UI: http://${config.bind}:${config.port}/ui`);
console.error(`[mcp-hoster] MCP endpoint: http://${config.bind}:${config.port}/mcp`);
if (config.gatewayPublicUrl) {
  console.error(`[mcp-hoster] public gateway URL: ${config.gatewayPublicUrl}`);
}

// Don't block the admin UI / health endpoint on slow uvx/npx cold starts.
void pm.startEnabled().then(() => {
  console.error("[mcp-hoster] enabled MCP servers finished starting");
}).catch((err) => {
  console.error("[mcp-hoster] enabled MCP server start sweep failed:", err);
});

async function shutdown() {
  console.error("[mcp-hoster] shutting down...");
  await pm.stopAll();
  await db.close();
  await server.shutdown();
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => void shutdown());
Deno.addSignalListener("SIGTERM", () => void shutdown());

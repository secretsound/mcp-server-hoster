import { Hono, type Context } from "hono";
import type { ServerRegistry } from "../registry.ts";
import type { SettingsRepository } from "../db/repos/settings.ts";
import type { AuditRepository } from "../db/repos/audit.ts";
import type {
  LibraryCategoryInput,
  LibraryCategoryUpdate,
  LibraryItemInput,
  LibraryItemUpdate,
  LibraryRepository,
} from "../db/repos/library.ts";
import type {
  CreateServerInput,
  SqlDatabase,
  UpdateServerInput,
  UpgradeServerInput,
} from "../db/types.ts";
import { getDatabaseInfo } from "../db/info.ts";
import { migrateToPostgres } from "../db/migrate_engine.ts";
import type { AuthService } from "../auth/service.ts";
import {
  actor,
  actorCan,
  type AuthEnv,
  createAuthMiddleware,
  requireSessionUser,
} from "../auth/middleware.ts";
import { allowsTool, type ScopeGrant } from "../auth/scopes.ts";
import { onLogAppend } from "../sandbox.ts";
import {
  parseSandboxMode,
  SANDBOX_MODE_SETTING_KEY,
  type SandboxController,
} from "../sandbox_wrap.ts";
import {
  applySettingsUpdate,
  pendingBootstrapDiff,
  SETTING_DEFS,
} from "../settings/registry.ts";
import { adminBus } from "./bus.ts";
import { createAuthRoutes } from "./auth_routes.ts";
import { sseResponse } from "./sse.ts";

const DEFAULT_TENANT_ID = "default";

async function auditServerAction(
  auth: AuthService,
  c: Context<AuthEnv>,
  action: string,
  serverId: string,
  summary: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const me = actor(c);
  await auth.recordAudit({
    tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
    actorUserId: me?.id ?? null,
    actorEmail: me?.email ?? null,
    action,
    resourceType: "server",
    resourceId: serverId,
    summary,
    metadata,
  });
}

function filterServersForUser<T extends { id: string }>(
  servers: T[],
  scopes: ScopeGrant[] | null,
  fullAccess: boolean,
): T[] {
  if (fullAccess || !scopes) return servers;
  if (scopes.some((g) => g.serverId === "*")) return servers;
  const allowed = new Set(scopes.map((g) => g.serverId));
  return servers.filter((s) => allowed.has(s.id));
}

export function createAdminApi(
  registry: ServerRegistry,
  settings: SettingsRepository,
  auth: AuthService,
  db: SqlDatabase,
  audit: AuditRepository,
  library: LibraryRepository,
  sandbox: SandboxController,
): Hono<AuthEnv> {
  const api = new Hono<AuthEnv>();
  api.use("*", createAuthMiddleware(auth));
  api.route("/auth", createAuthRoutes(auth));

  // Server management requires a session when auth is enabled.
  api.use("/servers/*", requireSessionUser);
  api.use("/servers", requireSessionUser);
  api.use("/library", requireSessionUser);
  api.use("/library/*", requireSessionUser);
  api.use("/settings", requireSessionUser);
  api.use("/settings/*", requireSessionUser);
  api.use("/database", requireSessionUser);
  api.use("/database/*", requireSessionUser);
  api.use("/host", requireSessionUser);
  api.use("/host/*", requireSessionUser);
  api.use("/events", requireSessionUser);
  api.use("/audit", requireSessionUser);
  api.use("/audit/*", requireSessionUser);

  // Bridge process log appends onto the admin event bus (once per process).
  onLogAppend((logPath, chunk) => {
    adminBus.emit({ type: "log", logPath, chunk });
  });

  api.get("/events", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    const me = actor(c);
    const full = await actorCan(c, "mcp:full");
    const scopes = me ? (full ? null : me.grants) : null;

    return sseResponse(c, (send, signal) => {
      const pushServers = async () => {
        const servers = filterServersForUser(await registry.list(), scopes, full);
        send("servers", { servers });
      };

      void pushServers();
      const unsub = adminBus.subscribe((event) => {
        if (event.type === "servers") void pushServers();
      });

      const ping = setInterval(() => {
        if (signal.aborted) return;
        send("ping", { ts: new Date().toISOString() });
      }, 25_000);

      signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
      });
    });
  });

  api.get("/servers", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    const me = actor(c);
    const full = await actorCan(c, "mcp:full");
    const scopes = me ? (full ? null : me.grants) : null;
    const servers = filterServersForUser(await registry.list(), scopes, full);
    return c.json({ servers });
  });

  api.get("/servers/:id", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    const id = c.req.param("id");
    const me = actor(c);
    const full = await actorCan(c, "mcp:full");
    if (!full && me && !me.grants.some((g) => g.serverId === "*" || g.serverId === id)) {
      return c.json({ error: "not found" }, 404);
    }
    const server = await registry.get(id);
    if (!server) return c.json({ error: "not found" }, 404);
    return c.json({ server });
  });

  api.get("/audit", async (c) => {
    if (!await actorCan(c, "audit:read")) {
      return c.json({ error: "Missing permission: audit:read" }, 403);
    }
    const me = actor(c);
    const tenantId = me?.tenantId ?? DEFAULT_TENANT_ID;
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");
    const action = c.req.query("action") || null;
    const resourceType = c.req.query("resourceType") || null;
    const resourceId = c.req.query("resourceId") || null;
    const { events, total } = await audit.list({
      tenantId,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      action,
      resourceType,
      resourceId,
    });
    return c.json({ events, total });
  });

  api.post("/servers", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<CreateServerInput>();
      if (!body.id || !body.command) {
        return c.json({ error: "id and command are required" }, 400);
      }
      const server = await registry.create(body);
      await auditServerAction(
        auth,
        c,
        "server.create",
        server.id,
        `Created server ${server.name || server.id}`,
        { name: server.name },
      );
      return c.json({ server }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.patch("/servers/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<UpdateServerInput>();
      const server = await registry.update(c.req.param("id"), body);
      return c.json({ server });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/servers/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const id = c.req.param("id");
      const existing = await registry.get(id);
      await registry.delete(id);
      await auditServerAction(
        auth,
        c,
        "server.delete",
        id,
        `Deleted server ${existing?.name || id}`,
      );
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.post("/servers/:id/start", async (c) => {
    if (!await actorCan(c, "servers:lifecycle")) {
      return c.json({ error: "Missing permission: servers:lifecycle" }, 403);
    }
    try {
      const id = c.req.param("id");
      await registry.pm.start(id);
      await auditServerAction(auth, c, "server.start", id, `Started server ${id}`);
      return c.json({ server: await registry.get(id) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.post("/servers/:id/stop", async (c) => {
    if (!await actorCan(c, "servers:lifecycle")) {
      return c.json({ error: "Missing permission: servers:lifecycle" }, 403);
    }
    try {
      const id = c.req.param("id");
      await registry.pm.stop(id);
      await auditServerAction(auth, c, "server.stop", id, `Stopped server ${id}`);
      return c.json({ server: await registry.get(id) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.post("/servers/:id/restart", async (c) => {
    if (!await actorCan(c, "servers:lifecycle")) {
      return c.json({ error: "Missing permission: servers:lifecycle" }, 403);
    }
    try {
      const id = c.req.param("id");
      await registry.pm.restart(id);
      await auditServerAction(auth, c, "server.restart", id, `Restarted server ${id}`);
      return c.json({ server: await registry.get(id) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.post("/servers/:id/upgrade", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const id = c.req.param("id");
      let body: UpgradeServerInput = {};
      try {
        body = await c.req.json<UpgradeServerInput>();
      } catch {
        body = {};
      }
      const result = await registry.upgrade(id, body ?? {});
      await auditServerAction(
        auth,
        c,
        "server.upgrade",
        id,
        `Upgraded server ${id} to ${result.upgrade.label}`,
        {
          kind: result.upgrade.kind,
          name: result.upgrade.name,
          version: result.upgrade.version,
          previousVersion: result.upgrade.previousVersion,
          clearedCache: result.upgrade.clearedCache,
        },
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.get("/servers/:id/logs", async (c) => {
    if (!await actorCan(c, "servers:lifecycle")) {
      return c.json({ error: "Missing permission: servers:lifecycle" }, 403);
    }
    const tail = Number(c.req.query("tail") ?? "200");
    const logs = await registry.pm.logs(c.req.param("id"), tail);
    return c.json({ logs });
  });

  api.get("/servers/:id/logs/stream", async (c) => {
    if (!await actorCan(c, "servers:lifecycle")) {
      return c.json({ error: "Missing permission: servers:lifecycle" }, 403);
    }
    const id = c.req.param("id");
    if (!await registry.get(id)) return c.json({ error: "not found" }, 404);
    const tail = Number(c.req.query("tail") ?? "300");
    const logPath = `${registry.config.logsDir}/${id}.log`;
    const initial = await registry.pm.logs(id, tail);

    return sseResponse(c, (send, signal) => {
      send("reset", { serverId: id, logs: initial });

      const unsub = adminBus.subscribe((event) => {
        if (event.type !== "log") return;
        if (event.logPath !== logPath) return;
        send("log", { serverId: id, chunk: event.chunk });
      });

      const ping = setInterval(() => {
        if (signal.aborted) return;
        send("ping", { ts: new Date().toISOString() });
      }, 25_000);

      signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
      });
    });
  });

  api.get("/servers/:id/tools", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    const id = c.req.param("id");
    if (!await registry.get(id)) return c.json({ error: "not found" }, 404);
    const me = actor(c);
    const full = await actorCan(c, "mcp:full");
    if (!full && me && !me.grants.some((g) => g.serverId === "*" || g.serverId === id)) {
      return c.json({ error: "not found" }, 404);
    }
    const scopes = full || !me ? null : me.grants;
    const server = (await registry.get(id))!;
    const tools = registry.pm.getTools(id)
      .filter((t) => !scopes || allowsTool(scopes, id, t.name))
      .map((t) => ({
        name: t.name,
        namespacedName: `${id}__${t.name}`,
        description: t.description,
        inputSchema: t.inputSchema,
        enabled: !server.disabledTools.includes(t.name),
      }));
    return c.json({
      tools,
      disabledTools: server.disabledTools,
    });
  });

  api.get("/library", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    return c.json({
      categories: await library.listCategories(),
      items: await library.list(),
    });
  });

  api.post("/library/categories", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<LibraryCategoryInput>();
      const category = await library.createCategory(body);
      return c.json({ category }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.patch("/library/categories/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<LibraryCategoryUpdate>();
      const category = await library.updateCategory(c.req.param("id"), body);
      return c.json({ category });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

  api.delete("/library/categories/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    const id = c.req.param("id");
    if (!await library.deleteCategory(id)) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  api.get("/library/:id", async (c) => {
    if (!await actorCan(c, "servers:read")) {
      return c.json({ error: "Missing permission: servers:read" }, 403);
    }
    const item = await library.get(c.req.param("id"));
    if (!item) return c.json({ error: "not found" }, 404);
    return c.json({ item });
  });

  api.post("/library", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<LibraryItemInput>();
      const item = await library.create(body);
      return c.json({ item }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.patch("/library/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    try {
      const body = await c.req.json<LibraryItemUpdate>();
      const item = await library.update(c.req.param("id"), body);
      return c.json({ item });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

  api.delete("/library/:id", async (c) => {
    if (!await actorCan(c, "servers:write")) {
      return c.json({ error: "Missing permission: servers:write" }, 403);
    }
    const id = c.req.param("id");
    if (!await library.delete(id)) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  api.get("/settings", async (c) => {
    if (!await actorCan(c, "settings:read")) {
      return c.json({ error: "Missing permission: settings:read" }, 403);
    }
    const pending = pendingBootstrapDiff(registry.config);
    return c.json({
      settings: await settings.getAll(),
      defs: SETTING_DEFS.map((d) => ({
        key: d.key,
        type: d.type,
        restartRequired: d.restartRequired,
        sensitive: d.sensitive ?? false,
        description: d.description,
      })),
      pendingBootstrap: pending,
      sandbox: {
        requested: sandbox.getRequested(),
        active: sandbox.getRuntime().mode,
        detail: sandbox.getRuntime().detail ?? null,
      },
    });
  });

  api.put("/settings", async (c) => {
    if (!await actorCan(c, "settings:write")) {
      return c.json({ error: "Missing permission: settings:write" }, 403);
    }
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const result = await applySettingsUpdate(settings, registry.config, body);
      registry.config.hostFile = {
        ...registry.config.hostFile,
        ...result.pendingBootstrap,
      };

      // Hot-apply gateway / public URL into live bootstrap config
      if (typeof body["host.gateway_public_url"] === "string") {
        const v = result.settings["host.gateway_public_url"]?.trim() || null;
        registry.config.gatewayPublicUrl = v;
      }
      if (typeof body["host.public_url"] === "string") {
        const v = result.settings["host.public_url"]?.trim() || null;
        registry.config.publicUrl = v;
        await auth.updateOAuthSettings({ publicUrl: v });
      }

      if (result.sandboxModeChanged) {
        const runtime = await sandbox.apply(
          parseSandboxMode(result.sandboxModeChanged),
        );
        console.error(
          `[sandbox] updated mode=${runtime.mode} (requested=${sandbox.getRequested()})${
            runtime.detail ? ` — ${runtime.detail}` : ""
          }`,
        );
        const me = actor(c);
        await auth.recordAudit({
          tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
          actorUserId: me?.id ?? null,
          actorEmail: me?.email ?? null,
          action: "settings.sandbox_mode",
          resourceType: "settings",
          resourceId: SANDBOX_MODE_SETTING_KEY,
          summary:
            `Sandbox mode set to ${result.sandboxModeChanged} (active: ${runtime.mode})`,
          metadata: {
            requested: result.sandboxModeChanged,
            active: runtime.mode,
            detail: runtime.detail ?? null,
          },
        });
      } else {
        const me = actor(c);
        await auth.recordAudit({
          tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
          actorUserId: me?.id ?? null,
          actorEmail: me?.email ?? null,
          action: "settings.update",
          resourceType: "settings",
          resourceId: null,
          summary: "Updated host settings",
          metadata: { keys: Object.keys(body), restartRequired: result.restartRequired },
        });
      }

      return c.json({
        settings: result.settings,
        restartRequired: result.restartRequired,
        pendingBootstrap: pendingBootstrapDiff(registry.config),
        sandbox: {
          requested: sandbox.getRequested(),
          active: sandbox.getRuntime().mode,
          detail: sandbox.getRuntime().detail ?? null,
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.get("/database", async (c) => {
    if (!await actorCan(c, "settings:read")) {
      return c.json({ error: "Missing permission: settings:read" }, 403);
    }
    const info = await getDatabaseInfo(db, registry.config);
    return c.json({ database: info });
  });

  api.post("/database/migrate", async (c) => {
    if (!await actorCan(c, "settings:write")) {
      return c.json({ error: "Missing permission: settings:write" }, 403);
    }
    try {
      const body = await c.req.json<{
        databaseUrl?: string;
        confirmWipe?: boolean;
      }>();
      if (!body.databaseUrl?.trim()) {
        return c.json({ error: "databaseUrl is required" }, 400);
      }
      const result = await migrateToPostgres({
        source: db,
        targetDatabaseUrl: body.databaseUrl,
        migrationsDir: registry.config.migrationsDir,
        dataDir: registry.config.dataDir,
        confirmWipe: body.confirmWipe === true,
      });
      await settings.set("host.database_url", body.databaseUrl.trim());
      registry.config.hostFile = {
        ...registry.config.hostFile,
        databaseUrl: body.databaseUrl.trim(),
      };
      const me = actor(c);
      await auth.recordAudit({
        tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
        actorUserId: me?.id ?? null,
        actorEmail: me?.email ?? null,
        action: "database.migrate",
        resourceType: "database",
        resourceId: "postgres",
        summary: "Migrated SQLite data to Postgres (restart required)",
        metadata: { counts: result.counts },
      });
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      );
    }
  });

  api.post("/host/restart", async (c) => {
    if (!await actorCan(c, "settings:write")) {
      return c.json({ error: "Missing permission: settings:write" }, 403);
    }
    const me = actor(c);
    await auth.recordAudit({
      tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: me?.id ?? null,
      actorEmail: me?.email ?? null,
      action: "host.restart",
      resourceType: "host",
      resourceId: null,
      summary: "Host restart requested from settings",
    });
    // Respond first, then exit so docker/watch can bring the process back.
    queueMicrotask(() => {
      setTimeout(() => Deno.exit(0), 150);
    });
    return c.json({ ok: true, restarting: true });
  });

  api.get("/database/backup", async (c) => {
    if (!await actorCan(c, "settings:write")) {
      return c.json({ error: "Missing permission: settings:write" }, 403);
    }
    if (db.engine !== "sqlite" || !registry.config.sqlitePath) {
      return c.json(
        { error: "File backup is only available for SQLite. Use pg_dump for Postgres." },
        400,
      );
    }
    try {
      try {
        await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        /* best-effort for WAL mode */
      }
      const path = registry.config.sqlitePath;
      const bytes = await Deno.readFile(path);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const me = actor(c);
      await auth.recordAudit({
        tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
        actorUserId: me?.id ?? null,
        actorEmail: me?.email ?? null,
        action: "database.backup",
        resourceType: "database",
        resourceId: path,
        summary: "Downloaded SQLite backup",
        metadata: { bytes: bytes.byteLength },
      });
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/vnd.sqlite3",
          "Content-Disposition":
            `attachment; filename="mcp-hoster-backup-${stamp}.db"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  api.post("/database/restore", async (c) => {
    if (!await actorCan(c, "settings:write")) {
      return c.json({ error: "Missing permission: settings:write" }, 403);
    }
    if (db.engine !== "sqlite" || !registry.config.sqlitePath) {
      return c.json(
        { error: "File restore is only available for SQLite." },
        400,
      );
    }
    try {
      const buf = new Uint8Array(await c.req.arrayBuffer());
      const magic = new TextDecoder().decode(buf.slice(0, 15));
      if (buf.byteLength < 100 || magic !== "SQLite format 3") {
        return c.json({ error: "Upload is not a SQLite database file" }, 400);
      }
      const dest = `${registry.config.sqlitePath}.restore`;
      await Deno.writeFile(dest, buf);
      const me = actor(c);
      await auth.recordAudit({
        tenantId: me?.tenantId ?? DEFAULT_TENANT_ID,
        actorUserId: me?.id ?? null,
        actorEmail: me?.email ?? null,
        action: "database.restore",
        resourceType: "database",
        resourceId: dest,
        summary: "Staged SQLite restore (applies on next restart)",
        metadata: { bytes: buf.byteLength },
      });
      return c.json({
        ok: true,
        path: dest,
        message: "Restore staged. Restart the host to apply it.",
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  return api;
}

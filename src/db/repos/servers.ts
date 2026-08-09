import { extractPackageSpec } from "../../package_spec.ts";
import type {
  CreateServerInput,
  DesiredState,
  RuntimeStatus,
  ServerRecord,
  ServerRuntime,
  ServerSource,
  ServerWithRuntime,
  SqlDatabase,
  UpdateServerInput,
} from "../types.ts";

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "object" && value !== null) return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToServer(row: Record<string, unknown>): ServerRecord {
  const sourceGit = row.source_git as string | null;
  const source: ServerSource = sourceGit
    ? { git: sourceGit, ref: (row.source_ref as string | null) ?? undefined }
    : null;

  const command = String(row.command);
  const args = parseJson<string[]>(row.args, []);
  const derived = extractPackageSpec({ command, args, source });
  const packageName = (row.package_name as string | null) ?? derived.name;
  const packageVersion =
    (row.package_version as string | null) ?? derived.version;

  return {
    id: String(row.id),
    name: String(row.name),
    transport: "stdio",
    command,
    args,
    env: parseJson<Record<string, string>>(row.env, {}),
    cwd: (row.cwd as string | null) ?? null,
    source,
    enabled: Boolean(row.enabled),
    packageName,
    packageVersion,
    lastUpgradedAt: (row.last_upgraded_at as string | null) ?? null,
    disabledTools: normalizeDisabledTools(
      parseJson<unknown>(row.disabled_tools, []),
    ),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeDisabledTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function rowToRuntime(row: Record<string, unknown>): ServerRuntime {
  return {
    serverId: String(row.server_id),
    desiredState: String(row.desired_state) as DesiredState,
    lastStatus: String(row.last_status) as RuntimeStatus,
    lastError: (row.last_error as string | null) ?? null,
    pid: row.pid == null ? null : Number(row.pid),
    restartCount: Number(row.restart_count ?? 0),
    lastStartedAt: (row.last_started_at as string | null) ?? null,
    lastCrashAt: (row.last_crash_at as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

const defaultRuntime = (serverId: string): ServerRuntime => ({
  serverId,
  desiredState: "stopped",
  lastStatus: "stopped",
  lastError: null,
  pid: null,
  restartCount: 0,
  lastStartedAt: null,
  lastCrashAt: null,
  updatedAt: now(),
});

export class ServerRepository {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<ServerWithRuntime[]> {
    const rows = await this.db.prepare(`
      SELECT s.*,
        r.desired_state, r.last_status, r.last_error, r.pid,
        r.restart_count, r.last_started_at, r.last_crash_at,
        r.updated_at AS runtime_updated_at
      FROM servers s
      LEFT JOIN server_runtime r ON r.server_id = s.id
      ORDER BY s.id
    `).all();

    return rows.map((row) => {
      const server = rowToServer(row);
      const runtime = row.desired_state != null
        ? rowToRuntime({
          server_id: row.id,
          desired_state: row.desired_state,
          last_status: row.last_status,
          last_error: row.last_error,
          pid: row.pid,
          restart_count: row.restart_count,
          last_started_at: row.last_started_at,
          last_crash_at: row.last_crash_at,
          updated_at: row.runtime_updated_at,
        })
        : defaultRuntime(server.id);
      return { ...server, runtime };
    });
  }

  async get(id: string): Promise<ServerWithRuntime | null> {
    return (await this.list()).find((s) => s.id === id) ?? null;
  }

  async count(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS c FROM servers").get();
    return Number(row?.c ?? 0);
  }

  async create(input: CreateServerInput): Promise<ServerWithRuntime> {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) {
    throw new Error("Server id must be alphanumeric, dash, or underscore");
    }
    if (await this.get(input.id)) {
    throw new Error(`Server already exists: ${input.id}`);
    }

    const ts = now();
    const enabled = input.enabled ?? true;
    const name = input.name ?? input.id;
    const argsArr = input.args ?? [];
    const args = JSON.stringify(argsArr);
    const env = JSON.stringify(input.env ?? {});
    const sourceGit = input.source?.git ?? null;
    const sourceRef = input.source?.ref ?? null;
    const derived = extractPackageSpec({
      command: input.command,
      args: argsArr,
      source: input.source ?? null,
    });
    const packageName = input.packageName ?? derived.name;
    const packageVersion = input.packageVersion !== undefined
      ? input.packageVersion
      : derived.version;
    const disabledTools = JSON.stringify(
      normalizeDisabledTools(input.disabledTools ?? []),
    );

    await this.db.prepare(`
      INSERT INTO servers (
        id, name, transport, command, args, env, cwd,
        source_git, source_ref, enabled,
        package_name, package_version, last_upgraded_at,
        disabled_tools, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      input.id,
      name,
      input.transport ?? "stdio",
      input.command,
      args,
      env,
      input.cwd ?? null,
      sourceGit,
      sourceRef,
      enabled ? 1 : 0,
      packageName,
      packageVersion,
      disabledTools,
      ts,
      ts,
    );

    await this.db.prepare(`
      INSERT INTO server_runtime (
        server_id, desired_state, last_status, last_error, pid,
        restart_count, last_started_at, last_crash_at, updated_at
      )
      VALUES (?, ?, ?, NULL, NULL, 0, NULL, NULL, ?)
    `).run(input.id, enabled ? "running" : "stopped", "stopped", ts);

    return (await this.get(input.id))!;
  }

  async update(id: string, input: UpdateServerInput): Promise<ServerWithRuntime> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Server not found: ${id}`);

    const ts = now();
    const name = input.name ?? existing.name;
    const command = input.command ?? existing.command;
    const argsArr = input.args ?? existing.args;
    const args = JSON.stringify(argsArr);
    const env = JSON.stringify(input.env ?? existing.env);
    const cwd = input.cwd !== undefined ? input.cwd : existing.cwd;
    const source = input.source !== undefined ? input.source : existing.source;
    const enabled = input.enabled ?? existing.enabled;
    const derived = extractPackageSpec({ command, args: argsArr, source });
    const packageName = input.packageName !== undefined
      ? input.packageName
      : (existing.packageName ?? derived.name);
    const packageVersion = input.packageVersion !== undefined
      ? input.packageVersion
      : (existing.packageVersion ?? derived.version);
    const lastUpgradedAt = input.lastUpgradedAt !== undefined
      ? input.lastUpgradedAt
      : existing.lastUpgradedAt;
    const disabledTools = JSON.stringify(
      normalizeDisabledTools(
        input.disabledTools !== undefined
          ? input.disabledTools
          : existing.disabledTools,
      ),
    );

    await this.db.prepare(`
      UPDATE servers SET
        name = ?, command = ?, args = ?, env = ?, cwd = ?,
        source_git = ?, source_ref = ?, enabled = ?,
        package_name = ?, package_version = ?, last_upgraded_at = ?,
        disabled_tools = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      command,
      args,
      env,
      cwd,
      source?.git ?? null,
      source?.ref ?? null,
      enabled ? 1 : 0,
      packageName,
      packageVersion,
      lastUpgradedAt,
      disabledTools,
      ts,
      id,
    );

    return (await this.get(id))!;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM servers WHERE id = ?").run(id);
  }

  async setRuntime(
    serverId: string,
    patch: {
      desiredState?: DesiredState;
      lastStatus?: RuntimeStatus;
      lastError?: string | null;
      pid?: number | null;
      restartCount?: number;
      lastStartedAt?: string | null;
      lastCrashAt?: string | null;
    },
  ): Promise<void> {
    const existing = await this.get(serverId);
    if (!existing) return;
    const ts = now();
    await this.db.prepare(`
      INSERT INTO server_runtime (
        server_id, desired_state, last_status, last_error, pid,
        restart_count, last_started_at, last_crash_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        desired_state = excluded.desired_state,
        last_status = excluded.last_status,
        last_error = excluded.last_error,
        pid = excluded.pid,
        restart_count = excluded.restart_count,
        last_started_at = excluded.last_started_at,
        last_crash_at = excluded.last_crash_at,
        updated_at = excluded.updated_at
    `).run(
      serverId,
      patch.desiredState ?? existing.runtime.desiredState,
      patch.lastStatus ?? existing.runtime.lastStatus,
      patch.lastError !== undefined ? patch.lastError : existing.runtime.lastError,
      patch.pid !== undefined ? patch.pid : existing.runtime.pid,
      patch.restartCount ?? existing.runtime.restartCount,
      patch.lastStartedAt !== undefined
        ? patch.lastStartedAt
        : existing.runtime.lastStartedAt,
      patch.lastCrashAt !== undefined
        ? patch.lastCrashAt
        : existing.runtime.lastCrashAt,
      ts,
    );
  }

  async resetEphemeralRuntime(): Promise<void> {
    await this.db.prepare(`
      UPDATE server_runtime
      SET last_status = CASE WHEN desired_state = 'running' THEN 'stopped' ELSE last_status END,
          pid = NULL,
          updated_at = ?
    `).run(now());
  }
}

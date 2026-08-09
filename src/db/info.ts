import type { BootstrapConfig } from "../config.ts";
import { redactDatabaseUrl } from "../config.ts";
import { pendingBootstrapDiff } from "../settings/registry.ts";
import type { SqlDatabase } from "./types.ts";

export type DatabaseInfo = {
  engine: "sqlite" | "postgres";
  url: string;
  /** Redacted URL safe for UI display. */
  urlRedacted: string;
  path: string;
  dataDir: string;
  sizeBytes: number | null;
  canBackup: boolean;
  canRestore: boolean;
  canMigrateToPostgres: boolean;
  pendingBootstrap: {
    pending: boolean;
    live: Record<string, string>;
    file: Record<string, string>;
  };
  migrations: Array<{ version: string; appliedAt: string }>;
  counts: Record<string, number>;
};

async function count(db: SqlDatabase, table: string): Promise<number> {
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

export async function getDatabaseInfo(
  db: SqlDatabase,
  config: BootstrapConfig,
): Promise<DatabaseInfo> {
  const engine = db.engine;
  let sizeBytes: number | null = null;
  if (engine === "sqlite" && config.sqlitePath) {
    try {
      const st = await Deno.stat(config.sqlitePath);
      sizeBytes = st.size;
    } catch {
      sizeBytes = null;
    }
  }

  const migrations = (await db.prepare(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version",
  ).all()).map((row) => ({
    version: String(row.version),
    appliedAt: String(row.applied_at),
  }));

  const pending = pendingBootstrapDiff(config);

  return {
    engine,
    url: config.databaseUrl,
    urlRedacted: redactDatabaseUrl(config.databaseUrl),
    path: config.sqlitePath,
    dataDir: config.dataDir,
    sizeBytes,
    canBackup: engine === "sqlite",
    canRestore: engine === "sqlite",
    canMigrateToPostgres: engine === "sqlite",
    pendingBootstrap: pending,
    migrations,
    counts: {
      servers: await count(db, "servers"),
      users: await count(db, "users"),
      sessions: await count(db, "sessions"),
      api_keys: await count(db, "api_keys"),
      invites: await count(db, "invites"),
      roles: await count(db, "roles"),
      settings: await count(db, "settings"),
      audit_events: await count(db, "audit_events"),
      library_items: await count(db, "library_items"),
      library_categories: await count(db, "library_categories"),
    },
  };
}

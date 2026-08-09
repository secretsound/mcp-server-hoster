import { openDatabase, isPostgresUrl } from "./client.ts";
import { migrate } from "./migrate.ts";
import type { SqlDatabase } from "./types.ts";
import { writeHostBootstrap } from "../config.ts";

/** FK-safe copy order (parents before children). */
export const MIGRATE_TABLES = [
  "tenants",
  "roles",
  "role_permissions",
  "users",
  "user_grants",
  "sessions",
  "api_keys",
  "invites",
  "oauth_accounts",
  "oauth_states",
  "oauth_config",
  "oauth_providers",
  "mcp_oauth_clients",
  "mcp_oauth_auth_requests",
  "mcp_oauth_codes",
  "mcp_oauth_tokens",
  "servers",
  "server_runtime",
  "settings",
  "audit_events",
  "library_categories",
  "library_items",
] as const;

const REVERSE_TABLES = [...MIGRATE_TABLES].reverse();

export type MigrateResult = {
  ok: true;
  sourceEngine: string;
  targetEngine: "postgres";
  counts: Record<string, { source: number; target: number }>;
  restartRequired: true;
  hostBootstrapPath: string;
};

async function tableExists(db: SqlDatabase, table: string): Promise<boolean> {
  if (db.engine === "sqlite") {
    const row = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    ).get(table);
    return row != null;
  }
  const row = await db.prepare(
    `SELECT to_regclass(?) AS name`,
  ).get(`public.${table}`);
  return row?.name != null;
}

async function countRows(db: SqlDatabase, table: string): Promise<number> {
  if (!await tableExists(db, table)) return 0;
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return Number(row?.c ?? 0);
}

async function columnNames(db: SqlDatabase, table: string): Promise<string[]> {
  if (db.engine === "sqlite") {
    const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.map((r) => String(r.name));
  }
  const rows = await db.prepare(`
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ?
    ORDER BY ordinal_position
  `).all(table);
  return rows.map((r) => String(r.name));
}

async function wipeTables(db: SqlDatabase): Promise<void> {
  if (db.engine === "postgres") {
    const existing: string[] = [];
    for (const t of REVERSE_TABLES) {
      if (await tableExists(db, t)) existing.push(t);
    }
    if (existing.length === 0) return;
    await db.exec(
      `TRUNCATE TABLE ${existing.join(", ")} RESTART IDENTITY CASCADE`,
    );
    return;
  }
  for (const t of REVERSE_TABLES) {
    if (await tableExists(db, t)) {
      await db.exec(`DELETE FROM ${t}`);
    }
  }
}

async function copyTable(
  source: SqlDatabase,
  target: SqlDatabase,
  table: string,
): Promise<{ source: number; target: number }> {
  if (!await tableExists(source, table)) {
    return { source: 0, target: await countRows(target, table) };
  }
  if (!await tableExists(target, table)) {
    throw new Error(`Target missing table: ${table}`);
  }

  const srcCols = await columnNames(source, table);
  const tgtCols = new Set(await columnNames(target, table));
  const cols = srcCols.filter((c) => tgtCols.has(c));
  if (cols.length === 0) {
    return { source: await countRows(source, table), target: 0 };
  }

  const rows = await source.prepare(
    `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table}`,
  ).all();

  if (rows.length > 0) {
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const stmt = target.prepare(
      `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
    );
    for (const row of rows) {
      const values = cols.map((c) => {
        const v = row[c];
        if (v === undefined) return null;
        if (typeof v === "object" && v !== null) return JSON.stringify(v);
        return v;
      });
      await stmt.run(...values);
    }
  }

  return {
    source: rows.length,
    target: await countRows(target, table),
  };
}

export type MigrateToPostgresOpts = {
  source: SqlDatabase;
  targetDatabaseUrl: string;
  migrationsDir: string;
  dataDir: string;
  /** When true, wipe existing rows in the target before copy. */
  confirmWipe?: boolean;
};

/**
 * Copy all app tables from the live DB into a Postgres URL, then write host.json.
 * Caller must restart to open the new database.
 */
export async function migrateToPostgres(
  opts: MigrateToPostgresOpts,
): Promise<MigrateResult> {
  const targetUrl = opts.targetDatabaseUrl.trim();
  if (!isPostgresUrl(targetUrl)) {
    throw new Error("Target databaseUrl must be postgres:// or postgresql://");
  }
  if (opts.source.engine !== "sqlite") {
    throw new Error("Migration is only supported from a live SQLite database");
  }

  const target = await openDatabase(targetUrl, "");
  try {
    await migrate(target, opts.migrationsDir);

    let targetRows = 0;
    for (const t of MIGRATE_TABLES) {
      targetRows += await countRows(target, t);
    }
    if (targetRows > 0) {
      if (!opts.confirmWipe) {
        throw new Error(
          `Target Postgres already has ${targetRows} row(s). Re-submit with confirmWipe: true to replace them.`,
        );
      }
      await wipeTables(target);
    }

    const counts: Record<string, { source: number; target: number }> = {};
    for (const table of MIGRATE_TABLES) {
      counts[table] = await copyTable(opts.source, target, table);
      if (counts[table].source !== counts[table].target) {
        throw new Error(
          `Count mismatch for ${table}: source=${counts[table].source} target=${counts[table].target}`,
        );
      }
    }

    // Mark migrations applied on target (already done by migrate())
    const hostBootstrapPath = await writeHostBootstrap(opts.dataDir, {
      databaseUrl: targetUrl,
    });

    return {
      ok: true,
      sourceEngine: opts.source.engine,
      targetEngine: "postgres",
      counts,
      restartRequired: true,
      hostBootstrapPath,
    };
  } finally {
    await target.close();
  }
}

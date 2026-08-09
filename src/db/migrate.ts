import { join } from "@std/path";
import type { SqlDatabase } from "./types.ts";
import { postgresifyStatement, splitSqlStatements } from "./sql_util.ts";

export async function migrate(db: SqlDatabase, migrationsDir: string): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (await db.prepare("SELECT version FROM schema_migrations").all()).map((r) =>
      String(r.version)
    ),
  );

  const entries: string[] = [];
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && entry.name.endsWith(".sql")) {
        entries.push(entry.name);
      }
    }
  } catch (err) {
    throw new Error(`Failed to read migrations from ${migrationsDir}: ${err}`);
  }

  entries.sort();

  for (const name of entries) {
    if (applied.has(name)) continue;
    const sql = await Deno.readTextFile(join(migrationsDir, name));
    if (db.engine === "postgres") {
      for (const stmt of splitSqlStatements(sql)) {
        await db.exec(postgresifyStatement(stmt));
      }
      await db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
      ).run(name, new Date().toISOString());
    } else {
      await db.exec(sql);
      await db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(name, new Date().toISOString());
    }
    console.error(`[db] applied migration ${name}`);
  }
}

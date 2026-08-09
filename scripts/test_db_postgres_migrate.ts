/**
 * Optional: set TEST_DATABASE_URL=postgres://... to exercise SQLite→Postgres copy.
 * Without it, this script exits 0 after a skip message.
 */
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { openDatabase } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { migrateToPostgres } from "../src/db/migrate_engine.ts";
import { SettingsRepository } from "../src/db/repos/settings.ts";

const target = Deno.env.get("TEST_DATABASE_URL")?.trim();
if (!target) {
  console.log("skip: TEST_DATABASE_URL not set");
  Deno.exit(0);
}

const tmp = await Deno.makeTempDir({ prefix: "mcp-hoster-migrate-" });
const sqlitePath = join(tmp, "source.db");
const dataDir = join(tmp, "data");
await ensureDir(dataDir);

const source = await openDatabase(`sqlite://${sqlitePath}`, sqlitePath);
const migrationsDir = join(Deno.cwd(), "migrations");
await migrate(source, migrationsDir);

const settings = new SettingsRepository(source);
await settings.set("host.display_name", "Migrate Test");
await settings.set("ui.default_log_tail", "123");

const result = await migrateToPostgres({
  source,
  targetDatabaseUrl: target,
  migrationsDir,
  dataDir,
  confirmWipe: true,
});

if (!result.ok || !result.restartRequired) {
  throw new Error("migrate result unexpected");
}
if (result.counts.settings?.source !== result.counts.settings?.target) {
  throw new Error("settings count mismatch");
}

await source.close();
console.log("ok: postgres migrate", result.counts.settings);

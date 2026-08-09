import {
  postgresifyStatement,
  rewritePlaceholders,
  splitSqlStatements,
  transformMigrationSql,
} from "../src/db/sql_util.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  rewritePlaceholders("SELECT * FROM t WHERE a = ? AND b = ?") ===
    "SELECT * FROM t WHERE a = $1 AND b = $2",
  "placeholder rewrite",
);
assert(
  rewritePlaceholders("SELECT '?' AS q, x FROM t WHERE y = ?") ===
    "SELECT '?' AS q, x FROM t WHERE y = $1",
  "placeholder ignores string literals",
);

const stmts = splitSqlStatements(`
CREATE TABLE a (id TEXT);
INSERT INTO a VALUES ('a;b');
CREATE INDEX i ON a(id);
`);
assert(stmts.length === 3, `expected 3 stmts, got ${stmts.length}`);

assert(
  postgresifyStatement("INSERT OR IGNORE INTO schema_migrations VALUES (1)")
    .includes("ON CONFLICT DO NOTHING"),
  "postgresify INSERT OR IGNORE",
);

assert(
  transformMigrationSql("INSERT OR IGNORE INTO t VALUES (1)", "postgres")
    .startsWith("INSERT"),
  "transform migration",
);

console.log("ok: sql_util");

/** Rewrite `?` placeholders to Postgres `$1…$n` (string-literal aware). */
export function rewritePlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (inSingle) {
      out += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && sql[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "?") {
      n++;
      out += `$${n}`;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Light SQLite→Postgres transforms for migration SQL. */
export function transformMigrationSql(sql: string, engine: "sqlite" | "postgres"): string {
  if (engine === "sqlite") return sql;
  return sql.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
}

/**
 * Split a SQL script into statements on bare semicolons.
 * Ignores semicolons inside quotes.
 */
export function splitSqlStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inSingle) {
      cur += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        cur += "'";
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      cur += ch;
      if (ch === '"' && sql[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      cur += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const trimmed = cur.trim();
  if (trimmed) stmts.push(trimmed);
  return stmts;
}

/** Convert INSERT OR IGNORE … into INSERT … ON CONFLICT DO NOTHING for Postgres. */
export function postgresifyStatement(sql: string): string {
  const trimmed = sql.trim();
  if (!/^\s*INSERT\s+OR\s+IGNORE\b/i.test(trimmed)) {
    // Also handle already-transformed INSERT that came from INSERT OR IGNORE via transformMigrationSql
    // migrate.ts uses INSERT OR IGNORE separately for schema_migrations.
    return trimmed;
  }
  const without = trimmed.replace(/^\s*INSERT\s+OR\s+IGNORE\b/i, "INSERT");
  if (/\bON\s+CONFLICT\b/i.test(without)) return without;
  return `${without} ON CONFLICT DO NOTHING`;
}

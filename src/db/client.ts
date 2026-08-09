import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import postgres from "postgres";
import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import type { SqlDatabase, SqlStatement } from "./types.ts";
import { rewritePlaceholders, splitSqlStatements } from "./sql_util.ts";

class SqliteStatement implements SqlStatement {
  constructor(private readonly stmt: ReturnType<DatabaseSync["prepare"]>) {}

  async run(...params: unknown[]): Promise<void> {
    this.stmt.run(...(params as SQLInputValue[]));
  }

  async get(...params: unknown[]): Promise<Record<string, unknown> | undefined> {
    const row = this.stmt.get(...(params as SQLInputValue[]));
    return row as Record<string, unknown> | undefined;
  }

  async all(...params: unknown[]): Promise<Record<string, unknown>[]> {
    return this.stmt.all(...(params as SQLInputValue[])) as Record<string, unknown>[];
  }
}

class SqliteDatabase implements SqlDatabase {
  readonly engine = "sqlite" as const;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    return new SqliteStatement(this.db.prepare(sql));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

type PgSql = ReturnType<typeof postgres>;

class PostgresStatement implements SqlStatement {
  constructor(
    private readonly sql: PgSql,
    private readonly text: string,
  ) {}

  async run(...params: unknown[]): Promise<void> {
    await this.sql.unsafe(this.text, params as postgres.ParameterOrJSON<never>[]);
  }

  async get(...params: unknown[]): Promise<Record<string, unknown> | undefined> {
    const rows = await this.sql.unsafe(
      this.text,
      params as postgres.ParameterOrJSON<never>[],
    );
    return rows[0] as Record<string, unknown> | undefined;
  }

  async all(...params: unknown[]): Promise<Record<string, unknown>[]> {
    const rows = await this.sql.unsafe(
      this.text,
      params as postgres.ParameterOrJSON<never>[],
    );
    return rows as unknown as Record<string, unknown>[];
  }
}

class PostgresDatabase implements SqlDatabase {
  readonly engine = "postgres" as const;

  constructor(private readonly sql: PgSql) {}

  async exec(sql: string): Promise<void> {
    const stmts = splitSqlStatements(sql);
    for (const stmt of stmts) {
      await this.sql.unsafe(stmt);
    }
  }

  prepare(sql: string): SqlStatement {
    return new PostgresStatement(this.sql, rewritePlaceholders(sql));
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

export function isPostgresUrl(databaseUrl: string): boolean {
  return (
    databaseUrl.startsWith("postgres://") ||
    databaseUrl.startsWith("postgresql://")
  );
}

export function isSqliteUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith("sqlite:");
}

export async function openDatabase(
  databaseUrl: string,
  sqlitePath: string,
): Promise<SqlDatabase> {
  if (isPostgresUrl(databaseUrl)) {
    const sql = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 30,
      prepare: false,
    });
    // Smoke-check connectivity
    await sql`select 1`;
    return new PostgresDatabase(sql);
  }

  if (!isSqliteUrl(databaseUrl)) {
    throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl}`);
  }

  await ensureDir(dirname(sqlitePath));
  const db = new DatabaseSync(sqlitePath);
  return new SqliteDatabase(db);
}

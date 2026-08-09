/** Portable SQL executor surface — SQLite and Postgres. */
export interface SqlDatabase {
  readonly engine: "sqlite" | "postgres";
  exec(sql: string): Promise<void>;
  prepare(sql: string): SqlStatement;
  close(): Promise<void>;
}

export interface SqlStatement {
  run(...params: unknown[]): Promise<void>;
  get(...params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...params: unknown[]): Promise<Record<string, unknown>[]>;
}

export type DesiredState = "running" | "stopped";
export type RuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "restarting";

export type ServerSource = {
  git: string;
  ref?: string;
} | null;

export type ServerRecord = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  source: ServerSource;
  enabled: boolean;
  /** Unpinned package name when launch is npx/uvx (optional metadata). */
  packageName: string | null;
  /** Explicit package/git pin, or null for floating/latest. */
  packageVersion: string | null;
  lastUpgradedAt: string | null;
  /** Original tool names hidden from MCP clients (denylist). */
  disabledTools: string[];
  createdAt: string;
  updatedAt: string;
};

export type ServerRuntime = {
  serverId: string;
  desiredState: DesiredState;
  lastStatus: RuntimeStatus;
  lastError: string | null;
  pid: number | null;
  restartCount: number;
  lastStartedAt: string | null;
  lastCrashAt: string | null;
  updatedAt: string;
};

export type ServerWithRuntime = ServerRecord & {
  runtime: ServerRuntime;
};

export type CreateServerInput = {
  id: string;
  name?: string;
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  source?: ServerSource;
  enabled?: boolean;
  packageName?: string | null;
  packageVersion?: string | null;
  disabledTools?: string[];
};

export type UpdateServerInput = {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  source?: ServerSource;
  enabled?: boolean;
  packageName?: string | null;
  packageVersion?: string | null;
  lastUpgradedAt?: string | null;
  disabledTools?: string[];
};

export type UpgradeServerInput = {
  /** Target pin; omit or null for latest/floating. */
  version?: string | null;
  /** Clear npx/uv caches in the server sandbox before restart. */
  clearCache?: boolean;
};

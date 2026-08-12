import { join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";

/** Official library catalog on GitHub (main branch). */
export const DEFAULT_LIBRARY_CATALOG_URL =
  "https://raw.githubusercontent.com/secretsound/mcp_host_server/main/catalog/catalog.json";

export type HostBootstrapFile = {
  databaseUrl?: string;
  bind?: string;
  port?: number;
  dataDir?: string;
  gatewayPublicUrl?: string | null;
  publicUrl?: string | null;
  authDisabled?: boolean;
  authAllowOpen?: boolean;
};

export type BootstrapConfig = {
  bind: string;
  port: number;
  /** Optional absolute gateway URL for clients (e.g. http://192.168.1.10:8080/mcp). */
  gatewayPublicUrl: string | null;
  dataDir: string;
  databaseUrl: string;
  /** Filesystem path for sqlite; empty string when using Postgres. */
  sqlitePath: string;
  engine: "sqlite" | "postgres";
  seedPath: string | null;
  /** JSON catalog of library categories + items (seeded when those tables are empty). */
  librarySeedPath: string | null;
  migrationsDir: string;
  logsDir: string;
  serversDir: string;
  workspacesDir: string;
  /** When true, skip auth enforcement even if users exist. */
  authDisabled: boolean;
  /**
   * When true and no users exist, allow unauthenticated API/MCP (local POC).
   * Default false — startup requires BOOTSTRAP_ADMIN_* or existing users.
   */
  authAllowOpen: boolean;
  bootstrapAdminEmail: string | null;
  bootstrapAdminPassword: string | null;
  bootstrapAdminDisplayName: string | null;
  /** Public origin for OAuth redirects (e.g. https://host.example.com). */
  publicUrl: string | null;
  /** Path to host.json (may not exist yet). */
  hostBootstrapPath: string;
  /** Values loaded from host.json (before env overrides). */
  hostFile: HostBootstrapFile;
};

function envFlag(name: string, fallback = false): boolean {
  const raw = (Deno.env.get(name) ?? (fallback ? "true" : "false")).toLowerCase();
  return ["1", "true", "yes"].includes(raw);
}

function env(name: string, fallback?: string): string | undefined {
  return Deno.env.get(name) ?? fallback;
}

function normalizeGatewayUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const noSlash = trimmed.replace(/\/$/, "");
  return noSlash.endsWith("/mcp") ? noSlash : `${noSlash}/mcp`;
}

export function hostBootstrapPath(dataDir: string): string {
  return join(dataDir, "host.json");
}

export async function readHostBootstrap(dataDir: string): Promise<HostBootstrapFile> {
  const path = hostBootstrapPath(dataDir);
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as HostBootstrapFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

export async function writeHostBootstrap(
  dataDir: string,
  patch: HostBootstrapFile,
): Promise<string> {
  await ensureDir(dataDir);
  const path = hostBootstrapPath(dataDir);
  const current = await readHostBootstrap(dataDir);
  const next: HostBootstrapFile = { ...current, ...patch };
  // Drop undefined keys
  for (const key of Object.keys(next) as Array<keyof HostBootstrapFile>) {
    if (next[key] === undefined) delete next[key];
  }
  await Deno.writeTextFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

export function isPostgresUrl(databaseUrl: string): boolean {
  return (
    databaseUrl.startsWith("postgres://") ||
    databaseUrl.startsWith("postgresql://")
  );
}

/** Parse sqlite:///abs/path or sqlite://./rel/path into a filesystem path. */
export function sqlitePathFromUrl(databaseUrl: string, dataDir: string): string {
  if (isPostgresUrl(databaseUrl)) {
    return "";
  }

  if (!databaseUrl.startsWith("sqlite:")) {
    throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl}`);
  }

  // Accept sqlite:/path, sqlite:///path, sqlite:////abs, sqlite:./rel
  let rest = databaseUrl.slice("sqlite:".length);
  while (rest.startsWith("//")) {
    rest = rest.slice(1);
  }
  if (!rest) {
    return resolve(join(dataDir, "mcp-hoster.db"));
  }
  if (rest.startsWith("/")) {
    return rest;
  }
  return resolve(Deno.cwd(), rest);
}

/** Redact password from a database URL for display. */
export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    if (databaseUrl.startsWith("sqlite:")) return databaseUrl;
    const u = new URL(databaseUrl);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return databaseUrl.replace(/:([^:@/]+)@/, ":***@");
  }
}

/**
 * Load bootstrap config.
 * Precedence: env > host.json > defaults.
 */
export async function loadBootstrapConfig(): Promise<BootstrapConfig> {
  const dataDirFromEnv = env("DATA_DIR");
  const provisionalDataDir = resolve(dataDirFromEnv ?? "./data");
  const hostFile = await readHostBootstrap(provisionalDataDir);

  const dataDir = resolve(
    dataDirFromEnv ?? hostFile.dataDir ?? "./data",
  );
  // Re-read if dataDir differed from provisional (rare: host.json points elsewhere)
  const file = dataDir === provisionalDataDir
    ? hostFile
    : await readHostBootstrap(dataDir);

  const defaultDbPath = join(dataDir, "mcp-hoster.db");
  const databaseUrl = env("DATABASE_URL") ??
    file.databaseUrl ??
    `sqlite://${defaultDbPath}`;

  const engine = isPostgresUrl(databaseUrl) ? "postgres" : "sqlite";
  const sqlitePath = engine === "sqlite"
    ? sqlitePathFromUrl(databaseUrl, dataDir)
    : "";

  // Optional demo servers seed. Unset SEED_PATH (or set empty) to skip.
  const seedPathRaw = Deno.env.get("SEED_PATH");
  const seedPath = seedPathRaw === undefined
    ? "./seed.example.json"
    : (seedPathRaw.trim() || null);
  // Library catalog: GitHub by default; override with a local path or other URL.
  const librarySeedRaw = Deno.env.get("LIBRARY_SEED_PATH");
  const librarySeedPath = librarySeedRaw === undefined
    ? DEFAULT_LIBRARY_CATALOG_URL
    : (librarySeedRaw.trim() || null);

  const gatewayFromEnv = env("GATEWAY_PUBLIC_URL")?.trim();
  const gatewayPublicUrl = normalizeGatewayUrl(
    gatewayFromEnv || file.gatewayPublicUrl || null,
  );

  const authDisabled = Deno.env.get("AUTH_DISABLED") !== undefined
    ? envFlag("AUTH_DISABLED", false)
    : (file.authDisabled ?? false);
  const authAllowOpen = Deno.env.get("AUTH_ALLOW_OPEN") !== undefined
    ? envFlag("AUTH_ALLOW_OPEN", false)
    : (file.authAllowOpen ?? false);

  const bind = env("HOST_BIND") ?? file.bind ?? "0.0.0.0";
  const port = Number(env("HOST_PORT") ?? file.port ?? 8080);

  const publicFromEnv = env("HOST_PUBLIC_URL")?.replace(/\/$/, "");
  const publicUrl = publicFromEnv ||
    (file.publicUrl ? file.publicUrl.replace(/\/$/, "") : null) ||
    null;

  return {
    bind,
    port,
    gatewayPublicUrl,
    dataDir,
    databaseUrl,
    sqlitePath,
    engine,
    seedPath,
    librarySeedPath,
    migrationsDir: resolve(env("MIGRATIONS_DIR", "./migrations")!),
    logsDir: join(dataDir, "logs"),
    serversDir: join(dataDir, "servers"),
    workspacesDir: join(dataDir, "workspaces"),
    authDisabled,
    authAllowOpen,
    bootstrapAdminEmail: env("BOOTSTRAP_ADMIN_EMAIL")?.trim() || null,
    bootstrapAdminPassword: env("BOOTSTRAP_ADMIN_PASSWORD") || null,
    bootstrapAdminDisplayName: env("BOOTSTRAP_ADMIN_DISPLAY_NAME")?.trim() || null,
    publicUrl,
    hostBootstrapPath: hostBootstrapPath(dataDir),
    hostFile: file,
  };
}

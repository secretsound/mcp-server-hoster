import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { BootstrapConfig } from "./config.ts";
import type { ServerRecord } from "./db/types.ts";

export type PreparedSandbox = {
  workDir: string;
  cwd: string;
  env: Record<string, string>;
  logPath: string;
};

async function run(cmd: string[], cwd?: string): Promise<void> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const err = new TextDecoder().decode(result.stderr);
    throw new Error(`Command failed (${cmd.join(" ")}): ${err}`);
  }
}

export async function prepareSandbox(
  config: BootstrapConfig,
  server: ServerRecord,
): Promise<PreparedSandbox> {
  const workDir = join(config.serversDir, server.id);
  await ensureDir(workDir);
  await ensureDir(config.logsDir);
  await ensureDir(config.workspacesDir);

  let cwd = workDir;

  if (server.source?.git) {
    const checkout = join(workDir, "repo");
    try {
      await Deno.stat(join(checkout, ".git"));
      await run(["git", "fetch", "--all"], checkout);
      if (server.source.ref) {
        await run(["git", "checkout", server.source.ref], checkout);
        await run(["git", "pull", "--ff-only"], checkout).catch(() => {});
      }
    } catch {
      await run([
        "git",
        "clone",
        ...(server.source.ref ? ["--branch", server.source.ref] : []),
        "--depth",
        "1",
        server.source.git,
        checkout,
      ]);
    }
    cwd = server.cwd ? join(checkout, server.cwd) : checkout;
  } else if (server.cwd) {
    cwd = server.cwd.startsWith("/") ? server.cwd : join(workDir, server.cwd);
  }

  await ensureDir(cwd);

  // Shared package caches under DATA_DIR so uvx/npx cold starts are not
  // re-downloaded per server (HOME is still per-server for isolation).
  const cacheRoot = join(config.dataDir, "cache");
  const shareRoot = join(config.dataDir, "share");
  const uvCache = Deno.env.get("UV_CACHE_DIR")?.trim() || join(cacheRoot, "uv");
  const npmCache = Deno.env.get("npm_config_cache")?.trim() ||
    Deno.env.get("NPM_CONFIG_CACHE")?.trim() ||
    join(cacheRoot, "npm");
  const uvPython = Deno.env.get("UV_PYTHON_INSTALL_DIR")?.trim() ||
    join(shareRoot, "uv", "python");

  await ensureDir(join(workDir, "tmp"));
  await ensureDir(uvCache);
  await ensureDir(npmCache);
  await ensureDir(uvPython);

  const baseEnv: Record<string, string> = {
    HOME: workDir,
    TMPDIR: join(workDir, "tmp"),
    PATH: Deno.env.get("PATH") ?? "/usr/local/bin:/usr/bin:/bin",
    XDG_CACHE_HOME: cacheRoot,
    XDG_DATA_HOME: shareRoot,
    UV_CACHE_DIR: uvCache,
    UV_PYTHON_INSTALL_DIR: uvPython,
    npm_config_cache: npmCache,
    NPM_CONFIG_CACHE: npmCache,
  };

  return {
    workDir,
    cwd,
    env: { ...baseEnv, ...server.env },
    logPath: join(config.logsDir, `${server.id}.log`),
  };
}

type LogAppendListener = (logPath: string, chunk: string) => void;
const logAppendListeners = new Set<LogAppendListener>();

/** Subscribe to process log appends (used by admin SSE). */
export function onLogAppend(fn: LogAppendListener): () => void {
  logAppendListeners.add(fn);
  return () => {
    logAppendListeners.delete(fn);
  };
}

export async function appendLog(logPath: string, chunk: string): Promise<void> {
  await Deno.writeTextFile(logPath, chunk, { append: true, create: true });
  for (const fn of logAppendListeners) {
    try {
      fn(logPath, chunk);
    } catch (err) {
      console.error("[sandbox] log listener error:", err);
    }
  }
}

export async function readLogTail(logPath: string, lines = 200): Promise<string> {
  try {
    const text = await Deno.readTextFile(logPath);
    const parts = text.split("\n");
    return parts.slice(Math.max(0, parts.length - lines)).join("\n");
  } catch {
    return "";
  }
}

/** Drop npx/uv caches under a server sandbox so the next start pulls fresh packages. */
export async function clearPackageCaches(workDir: string): Promise<void> {
  for (const rel of [".npm", ".cache", "tmp", ".local"]) {
    try {
      await Deno.remove(join(workDir, rel), { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        console.error(`[sandbox] clear cache ${rel}:`, err);
      }
    }
  }
}

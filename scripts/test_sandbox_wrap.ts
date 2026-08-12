/**
 * Unit tests for sandbox command wrapping and auth fail-closed bootstrap.
 */
import { join } from "@std/path";
import { openDatabase } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { AuthRepository } from "../src/db/repos/auth.ts";
import { AuthService } from "../src/auth/service.ts";
import {
  sandboxRwRoots,
  wrapSandboxCommand,
} from "../src/sandbox_wrap.ts";
import { prepareSandbox } from "../src/sandbox.ts";
import type { PreparedSandbox } from "../src/sandbox.ts";
import type { BootstrapConfig } from "../src/config.ts";
import type { ServerRecord } from "../src/db/types.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sandbox: PreparedSandbox = {
  workDir: "/data/servers/demo",
  cwd: "/data/servers/demo/repo",
  env: {
    HOME: "/data/servers/demo",
    TMPDIR: "/data/servers/demo/tmp",
    PATH: "/usr/bin",
    UV_CACHE_DIR: "/data/servers/demo/.cache/uv",
    npm_config_cache: "/data/servers/demo/.cache/npm",
  },
  logPath: "/data/logs/demo.log",
};

const rw = sandboxRwRoots(sandbox);
assert(rw.length === 1 && rw[0] === "/data/servers/demo", "rw is only workDir");
assert(!rw.some((p) => p.includes("/logs")), "logs not writable by child");

const none = await wrapSandboxCommand(
  { mode: "none", network: "share" },
  sandbox,
  "npx",
  ["-y", "foo"],
);
assert(none.command === "npx", "none keeps command");
assert(none.args.join(" ") === "-y foo", "none keeps args");

const landlock = await wrapSandboxCommand(
  { mode: "landlock", network: "share" },
  sandbox,
  "uvx",
  ["mcp-server-time"],
);
assert(landlock.command === "python3", "landlock uses python3");
assert(landlock.args.includes("--rw"), "landlock rw binds");
assert(landlock.args.includes("--"), "landlock separator");
const sep = landlock.args.indexOf("--");
assert(
  landlock.args.slice(sep + 1).join(" ") === "uvx mcp-server-time",
  "landlock target",
);
const rwIdx = landlock.args.indexOf("--rw");
assert(landlock.args[rwIdx + 1] === "/data/servers/demo", "landlock rw=workDir");
assert(
  !landlock.args.includes("/data/logs"),
  "landlock must not rw shared logs",
);

const bwrap = await wrapSandboxCommand(
  { mode: "bwrap", network: "share" },
  sandbox,
  "npx",
  ["-y", "bar"],
);
assert(bwrap.command === "bwrap", "bwrap command");
assert(bwrap.args.includes("--die-with-parent"), "bwrap die-with-parent");
assert(bwrap.args.includes("--unshare-pid"), "bwrap unshare-pid");
assert(bwrap.args.includes("--unshare-ipc"), "bwrap unshare-ipc");
assert(!bwrap.args.includes("--unshare-net"), "shared net by default");
const bsep = bwrap.args.indexOf("--");
assert(bwrap.args.slice(bsep + 1).join(" ") === "npx -y bar", "bwrap target");

const isolated = await wrapSandboxCommand(
  { mode: "bwrap", network: "none" },
  sandbox,
  "npx",
  ["-y", "bar"],
);
assert(isolated.args.includes("--unshare-net"), "network none adds unshare-net");

const tmp = await Deno.makeTempDir({ prefix: "mcp-sandbox-iso-" });
const prepared = await prepareSandbox(
  {
    dataDir: tmp,
    serversDir: join(tmp, "servers"),
    workspacesDir: join(tmp, "workspaces"),
    logsDir: join(tmp, "logs"),
  } as BootstrapConfig,
  {
    id: "mealie",
    command: "uvx",
    args: ["mcp-mealie"],
    env: {},
    source: null,
    cwd: null,
  } as unknown as ServerRecord,
);
assert(prepared.env.HOME === prepared.workDir, "HOME is workDir");
assert(
  prepared.env.UV_CACHE_DIR?.startsWith(prepared.workDir),
  "UV cache is per-server",
);
assert(
  prepared.env.npm_config_cache?.startsWith(prepared.workDir),
  "npm cache is per-server",
);
assert(
  !prepared.env.UV_CACHE_DIR?.includes(`${tmp}/cache/`),
  "no shared dataDir cache for children",
);

const dbPath = join(tmp, "test.db");
const db = await openDatabase(`sqlite://${dbPath}`, dbPath);
await migrate(db, join(Deno.cwd(), "migrations"));
const repo = new AuthRepository(db);
const auth = new AuthService(repo, {
  disabled: false,
  allowOpen: false,
  bootstrapEmail: null,
  bootstrapPassword: null,
  bootstrapDisplayName: null,
  publicUrl: null,
});

let failed = false;
try {
  await auth.bootstrap();
} catch (err) {
  failed = err instanceof Error &&
    err.message.includes("Refusing to start with an open auth surface");
}
assert(failed, "fail-closed without bootstrap/open");

const openAuth = new AuthService(repo, {
  disabled: false,
  allowOpen: true,
  bootstrapEmail: null,
  bootstrapPassword: null,
  bootstrapDisplayName: null,
  publicUrl: null,
});
await openAuth.bootstrap();
assert(!await openAuth.isRequired(), "allowOpen keeps auth optional");

console.log("sandbox wrap + isolation + auth fail-closed ok");
await db.close();

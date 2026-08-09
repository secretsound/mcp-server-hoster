/**
 * Unit tests for sandbox command wrapping and auth fail-closed bootstrap.
 */
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { openDatabase } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { AuthRepository } from "../src/db/repos/auth.ts";
import { AuthService } from "../src/auth/service.ts";
import { wrapSandboxCommand } from "../src/sandbox_wrap.ts";
import type { PreparedSandbox } from "../src/sandbox.ts";

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
  },
  logPath: "/data/logs/demo.log",
};

const none = await wrapSandboxCommand({ mode: "none" }, sandbox, "npx", ["-y", "foo"]);
assert(none.command === "npx", "none keeps command");
assert(none.args.join(" ") === "-y foo", "none keeps args");

const landlock = await wrapSandboxCommand(
  { mode: "landlock" },
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

const bwrap = await wrapSandboxCommand(
  { mode: "bwrap" },
  sandbox,
  "npx",
  ["-y", "bar"],
);
assert(bwrap.command === "bwrap", "bwrap command");
assert(bwrap.args.includes("--die-with-parent"), "bwrap die-with-parent");
const bsep = bwrap.args.indexOf("--");
assert(bwrap.args.slice(bsep + 1).join(" ") === "npx -y bar", "bwrap target");

const tmp = await Deno.makeTempDir({ prefix: "mcp-auth-closed-" });
await ensureDir(tmp);
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

console.log("sandbox wrap + auth fail-closed ok");
await db.close();

import { dirname, fromFileUrl, join } from "@std/path";
import type { PreparedSandbox } from "./sandbox.ts";

export type SandboxModeName = "bwrap" | "landlock" | "none";
export type SandboxModeRequest = "auto" | "bwrap" | "landlock" | "none";
/** share = normal egress (default). none = bwrap --unshare-net (no network). */
export type SandboxNetworkMode = "share" | "none";

/** Persisted under Settings (`host.sandbox_mode`). */
export const SANDBOX_MODE_SETTING_KEY = "host.sandbox_mode";
/** Persisted under Settings (`host.sandbox_network`). */
export const SANDBOX_NETWORK_SETTING_KEY = "host.sandbox_network";

export type SandboxRuntime = {
  mode: SandboxModeName;
  detail?: string;
  network: SandboxNetworkMode;
};

export function parseSandboxMode(raw: string | null | undefined): SandboxModeRequest {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (value === "auto" || value === "bwrap" || value === "landlock" || value === "none") {
    return value;
  }
  return "auto";
}

export function parseSandboxNetwork(
  raw: string | null | undefined,
): SandboxNetworkMode {
  const value = (raw ?? "share").trim().toLowerCase();
  return value === "none" ? "none" : "share";
}

/** Mutable sandbox policy loaded from DB; new process starts pick up changes. */
export class SandboxController {
  private requested: SandboxModeRequest = "auto";
  private network: SandboxNetworkMode = "share";
  private runtime: SandboxRuntime = {
    mode: "none",
    network: "share",
    detail: "not initialized",
  };

  getRequested(): SandboxModeRequest {
    return this.requested;
  }

  getNetwork(): SandboxNetworkMode {
    return this.network;
  }

  getRuntime(): SandboxRuntime {
    return this.runtime;
  }

  async apply(
    requested: SandboxModeRequest,
    network: SandboxNetworkMode = "share",
  ): Promise<SandboxRuntime> {
    this.requested = requested;
    this.network = network;
    const resolved = await resolveSandboxRuntime(requested);
    let detail = resolved.detail;
    if (network === "none" && resolved.mode !== "bwrap") {
      detail = `${detail ?? resolved.mode}; network isolation requested but only available with bwrap (active=${resolved.mode})`;
    } else if (network === "none" && resolved.mode === "bwrap") {
      detail = `${detail ?? "bwrap"}; network namespace isolated (--unshare-net)`;
    }
    this.runtime = { ...resolved, network, detail };
    return this.runtime;
  }
}

export type WrappedCommand = {
  command: string;
  args: string[];
};

const RO_BINDS = [
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/sbin",
  "/proc",
  // Host identity / TLS / DNS — landlock path-beneath needs directories.
  "/etc",
];

/** Device nodes (/dev/null, etc.) need write+ioctl; RO /dev breaks shell redirects. */
const DEV_BINDS = ["/dev"];

function landlockCandidates(): string[] {
  return [
    join(Deno.cwd(), "scripts", "landlock_exec.py"),
    "/app/scripts/landlock_exec.py",
    join(dirname(fromFileUrl(import.meta.url)), "..", "scripts", "landlock_exec.py"),
  ];
}

async function findLandlockScript(): Promise<string | null> {
  for (const path of landlockCandidates()) {
    try {
      await Deno.stat(path);
      return path;
    } catch {
      // try next
    }
  }
  return null;
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    const result = await new Deno.Command("sh", {
      args: ["-c", `command -v ${bin}`],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  } catch {
    return false;
  }
}

function decodeStderr(result: Deno.CommandOutput): string {
  const text = new TextDecoder().decode(result.stderr).trim();
  return text.replace(/\s+/g, " ").slice(0, 240);
}

async function probeBwrap(): Promise<{ ok: boolean; detail: string }> {
  if (!await commandExists("bwrap")) {
    return { ok: false, detail: "bubblewrap binary not installed in PATH" };
  }
  try {
    const result = await new Deno.Command("bwrap", {
      args: [
        "--ro-bind-try",
        "/usr",
        "/usr",
        "--ro-bind-try",
        "/bin",
        "/bin",
        "--ro-bind-try",
        "/lib",
        "/lib",
        "--ro-bind-try",
        "/lib64",
        "/lib64",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--die-with-parent",
        "--",
        "/bin/true",
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (result.success) {
      return { ok: true, detail: "bubblewrap mount/pid namespace isolation" };
    }
    const err = decodeStderr(result) || `exit ${result.code}`;
    return {
      ok: false,
      detail:
        `bwrap probe failed (${err}). Nested user namespaces are often blocked in Docker/K8s`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: `bwrap probe error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function probeLandlock(): Promise<{ ok: boolean; detail: string }> {
  if (!await commandExists("python3")) {
    return { ok: false, detail: "python3 not installed (needed for Landlock helper)" };
  }
  const script = await findLandlockScript();
  if (!script) {
    return {
      ok: false,
      detail: "landlock_exec.py not found (expected under ./scripts or /app/scripts)",
    };
  }
  try {
    const tmp = await Deno.makeTempDir({ prefix: "mcp-ll-probe-" });
    try {
      const result = await new Deno.Command("python3", {
        args: [
          script,
          "--ro",
          "/usr",
          "--ro",
          "/bin",
          "--ro",
          "/lib",
          "--ro",
          "/lib64",
          "--rw",
          tmp,
          "--",
          "/bin/true",
        ],
        stdout: "null",
        stderr: "piped",
      }).output();
      if (result.success) {
        return { ok: true, detail: "Linux Landlock filesystem restrictions" };
      }
      const err = decodeStderr(result) || `exit ${result.code}`;
      return {
        ok: false,
        detail:
          `landlock probe failed (${err}). Needs Linux 5.13+ and a seccomp profile that allows Landlock (compose sets seccomp:unconfined)`,
      };
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  } catch (err) {
    return {
      ok: false,
      detail: `landlock probe error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Resolve the effective sandbox backend for this host. */
export async function resolveSandboxRuntime(
  requested: SandboxModeRequest,
): Promise<Omit<SandboxRuntime, "network">> {
  if (requested === "none") {
    return { mode: "none", detail: "sandbox mode set to none" };
  }

  if (requested === "bwrap") {
    const probe = await probeBwrap();
    return probe.ok
      ? { mode: "bwrap", detail: probe.detail }
      : { mode: "none", detail: probe.detail };
  }

  if (requested === "landlock") {
    const probe = await probeLandlock();
    return probe.ok
      ? { mode: "landlock", detail: probe.detail }
      : { mode: "none", detail: probe.detail };
  }

  // auto: prefer Landlock (works in Docker without user namespaces), then bwrap.
  const landlock = await probeLandlock();
  if (landlock.ok) {
    return { mode: "landlock", detail: landlock.detail };
  }
  const bwrap = await probeBwrap();
  if (bwrap.ok) {
    return { mode: "bwrap", detail: bwrap.detail };
  }

  return {
    mode: "none",
    detail: `no sandbox backend available — landlock: ${landlock.detail}; bwrap: ${bwrap.detail}`,
  };
}

function uniqueExisting(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Writable roots for a child — only its own server tree (no shared caches/logs). */
export function sandboxRwRoots(sandbox: PreparedSandbox): string[] {
  const roots = [sandbox.workDir];
  // cwd should be under workDir; if an operator set an absolute outside path, allow only that.
  if (
    sandbox.cwd &&
    sandbox.cwd !== sandbox.workDir &&
    !(
      sandbox.cwd === sandbox.workDir ||
      sandbox.cwd.startsWith(`${sandbox.workDir}/`)
    )
  ) {
    roots.push(sandbox.cwd);
  }
  return uniqueExisting(roots);
}

/**
 * Resolve `command` to a real filesystem path (follows symlinks).
 * Needed so Landlock/bwrap can RO-bind host tool installs outside /usr
 * (e.g. /usr/local/bin/uvx → /root/.local/bin/uvx).
 */
export async function resolveExecutable(
  command: string,
  pathEnv: string,
): Promise<string | null> {
  const tryPath = async (candidate: string): Promise<string | null> => {
    try {
      const st = await Deno.stat(candidate);
      if (!st.isFile) return null;
      return await Deno.realPath(candidate);
    } catch {
      return null;
    }
  };

  if (command.includes("/")) {
    return await tryPath(command);
  }

  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const hit = await tryPath(join(dir, command));
    if (hit) return hit;
  }
  return null;
}

/** Extra RO roots so symlink targets for host launchers remain executable. */
async function hostLauncherRoPaths(
  command: string,
  pathEnv: string,
): Promise<{ command: string; roPaths: string[] }> {
  const resolved = await resolveExecutable(command, pathEnv);
  if (!resolved) return { command, roPaths: [] };

  const paths = [dirname(resolved)];
  // uv / cargo / npm user installs: bind the prefix (…/.local), not only …/bin.
  if (paths[0].endsWith("/bin")) {
    paths.push(dirname(paths[0]));
  }
  return { command: resolved, roPaths: paths };
}

/** Build argv to launch `command`+`args` under the active sandbox. */
export async function wrapSandboxCommand(
  runtime: SandboxRuntime,
  sandbox: PreparedSandbox,
  command: string,
  args: string[],
): Promise<WrappedCommand> {
  if (runtime.mode === "none") {
    return { command, args };
  }

  const pathEnv = sandbox.env.PATH ?? Deno.env.get("PATH") ??
    "/usr/local/bin:/usr/bin:/bin";
  const launcher = await hostLauncherRoPaths(command, pathEnv);
  const effectiveCommand = launcher.command;
  const rwPaths = sandboxRwRoots(sandbox);

  const roPaths = uniqueExisting([
    ...RO_BINDS,
    // Node / uv install prefixes commonly live here.
    "/usr/local",
    ...launcher.roPaths,
  ]);

  if (runtime.mode === "landlock") {
    const script = (await findLandlockScript()) ?? landlockCandidates()[0]!;
    const llArgs = [
      script,
      ...roPaths.flatMap((p) => ["--ro", p]),
      ...rwPaths.flatMap((p) => ["--rw", p]),
      ...DEV_BINDS.flatMap((p) => ["--rw", p]),
      "--",
      effectiveCommand,
      ...args,
    ];
    return { command: "python3", args: llArgs };
  }

  // bwrap — stronger isolation: own PID/IPC; optional network namespace.
  const bwrapArgs: string[] = [
    "--unshare-pid",
    "--unshare-ipc",
    "--die-with-parent",
    "--new-session",
  ];
  if (runtime.network === "none") {
    bwrapArgs.push("--unshare-net");
  }
  for (const p of roPaths) {
    bwrapArgs.push("--ro-bind-try", p, p);
  }
  for (const p of rwPaths) {
    bwrapArgs.push("--bind", p, p);
  }
  bwrapArgs.push(
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--chdir",
    sandbox.cwd,
    "--clearenv",
  );
  for (const [key, value] of Object.entries(sandbox.env)) {
    bwrapArgs.push("--setenv", key, value);
  }
  bwrapArgs.push("--", effectiveCommand, ...args);
  return { command: "bwrap", args: bwrapArgs };
}

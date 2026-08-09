import { dirname, join } from "@std/path";
import type { PreparedSandbox } from "./sandbox.ts";

export type SandboxModeName = "bwrap" | "landlock" | "none";
export type SandboxModeRequest = "auto" | "bwrap" | "landlock" | "none";

/** Persisted under Settings (`host.sandbox_mode`). */
export const SANDBOX_MODE_SETTING_KEY = "host.sandbox_mode";

export type SandboxRuntime = {
  mode: SandboxModeName;
  detail?: string;
};

export function parseSandboxMode(raw: string | null | undefined): SandboxModeRequest {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (value === "auto" || value === "bwrap" || value === "landlock" || value === "none") {
    return value;
  }
  return "auto";
}

/** Mutable sandbox policy loaded from DB; new process starts pick up changes. */
export class SandboxController {
  private requested: SandboxModeRequest = "auto";
  private runtime: SandboxRuntime = {
    mode: "none",
    detail: "not initialized",
  };

  getRequested(): SandboxModeRequest {
    return this.requested;
  }

  getRuntime(): SandboxRuntime {
    return this.runtime;
  }

  async apply(requested: SandboxModeRequest): Promise<SandboxRuntime> {
    this.requested = requested;
    this.runtime = await resolveSandboxRuntime(requested);
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
  "/dev",
  "/proc",
  // Host identity / TLS / DNS — landlock path-beneath needs directories.
  "/etc",
];

function landlockScriptPath(): string {
  return join(Deno.cwd(), "scripts", "landlock_exec.py");
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

async function probeBwrap(): Promise<boolean> {
  if (!await commandExists("bwrap")) return false;
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
    return result.success;
  } catch {
    return false;
  }
}

async function probeLandlock(): Promise<boolean> {
  if (!await commandExists("python3")) return false;
  const script = landlockScriptPath();
  try {
    await Deno.stat(script);
  } catch {
    return false;
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
      return result.success;
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  } catch {
    return false;
  }
}

/** Resolve the effective sandbox backend for this host. */
export async function resolveSandboxRuntime(
  requested: SandboxModeRequest,
): Promise<SandboxRuntime> {
  if (requested === "none") {
    return { mode: "none", detail: "sandbox mode set to none" };
  }

  if (requested === "bwrap" || requested === "auto") {
    if (await probeBwrap()) {
      return {
        mode: "bwrap",
        detail: "bubblewrap mount/pid namespace isolation",
      };
    }
    if (requested === "bwrap") {
      return {
        mode: "none",
        detail:
          "sandbox mode bwrap selected but bubblewrap probe failed (user namespaces blocked?)",
      };
    }
  }

  if (requested === "landlock" || requested === "auto") {
    if (await probeLandlock()) {
      return {
        mode: "landlock",
        detail: "Linux Landlock filesystem restrictions",
      };
    }
    if (requested === "landlock") {
      return {
        mode: "none",
        detail: "sandbox mode landlock selected but Landlock probe failed",
      };
    }
  }

  return {
    mode: "none",
    detail:
      "no sandbox backend available (install bubblewrap or enable Landlock); MCP children share the host filesystem view",
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

  const rwPaths = uniqueExisting([
    sandbox.workDir,
    sandbox.cwd,
    sandbox.env.TMPDIR,
    // Allow writing the per-server log file directory.
    sandbox.logPath.includes("/")
      ? sandbox.logPath.slice(0, sandbox.logPath.lastIndexOf("/"))
      : "",
  ].filter(Boolean));

  const roPaths = uniqueExisting([
    ...RO_BINDS,
    // Node / uv install prefixes commonly live here.
    "/usr/local",
    ...launcher.roPaths,
  ]);

  if (runtime.mode === "landlock") {
    const llArgs = [
      landlockScriptPath(),
      ...roPaths.flatMap((p) => ["--ro", p]),
      ...rwPaths.flatMap((p) => ["--rw", p]),
      "--",
      effectiveCommand,
      ...args,
    ];
    return { command: "python3", args: llArgs };
  }

  // bwrap
  const bwrapArgs: string[] = [];
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
    "--die-with-parent",
    "--clearenv",
  );
  for (const [key, value] of Object.entries(sandbox.env)) {
    bwrapArgs.push("--setenv", key, value);
  }
  bwrapArgs.push("--", effectiveCommand, ...args);
  return { command: "bwrap", args: bwrapArgs };
}

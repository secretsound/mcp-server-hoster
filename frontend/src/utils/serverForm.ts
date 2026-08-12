import type {
  CreateServerInput,
  EnvPair,
  Launcher,
  LibraryItem,
  ServerFormValues,
  ServerWithRuntime,
  UpdateServerInput,
} from "../types";
import { i18n } from "../i18n";
import {
  buildUvxArgs,
  formatNpmSpec,
  formatUvxSpec,
  parseNpmSpec,
  parseUvxSpec,
  shellQuoteArg,
  splitUvxInvocation,
} from "./packageSpec";

function t(key: string, named?: Record<string, unknown>): string {
  return String(i18n.global.t(key, named ?? {}));
}

export function shellSplit(input: unknown): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(input || "").trim())) !== null) {
    out.push(m[1] ?? m[2] ?? m[0]);
  }
  return out;
}

export function envFromRecord(env: Record<string, string> | undefined): EnvPair[] {
  const entries = Object.entries(env || {});
  if (!entries.length) return [{ key: "", value: "" }];
  return entries.map(([key, value]) => ({ key, value }));
}

export function envToRecord(pairs: EnvPair[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const p of pairs) {
    const key = p.key.trim();
    if (key) env[key] = p.value ?? "";
  }
  return env;
}

export function detectLauncher(server: ServerWithRuntime): {
  launcher: Launcher;
  package: string;
  packageVersion: string;
  extraArgs: string;
  argsLines: string;
  command: string;
} {
  if (server.command === "npx" && server.args?.[0] === "-y" && server.args[1]) {
    const parsed = parseNpmSpec(server.args[1]);
    return {
      launcher: "npx",
      package: server.packageName || parsed.name || server.args[1],
      packageVersion: server.packageVersion ?? parsed.version ?? "",
      extraArgs: server.args
        .slice(2)
        .map((a) => (String(a).includes(" ") ? JSON.stringify(a) : a))
        .join(" "),
      argsLines: "",
      command: "npx",
    };
  }
  if (server.command === "uvx") {
    const { options, packageSpec, toolArgs } = splitUvxInvocation(
      server.args || [],
    );
    if (packageSpec && !packageSpec.includes("://")) {
      const parsed = parseUvxSpec(packageSpec);
      return {
        launcher: "uvx",
        package: server.packageName || parsed.name || packageSpec,
        packageVersion: server.packageVersion ?? parsed.version ?? "",
        extraArgs: [...options, ...toolArgs].map(shellQuoteArg).join(" "),
        argsLines: "",
        command: "uvx",
      };
    }
  }
  return {
    launcher: "custom",
    package: "",
    packageVersion: server.packageVersion ?? "",
    extraArgs: "",
    argsLines: (server.args || []).join("\n"),
    command: server.command,
  };
}

export function valuesFromServer(server: ServerWithRuntime): ServerFormValues {
  const detected = detectLauncher(server);
  return {
    id: server.id,
    name: server.name || server.id,
    launcher: detected.launcher,
    package: detected.package,
    packageVersion: detected.packageVersion,
    command: detected.command,
    extraArgs: detected.extraArgs,
    argsLines: detected.argsLines,
    env: envFromRecord(server.env),
    git: server.source?.git || "",
    ref: server.source?.ref || "",
    startNow: server.enabled !== false,
  };
}

function resolveCommandArgs(values: ServerFormValues): {
  command: string;
  args: string[];
  packageName: string | null;
  packageVersion: string | null;
} {
  const launcher = values.launcher;
  const pin = (values.packageVersion || "").trim() || null;
  if (launcher === "npx") {
    const pkgName = (values.package || "").trim();
    if (!pkgName) throw new Error(t("serverForm.packageRequiredNpx"));
    // Allow pasting a full @scope/name@version into the package field.
    const parsed = parseNpmSpec(pkgName);
    const name = parsed.name || pkgName;
    const version = pin ?? parsed.version;
    return {
      command: "npx",
      args: ["-y", formatNpmSpec(name, version), ...shellSplit(values.extraArgs)],
      packageName: name,
      packageVersion: version,
    };
  }
  if (launcher === "uvx") {
    const pkg = (values.package || "").trim();
    const extra = shellSplit(values.extraArgs);
    if (!pkg) {
      throw new Error(t("serverForm.packageRequiredUvx"));
    }
    if (pkg.startsWith("@") && pkg.includes("/")) {
      throw new Error(t("serverForm.looksLikeNpm"));
    }
    const parsed = parseUvxSpec(pkg);
    const name = parsed.name || pkg;
    const version = pin ?? parsed.version;
    return {
      command: "uvx",
      args: buildUvxArgs(formatUvxSpec(name, version), extra),
      packageName: name.includes("://") ? null : name,
      packageVersion: version,
    };
  }
  const command = (values.command || "").trim();
  if (!command) throw new Error(t("serverForm.commandRequired"));
  const lines = String(values.argsLines || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    command,
    args: lines.length ? lines : shellSplit(values.extraArgs),
    packageName: null,
    packageVersion: pin,
  };
}

const PLACEHOLDER_ENV =
  /your-|example\.|changeme|todo|xxx|replace.?me|<.*>|\[.*\]|YOUR_[A-Z0-9_]+/i;

export function isPlaceholderEnvValue(value: string | undefined): boolean {
  const v = (value || "").trim();
  return !v || PLACEHOLDER_ENV.test(v);
}

/** Whether this env pair must be filled before starting (explicit flag or heuristic). */
export function isEnvPairRequired(pair: EnvPair): boolean {
  if (!pair.key.trim()) return false;
  if (typeof pair.required === "boolean") return pair.required;
  return isPlaceholderEnvValue(pair.value);
}

/** Env keys that look required (empty, placeholder, or marked required) from a preset. */
export function requiredEnvKeysFromPairs(
  pairs: EnvPair[] | undefined,
): string[] {
  return (pairs || [])
    .filter((e) => isEnvPairRequired(e))
    .map((e) => e.key.trim());
}

export function optionalEnvKeysFromPairs(
  pairs: EnvPair[] | undefined,
): string[] {
  return (pairs || [])
    .filter((e) => e.key.trim() && !isEnvPairRequired(e))
    .map((e) => e.key.trim());
}

export function isOfficialLibraryItem(tags: string[] | undefined): boolean {
  return (tags || []).some((t) => t.toLowerCase() === "official");
}

/** Third-party / cloud backend that needs outbound internet by default. */
export function isOnlineLibraryItem(tags: string[] | undefined): boolean {
  return (tags || []).some((t) => {
    const lower = t.toLowerCase();
    return lower === "online" || lower === "cloud";
  });
}

/** Tags for display excluding ones already shown as dedicated badges. */
export function displayLibraryTags(tags: string[] | undefined): string[] {
  return (tags || []).filter((t) => {
    const lower = t.toLowerCase();
    return (
      lower !== "self-hosted" &&
      lower !== "official" &&
      lower !== "online" &&
      lower !== "cloud" &&
      lower !== "local"
    );
  });
}

export function assertEnvReadyForStart(
  env: Record<string, string>,
  requiredKeys: string[],
): void {
  for (const key of requiredKeys) {
    const v = (env[key] || "").trim();
    if (!v) throw new Error(t("serverForm.setKeyBeforeStart", { key }));
    if (isPlaceholderEnvValue(v)) {
      throw new Error(t("serverForm.replacePlaceholder", { key }));
    }
  }
}

export function buildCreatePayload(values: ServerFormValues): CreateServerInput {
  const { command, args, packageName, packageVersion } = resolveCommandArgs(
    values,
  );
  const env = envToRecord(values.env);
  const startNow = values.startNow !== false;
  if (startNow) {
    const required = requiredEnvKeysFromPairs(values.env);
    assertEnvReadyForStart(env, required);
  }
  const git = values.git.trim();
  return {
    id: values.id.trim(),
    name: (values.name || values.id).trim(),
    command,
    args,
    env,
    enabled: startNow,
    packageName,
    packageVersion,
    source: git
      ? { git, ref: values.ref.trim() || undefined }
      : null,
  };
}

export function buildUpdatePayload(values: ServerFormValues): UpdateServerInput {
  const { command, args, packageName, packageVersion } = resolveCommandArgs(
    values,
  );
  const git = values.git.trim();
  return {
    name: (values.name || values.id).trim(),
    command,
    args,
    env: envToRecord(values.env),
    enabled: values.startNow !== false,
    packageName,
    packageVersion,
    source: git
      ? { git, ref: values.ref.trim() || undefined }
      : null,
  };
}

export function statusOf(s: ServerWithRuntime): string {
  return s.runtime?.lastStatus || "stopped";
}

export function isActiveStatus(st: string): boolean {
  return st === "running" || st === "starting" || st === "restarting";
}

/** Terminal failure (start failed or restart storm), not a transient restart. */
export function isCrashedStatus(st: string): boolean {
  return st === "error";
}

export function statusLabel(st: string): string {
  switch (st) {
    case "running":
      return t("status.running");
    case "stopped":
      return t("status.stopped");
    case "starting":
      return t("status.starting");
    case "restarting":
      return t("status.restarting");
    case "error":
      return t("status.error");
    default:
      return st;
  }
}

/** Show a loud error banner only for terminal crashes. */
export function showCrashBanner(
  st: string,
  lastError: string | null | undefined,
): boolean {
  return isCrashedStatus(st) && !!lastError?.trim();
}

export function cmdOf(s: ServerWithRuntime): string {
  return [s.command, ...(s.args || [])].join(" ");
}

export function serverGatewayUrl(gatewayUrl: string, id: string): string {
  const base = gatewayUrl.endsWith("/") ? gatewayUrl.slice(0, -1) : gatewayUrl;
  return `${base}/${encodeURIComponent(id)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Default server id from a library template. */
export function libraryBaseId(item: LibraryItem): string {
  return (item.preset?.id || item.id || "").trim();
}

/**
 * Servers that look like instances of a library app: same id, id-N suffix,
 * or same package name as the preset.
 */
export function libraryInstances(
  item: LibraryItem,
  servers: ServerWithRuntime[],
): ServerWithRuntime[] {
  const base = libraryBaseId(item);
  const pkg = item.preset?.package?.trim() || "";
  const suffixRe = base
    ? new RegExp(`^${escapeRegExp(base)}-\\d+$`)
    : null;

  return servers.filter((s) => {
    if (base && (s.id === base || s.id === item.id)) return true;
    if (suffixRe && suffixRe.test(s.id)) return true;
    if (pkg && s.packageName === pkg) return true;
    return false;
  });
}

/** Next free id: base, then base-2, base-3, … */
export function nextLibraryServerId(
  baseId: string,
  existingIds: Iterable<string>,
): string {
  const base = baseId.trim() || "server";
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Best-effort docs / package / repo URL for a library item. */
export function librarySourceUrl(item: LibraryItem): string | null {
  const git = item.preset?.git?.trim() || "";
  if (/^https?:\/\//i.test(git)) return git;
  if (/^git\+https?:\/\//i.test(git)) return git.replace(/^git\+/i, "");
  if (/^github\.com\//i.test(git)) return `https://${git}`;

  const src = (item.source || "").trim();
  if (/^https?:\/\//i.test(src)) return src;
  if (/^github\.com\//i.test(src)) return `https://${src}`;

  const pkg = (item.preset?.package || src || "").trim();
  if (!pkg) return null;

  // Git / HTTP package specs (uvx --from, etc.)
  if (/^https?:\/\//i.test(pkg)) return pkg;
  if (/^git\+https?:\/\//i.test(pkg)) return pkg.replace(/^git\+/i, "");
  if (/^github\.com\//i.test(pkg)) return `https://${pkg}`;

  const launcher = item.preset?.launcher;
  if (launcher === "uvx" || item.tags?.includes("uvx")) {
    const name = pkg.replace(/\[.*\]$/, "").split("@")[0];
    if (name && !name.includes("://")) {
      return `https://pypi.org/project/${encodeURIComponent(name)}/`;
    }
  }
  if (launcher === "npx" || item.tags?.includes("npx") || pkg.startsWith("@")) {
    let npmName = pkg.replace(/^npm:/, "");
    if (npmName.startsWith("@")) {
      // @scope/name or @scope/name@version
      const parts = npmName.split("@").filter(Boolean);
      npmName = parts.length >= 1 ? `@${parts[0]}` : npmName;
    } else {
      npmName = npmName.split("@")[0];
    }
    if (npmName) {
      return `https://www.npmjs.com/package/${npmName}`;
    }
  }
  return null;
}

/** Human label for where librarySourceUrl points. */
export function librarySourceKind(item: LibraryItem): "repo" | "npm" | "pypi" | "web" | null {
  const url = librarySourceUrl(item);
  if (!url) return null;
  if (/github\.com|gitlab\.com|gitea\.|bitbucket\./i.test(url) || item.preset?.git) {
    return "repo";
  }
  if (/npmjs\.com/i.test(url)) return "npm";
  if (/pypi\.org/i.test(url)) return "pypi";
  return "web";
}

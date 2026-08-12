/** Parse / format package version pins for npx and uvx launchers. */

export type PackageKind = "npx" | "uvx" | "git" | "custom";

export type PackageSpec = {
  kind: PackageKind;
  /** Unpinned package name (npm or PyPI), if known. */
  name: string | null;
  /** Explicit pin, or null for floating/latest. */
  version: string | null;
  /** Display label for UI. */
  label: string;
};

/** Split npm package spec: @scope/name@version or name@version */
export function parseNpmSpec(spec: string): { name: string; version: string | null } {
  const s = spec.trim();
  if (!s) return { name: "", version: null };
  if (s.startsWith("@")) {
    const at = s.indexOf("@", 1);
    if (at === -1) return { name: s, version: null };
    return { name: s.slice(0, at), version: s.slice(at + 1) || null };
  }
  const at = s.lastIndexOf("@");
  if (at <= 0) return { name: s, version: null };
  return { name: s.slice(0, at), version: s.slice(at + 1) || null };
}

/** Split uvx/PyPI: name==1.2.3 or name@version */
export function parseUvxSpec(spec: string): { name: string; version: string | null } {
  const s = spec.trim();
  if (!s) return { name: "", version: null };
  const eq = s.indexOf("==");
  if (eq > 0) {
    return { name: s.slice(0, eq), version: s.slice(eq + 2) || null };
  }
  // Avoid treating git+/URLs as versioned names
  if (s.includes("://") || s.startsWith("git+")) {
    return { name: s, version: null };
  }
  const at = s.lastIndexOf("@");
  if (at <= 0) return { name: s, version: null };
  return { name: s.slice(0, at), version: s.slice(at + 1) || null };
}

export function formatNpmSpec(name: string, version: string | null | undefined): string {
  const n = name.trim();
  const v = version?.trim();
  if (!n) return "";
  return v ? `${n}@${v}` : n;
}

export function formatUvxSpec(name: string, version: string | null | undefined): string {
  const n = name.trim();
  const v = version?.trim();
  if (!n) return "";
  return v ? `${n}==${v}` : n;
}

/** uvx flags that consume a following value (not `--flag=value`). */
const UVX_VALUE_OPTS = new Set([
  "--from",
  "--with",
  "-w",
  "--with-editable",
  "--with-requirements",
  "--constraints",
  "-c",
  "--build-constraints",
  "-b",
  "--overrides",
  "--env-file",
  "--python",
  "-p",
  "--python-platform",
  "--index",
  "--default-index",
  "--index-url",
  "-i",
  "--extra-index-url",
  "--find-links",
  "-f",
  "--directory",
  "--project",
  "--config-file",
]);

/** Boolean uvx flags (no following value). */
const UVX_BOOL_OPTS = new Set([
  "--isolated",
  "--no-env-file",
  "--lfs",
  "--no-progress",
  "--quiet",
  "-q",
  "--verbose",
  "-v",
  "--no-cache",
  "--refresh",
  "--offline",
  "--no-python-downloads",
]);

function uvxOptionName(token: string): string {
  const eq = token.indexOf("=");
  return eq === -1 ? token : token.slice(0, eq);
}

/** Split `uvx [options] <package> [tool args…]`. Unknown dash flags are tool args. */
export function splitUvxInvocation(args: string[]): {
  options: string[];
  packageSpec: string | null;
  toolArgs: string[];
} {
  const options: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = String(args[i] ?? "");
    if (!a.startsWith("-")) break;
    const name = uvxOptionName(a);
    const isValueOpt = UVX_VALUE_OPTS.has(name);
    const isBoolOpt = UVX_BOOL_OPTS.has(name);
    if (!isValueOpt && !isBoolOpt) break;
    options.push(a);
    i++;
    if (
      isValueOpt &&
      !a.includes("=") &&
      i < args.length &&
      !String(args[i]).startsWith("-")
    ) {
      options.push(String(args[i]));
      i++;
    }
  }
  if (i >= args.length) {
    return { options, packageSpec: null, toolArgs: [] };
  }
  return {
    options,
    packageSpec: String(args[i]),
    toolArgs: args.slice(i + 1).map(String),
  };
}

/** Build uvx args from a package pin plus form extras (options and/or tool flags). */
export function buildUvxArgs(packageSpec: string, extra: string[]): string[] {
  const { options, packageSpec: nestedPkg, toolArgs } = splitUvxInvocation(
    extra,
  );
  // Extra may be options-only, or options + tool flags (no nested package).
  // If a non-option token appears in extras, treat it as a tool arg.
  const trailing = nestedPkg ? [nestedPkg, ...toolArgs] : toolArgs;
  return [...options, packageSpec, ...trailing];
}

/**
 * Ensure uvx options (--python, --with, …) sit before the package name.
 * Fixes saves from older UI that appended Extra args after the package.
 * Tool flags (e.g. --access-mode) stay after the package.
 */
export function normalizeUvxArgs(args: string[]): string[] {
  if (!args.length) return args;

  // Already option-first: rebuild via the normal splitter.
  if (String(args[0]).startsWith("-")) {
    const { options, packageSpec, toolArgs } = splitUvxInvocation(args);
    if (!packageSpec) return args;
    return [...options, packageSpec, ...toolArgs];
  }

  const packageSpec = String(args[0]);
  const rest = args.slice(1).map(String);
  const { options, packageSpec: nested, toolArgs } = splitUvxInvocation(rest);
  // Misordered: package first, then uvx options, then tool args.
  // splitUvxInvocation on rest will capture leading known opts; anything after
  // an unknown dash (or nested token) stays as tool args.
  if (!options.length) return args;
  const trailing = nested ? [nested, ...toolArgs] : toolArgs;
  return [...options, packageSpec, ...trailing];
}

export function normalizeLaunchCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (command === "uvx") {
    return { command, args: normalizeUvxArgs(args) };
  }
  return { command, args };
}

/** Inspect a server command/args (+ optional git source) for version info. */
export function extractPackageSpec(input: {
  command: string;
  args: string[];
  source?: { git: string; ref?: string } | null;
}): PackageSpec {
  const { command, args, source } = input;

  if (command === "npx" && args[0] === "-y" && args[1]) {
    const { name, version } = parseNpmSpec(args[1]);
    return {
      kind: "npx",
      name: name || null,
      version,
      label: version ? `${name}@${version}` : name || args[1],
    };
  }

  if (command === "uvx") {
    const { packageSpec } = splitUvxInvocation(args);
    if (packageSpec && !packageSpec.includes("://")) {
      const { name, version } = parseUvxSpec(packageSpec);
      return {
        kind: "uvx",
        name: name || null,
        version,
        label: version ? `${name}==${version}` : name || packageSpec,
      };
    }
  }

  if (source?.git) {
    return {
      kind: "git",
      name: source.git,
      version: source.ref ?? null,
      label: source.ref ? `${source.git}@${source.ref}` : source.git,
    };
  }

  return {
    kind: "custom",
    name: null,
    version: null,
    label: "custom",
  };
}

/** Rewrite launch args (and git ref) to apply a new package/git version. */
export function applyPackageVersion(
  input: {
    command: string;
    args: string[];
    source?: { git: string; ref?: string } | null;
  },
  version: string | null,
): {
  command: string;
  args: string[];
  source: { git: string; ref?: string } | null;
  kind: PackageKind;
  name: string | null;
  version: string | null;
} {
  const current = extractPackageSpec(input);
  const v = version?.trim() || null;

  if (current.kind === "npx" && current.name) {
    const pinned = formatNpmSpec(current.name, v);
    return {
      command: "npx",
      args: ["-y", pinned, ...input.args.slice(2)],
      source: input.source ?? null,
      kind: "npx",
      name: current.name,
      version: v,
    };
  }

  if (current.kind === "uvx" && current.name && !current.name.includes("://")) {
    const pinned = formatUvxSpec(current.name, v);
    const { options, toolArgs } = splitUvxInvocation(input.args);
    return {
      command: "uvx",
      args: [...options, pinned, ...toolArgs],
      source: input.source ?? null,
      kind: "uvx",
      name: current.name,
      version: v,
    };
  }

  if (current.kind === "git" && input.source?.git) {
    return {
      command: input.command,
      args: [...input.args],
      source: { git: input.source.git, ref: v || undefined },
      kind: "git",
      name: input.source.git,
      version: v,
    };
  }

  throw new Error(
    "This server uses a custom launch command — set the package/version (or git ref) in Configuration instead.",
  );
}

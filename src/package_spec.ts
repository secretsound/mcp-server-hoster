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

/** Split `uvx [options] <package> [tool args…]`. */
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
    options.push(a);
    i++;
    if (a.includes("=")) continue;
    if (
      UVX_VALUE_OPTS.has(a) &&
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
  const { options, toolArgs } = splitUvxInvocation(extra);
  return [...options, packageSpec, ...toolArgs];
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

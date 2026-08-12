/** Parse / format package version pins for npx and uvx (mirrors backend). */

export function parseNpmSpec(
  spec: string,
): { name: string; version: string | null } {
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

export function parseUvxSpec(
  spec: string,
): { name: string; version: string | null } {
  const s = spec.trim();
  if (!s) return { name: "", version: null };
  const eq = s.indexOf("==");
  if (eq > 0) {
    return { name: s.slice(0, eq), version: s.slice(eq + 2) || null };
  }
  if (s.includes("://") || s.startsWith("git+")) {
    return { name: s, version: null };
  }
  const at = s.lastIndexOf("@");
  if (at <= 0) return { name: s, version: null };
  return { name: s.slice(0, at), version: s.slice(at + 1) || null };
}

export function formatNpmSpec(
  name: string,
  version: string | null | undefined,
): string {
  const n = name.trim();
  const v = version?.trim();
  if (!n) return "";
  return v ? `${n}@${v}` : n;
}

export function formatUvxSpec(
  name: string,
  version: string | null | undefined,
): string {
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
  const trailing = nestedPkg ? [nestedPkg, ...toolArgs] : toolArgs;
  return [...options, packageSpec, ...trailing];
}

export function shellQuoteArg(a: string): string {
  return String(a).includes(" ") ? JSON.stringify(a) : a;
}

export function versionLabel(server: {
  packageName?: string | null;
  packageVersion?: string | null;
  command?: string;
  args?: string[];
  source?: { git: string; ref?: string } | null;
}): string | null {
  if (server.packageVersion) {
    const name = server.packageName?.trim();
    return name ? `${name}@${server.packageVersion}` : server.packageVersion;
  }
  if (server.packageName) return `${server.packageName} (latest)`;
  if (server.source?.ref) return server.source.ref;
  return null;
}

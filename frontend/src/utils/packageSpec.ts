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

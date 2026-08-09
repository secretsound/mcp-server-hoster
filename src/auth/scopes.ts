/** Per-server tool grant. serverId "*" = all servers; tools ["*"] = all tools. */
export type ScopeGrant = {
  serverId: string;
  tools: string[];
};

export const FULL_ACCESS: ScopeGrant[] = [{ serverId: "*", tools: ["*"] }];

export function normalizeGrants(grants: ScopeGrant[]): ScopeGrant[] {
  const byServer = new Map<string, Set<string>>();
  for (const g of grants) {
    if (!g.serverId || !Array.isArray(g.tools) || g.tools.length === 0) continue;
    const existing = byServer.get(g.serverId) ?? new Set<string>();
    for (const t of g.tools) {
      if (t) existing.add(t);
    }
    byServer.set(g.serverId, existing);
  }

  const out: ScopeGrant[] = [];
  for (const [serverId, tools] of byServer) {
    if (tools.has("*")) {
      out.push({ serverId, tools: ["*"] });
    } else {
      out.push({ serverId, tools: [...tools].sort() });
    }
  }
  out.sort((a, b) => a.serverId.localeCompare(b.serverId));
  return out;
}

export function hasFullAccess(grants: ScopeGrant[]): boolean {
  return grants.some((g) => g.serverId === "*" && g.tools.includes("*"));
}

/** True if `inner` is entirely covered by `outer` (subset check). */
export function isSubsetOf(inner: ScopeGrant[], outer: ScopeGrant[]): boolean {
  const normalizedInner = normalizeGrants(inner);
  const normalizedOuter = normalizeGrants(outer);
  if (hasFullAccess(normalizedOuter)) return true;
  if (normalizedInner.length === 0) return true;

  for (const grant of normalizedInner) {
    if (grant.serverId === "*") {
      // Requesting all servers requires outer full access (already checked) or
      // an explicit "*" grant with sufficient tools.
      const star = normalizedOuter.find((g) => g.serverId === "*");
      if (!star) return false;
      if (!toolsCovered(grant.tools, star.tools)) return false;
      continue;
    }

    const serverGrant = normalizedOuter.find((g) => g.serverId === grant.serverId);
    const starGrant = normalizedOuter.find((g) => g.serverId === "*");
    const covering = serverGrant ?? starGrant;
    if (!covering) return false;
    if (!toolsCovered(grant.tools, covering.tools)) return false;
  }
  return true;
}

function toolsCovered(needed: string[], allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  if (needed.includes("*")) return false;
  const set = new Set(allowed);
  return needed.every((t) => set.has(t));
}

export function allowsTool(
  grants: ScopeGrant[],
  serverId: string,
  toolName: string,
): boolean {
  const normalized = normalizeGrants(grants);
  if (hasFullAccess(normalized)) return true;

  for (const g of normalized) {
    if (g.serverId !== "*" && g.serverId !== serverId) continue;
    if (g.tools.includes("*") || g.tools.includes(toolName)) return true;
  }
  return false;
}

/** True if grants include any access to the server (used for resources/prompts). */
export function allowsServer(
  grants: ScopeGrant[],
  serverId: string,
): boolean {
  const normalized = normalizeGrants(grants);
  if (hasFullAccess(normalized)) return true;
  return normalized.some((g) =>
    (g.serverId === "*" || g.serverId === serverId) && g.tools.length > 0
  );
}

export function parseGrantsJson(raw: string): ScopeGrant[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeGrants(
      parsed.filter((g): g is ScopeGrant =>
        !!g &&
        typeof g === "object" &&
        typeof (g as ScopeGrant).serverId === "string" &&
        Array.isArray((g as ScopeGrant).tools)
      ),
    );
  } catch {
    return [];
  }
}

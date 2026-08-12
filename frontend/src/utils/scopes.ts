import type { ScopeGrant } from "../types";
import { i18n } from "../i18n";

function t(key: string, ...args: unknown[]): string {
  return String(
    (i18n.global.t as (...a: unknown[]) => unknown)(key, ...args),
  );
}

export type ReachableServer = {
  id: string;
  allTools: boolean;
  tools: string[];
};

/** Resolve which servers a grant list can reach (expands "*" when catalog known). */
export function serversFromScopes(
  scopes: ScopeGrant[],
  catalog: { id: string; name?: string }[],
): ReachableServer[] {
  if (!scopes.length) return [];

  const star = scopes.find((g) => g.serverId === "*");
  if (star) {
    const allTools = star.tools.includes("*");
    if (!catalog.length) {
      return [{ id: "*", allTools, tools: allTools ? ["*"] : [...star.tools] }];
    }
    return catalog.map((s) => ({
      id: s.id,
      allTools,
      tools: allTools ? ["*"] : [...star.tools],
    }));
  }

  const byId = new Map<string, ReachableServer>();
  for (const g of scopes) {
    const prev = byId.get(g.serverId);
    const allTools = g.tools.includes("*") || !!prev?.allTools;
    const tools = allTools
      ? ["*"]
      : [...new Set([...(prev?.tools ?? []), ...g.tools])];
    byId.set(g.serverId, { id: g.serverId, allTools, tools });
  }
  return [...byId.values()];
}

/** Prefer a per-server /mcp/<id> when the key is scoped to exactly one concrete server. */
export function preferredMcpUrl(
  gatewayUrl: string,
  scopes: ScopeGrant[],
): { url: string; mode: "unified" | "per-server"; serverId?: string } {
  const concrete = scopes.filter((g) => g.serverId !== "*");
  const hasStar = scopes.some((g) => g.serverId === "*");
  if (!hasStar && concrete.length === 1) {
    const serverId = concrete[0]!.serverId;
    const base = gatewayUrl.replace(/\/$/, "");
    return {
      url: `${base}/${encodeURIComponent(serverId)}`,
      mode: "per-server",
      serverId,
    };
  }
  return { url: gatewayUrl, mode: "unified" };
}

export function scopesSummary(scopes: ScopeGrant[]): string {
  if (!scopes.length) return t("scopes.noScopes");
  if (scopes.some((g) => g.serverId === "*" && g.tools.includes("*"))) {
    return t("scopes.allServersAllTools");
  }
  if (scopes.some((g) => g.serverId === "*")) {
    return t("scopes.allServersLimitedTools");
  }
  const n = new Set(scopes.map((g) => g.serverId)).size;
  return t("scopes.nServers", n);
}

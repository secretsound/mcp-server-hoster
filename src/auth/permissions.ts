/** Catalog of permissions. Custom roles pick a subset; system admin gets all. */
export const PERMISSIONS = [
  "servers:read",
  "servers:write",
  "servers:lifecycle",
  "settings:read",
  "settings:write",
  "users:read",
  "users:write",
  "roles:read",
  "roles:write",
  "keys:own",
  "keys:tenant",
  "invites:write",
  "audit:read",
  "mcp:full",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_META: Record<
  Permission,
  { label: string; description: string }
> = {
  "servers:read": {
    label: "View servers",
    description: "List servers and discovered tools (still filtered by grants)",
  },
  "servers:write": {
    label: "Manage servers",
    description: "Create, update, and delete MCP server definitions",
  },
  "servers:lifecycle": {
    label: "Server lifecycle",
    description: "Start, stop, restart, and read logs",
  },
  "settings:read": {
    label: "View settings",
    description: "Read host settings",
  },
  "settings:write": {
    label: "Edit settings",
    description: "Change host settings",
  },
  "users:read": {
    label: "View users",
    description: "List users in the tenant",
  },
  "users:write": {
    label: "Manage users",
    description: "Create, update, and delete users",
  },
  "roles:read": {
    label: "View roles",
    description: "List roles and their permissions",
  },
  "roles:write": {
    label: "Manage roles",
    description: "Create and edit custom roles",
  },
  "keys:own": {
    label: "Own API keys",
    description: "Create and revoke personal API keys within grants",
  },
  "keys:tenant": {
    label: "Tenant API keys",
    description: "Create and revoke tenant-level MCP API keys",
  },
  "invites:write": {
    label: "Invites",
    description: "Create and revoke email invites",
  },
  "audit:read": {
    label: "View audit log",
    description: "Read the tenant activity trail (logins, keys, servers, invites)",
  },
  "mcp:full": {
    label: "Full MCP access",
    description: "Grant ceiling of all servers and tools (ignores user_grants)",
  },
};

export const SYSTEM_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...PERMISSIONS],
  user: ["servers:read", "keys:own"],
  /** Browse servers/settings/audit; no write or lifecycle. */
  viewer: ["servers:read", "settings:read", "audit:read"],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function normalizePermissions(values: string[]): Permission[] {
  const out = new Set<Permission>();
  for (const v of values) {
    if (isPermission(v)) out.add(v);
  }
  return [...out].sort();
}

export function hasPermission(
  held: readonly string[] | undefined | null,
  needed: Permission | Permission[],
): boolean {
  if (!held?.length) return false;
  const set = new Set(held);
  const need = Array.isArray(needed) ? needed : [needed];
  return need.every((p) => set.has(p));
}

export function hasAnyPermission(
  held: readonly string[] | undefined | null,
  needed: Permission[],
): boolean {
  if (!held?.length) return false;
  const set = new Set(held);
  return needed.some((p) => set.has(p));
}

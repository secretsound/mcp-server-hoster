import type { ScopeGrant } from "../../auth/scopes.ts";
import { normalizeGrants, parseGrantsJson } from "../../auth/scopes.ts";
import {
  hasPermission,
  type Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from "../../auth/permissions.ts";
import type { SqlDatabase } from "../types.ts";

/** Role slug — system: admin|user, or any custom slug. */
export type UserRole = string;

export type TenantRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type RoleRecord = {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  createdAt: string;
};

export type UserRecord = {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  displayName: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = Omit<UserRecord, "passwordHash"> & {
  grants: ScopeGrant[];
  permissions: Permission[];
  /** False for SSO-only accounts (no local password). */
  hasPassword: boolean;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type ApiKeyOwnerType = "tenant" | "user";

export type ApiKeyRecord = {
  id: string;
  tenantId: string;
  ownerType: ApiKeyOwnerType;
  userId: string | null;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ScopeGrant[];
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type PublicApiKey = Omit<ApiKeyRecord, "keyHash">;

export type InviteRecord = {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  grants: ScopeGrant[];
  tokenHash: string;
  expiresAt: string;
  createdBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type PublicInvite = Omit<InviteRecord, "tokenHash"> & {
  token?: string;
};

export type OAuthAccountRecord = {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  email: string | null;
  createdAt: string;
};

export type OAuthStateRecord = {
  state: string;
  provider: string;
  codeVerifier: string | null;
  redirectTo: string | null;
  inviteTokenHash: string | null;
  expiresAt: string;
  createdAt: string;
};

/** Marker hash for OAuth-only accounts (password login disabled). */
export const OAUTH_PASSWORD_MARKER = "oauth$";

function now(): string {
  return new Date().toISOString();
}

function rowToTenant(row: Record<string, unknown>): TenantRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: String(row.role),
    displayName: (row.display_name as string | null) ?? null,
    disabled: Boolean(row.disabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
}

function parseGrantsField(value: unknown): ScopeGrant[] {
  if (Array.isArray(value)) {
    return normalizeGrants(
      value.filter((g): g is ScopeGrant =>
        !!g &&
        typeof g === "object" &&
        typeof (g as ScopeGrant).serverId === "string" &&
        Array.isArray((g as ScopeGrant).tools)
      ),
    );
  }
  if (typeof value === "string") return parseGrantsJson(value);
  return [];
}

function rowToApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    ownerType: String(row.owner_type) as ApiKeyOwnerType,
    userId: (row.user_id as string | null) ?? null,
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    keyHash: String(row.key_hash),
    scopes: parseGrantsField(row.scopes ?? "[]"),
    createdBy: (row.created_by as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function rowToInvite(row: Record<string, unknown>): InviteRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    role: String(row.role),
    grants: parseGrantsField(row.grants ?? "[]"),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    createdBy: (row.created_by as string | null) ?? null,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function toPublicKey(key: ApiKeyRecord): PublicApiKey {
  const { keyHash: _hash, ...rest } = key;
  return rest;
}

function toPublicInvite(invite: InviteRecord, token?: string): PublicInvite {
  const { tokenHash: _t, ...rest } = invite;
  return token ? { ...rest, token } : rest;
}

export class AuthRepository {
  constructor(private readonly db: SqlDatabase) {}

  // --- tenants ---

  async ensureDefaultTenant(id: string, name: string): Promise<TenantRecord> {
    const existing = await this.getTenant(id);
    if (existing) return existing;
    const ts = now();
    await this.db.prepare(
      "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)",
    ).run(id, name, ts);
    return (await this.getTenant(id))!;
  }

  async getTenant(id: string): Promise<TenantRecord | null> {
    const row = await this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(id);
    return row ? rowToTenant(row) : null;
  }

  // --- roles ---

  async ensureSystemRoles(tenantId: string): Promise<void> {
    for (const [slug, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const existing = await this.getRoleBySlug(tenantId, slug);
      if (existing) {
    await this.setRolePermissions(existing.id, perms);
        continue;
      }
      const id = `${tenantId}_${slug}`;
      const ts = now();
      await this.db.prepare(`
        INSERT INTO roles (id, tenant_id, slug, name, description, is_system, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(
        id,
        tenantId,
        slug,
        slug === "admin"
          ? "Admin"
          : slug === "viewer"
          ? "Viewer"
          : "User",
        slug === "admin"
          ? "Full access to the host"
          : slug === "viewer"
          ? "Read-only access to servers, settings, and audit"
          : "View granted servers and manage personal API keys",
        ts,
      );
      await this.setRolePermissions(id, perms);
    }
  }

  async listRoles(tenantId: string): Promise<RoleRecord[]> {
    const rows = await this.db.prepare(
      "SELECT * FROM roles WHERE tenant_id = ? ORDER BY is_system DESC, slug",
    ).all(tenantId);
    return await Promise.all(rows.map((row) => this.hydrateRole(row)));
  }

  async getRole(id: string): Promise<RoleRecord | null> {
    const row = await this.db.prepare("SELECT * FROM roles WHERE id = ?").get(id);
    return row ? await this.hydrateRole(row) : null;
  }

  async getRoleBySlug(tenantId: string, slug: string): Promise<RoleRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM roles WHERE tenant_id = ? AND slug = ?",
    ).get(tenantId, slug);
    return row ? await this.hydrateRole(row) : null;
  }

  private async hydrateRole(row: Record<string, unknown>): Promise<RoleRecord> {
    const id = String(row.id);
    const permissions = (await this.db.prepare(
      "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission",
    ).all(id)).map((r) => String(r.permission) as Permission);
    return {
      id,
      tenantId: String(row.tenant_id),
      slug: String(row.slug),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      isSystem: Boolean(row.is_system),
      permissions,
      createdAt: String(row.created_at),
    };
  }

  async createRole(input: {
    id: string;
    tenantId: string;
    slug: string;
    name: string;
    description?: string | null;
    permissions: Permission[];
  }): Promise<RoleRecord> {
    if (await this.getRoleBySlug(input.tenantId, input.slug)) {
      throw new Error(`Role already exists: ${input.slug}`);
    }
    const ts = now();
    await this.db.prepare(`
      INSERT INTO roles (id, tenant_id, slug, name, description, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(
      input.id,
      input.tenantId,
      input.slug,
      input.name,
      input.description ?? null,
      ts,
    );
    await this.setRolePermissions(input.id, input.permissions);
    return (await this.getRole(input.id))!;
  }

  async updateRole(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      permissions?: Permission[];
    },
  ): Promise<RoleRecord> {
    const existing = await this.getRole(id);
    if (!existing) throw new Error("Role not found");
    if (existing.isSystem && patch.permissions) {
      throw new Error("Cannot change permissions on system roles");
    }
    await this.db.prepare(`
      UPDATE roles SET name = ?, description = ? WHERE id = ?
    `).run(
      patch.name ?? existing.name,
      patch.description !== undefined ? patch.description : existing.description,
      id,
    );
    if (patch.permissions && !existing.isSystem) {
      await this.setRolePermissions(id, patch.permissions);
    }
    return (await this.getRole(id))!;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (!role) throw new Error("Role not found");
    if (role.isSystem) throw new Error("Cannot delete system roles");
    const inUse = await this.db.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = ?",
    ).get(role.tenantId, role.slug);
    if (Number(inUse?.c ?? 0) > 0) {
    throw new Error("Role is still assigned to users");
    }
    await this.db.prepare("DELETE FROM roles WHERE id = ?").run(id);
  }

  async setRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
    await this.db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
    for (const p of permissions) {
    await this.db.prepare(
        "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)",
      ).run(roleId, p);
    }
  }

  async permissionsForRole(tenantId: string, slug: string): Promise<Permission[]> {
    const role = await this.getRoleBySlug(tenantId, slug);
    if (role) return role.permissions;
    return SYSTEM_ROLE_PERMISSIONS[slug] ?? SYSTEM_ROLE_PERMISSIONS.user ?? [];
  }

  // --- users ---

  async userCount(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS c FROM users").get();
    return Number(row?.c ?? 0);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? rowToUser(row) : null;
  }

  async getUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM users WHERE tenant_id = ? AND lower(email) = lower(?)",
    ).get(tenantId, email);
    return row ? rowToUser(row) : null;
  }

  async listUsers(tenantId: string): Promise<UserRecord[]> {
    return (await this.db.prepare(
      "SELECT * FROM users WHERE tenant_id = ? ORDER BY email",
    ).all(tenantId)).map(rowToUser);
  }

  async createUser(input: {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    displayName?: string | null;
  }): Promise<UserRecord> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO users (
        id, tenant_id, email, password_hash, role, display_name, disabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      input.id,
      input.tenantId,
      input.email.trim().toLowerCase(),
      input.passwordHash,
      input.role,
      input.displayName ?? null,
      ts,
      ts,
    );
    return (await this.getUser(input.id))!;
  }

  async updateUser(
    id: string,
    patch: {
      email?: string;
      passwordHash?: string;
      role?: UserRole;
      displayName?: string | null;
      disabled?: boolean;
    },
  ): Promise<UserRecord> {
    const existing = await this.getUser(id);
    if (!existing) throw new Error(`User not found: ${id}`);
    const ts = now();
    const email = patch.email !== undefined
      ? patch.email.trim().toLowerCase()
      : existing.email;
    await this.db.prepare(`
      UPDATE users SET
        email = ?, password_hash = ?, role = ?, display_name = ?, disabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      email,
      patch.passwordHash ?? existing.passwordHash,
      patch.role ?? existing.role,
      patch.displayName !== undefined ? patch.displayName : existing.displayName,
      (patch.disabled ?? existing.disabled) ? 1 : 0,
      ts,
      id,
    );
    return (await this.getUser(id))!;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  async countUsersWithPermission(
    tenantId: string,
    permission: Permission,
  ): Promise<number> {
    let n = 0;
    for (const u of await this.listUsers(tenantId)) {
      if (u.disabled) continue;
      const perms = await this.permissionsForRole(tenantId, u.role);
      if (hasPermission(perms, permission)) n++;
    }
    return n;
  }

  // --- grants ---

  async setGrants(userId: string, grants: ScopeGrant[]): Promise<ScopeGrant[]> {
    await this.db.prepare("DELETE FROM user_grants WHERE user_id = ?").run(userId);
    const ts = now();
    const normalized = normalizeGrants(grants);
    for (const g of normalized) {
    const id = `${userId}:${g.serverId}`;
      await this.db.prepare(`
        INSERT INTO user_grants (id, user_id, server_id, tools, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, userId, g.serverId, JSON.stringify(g.tools), ts);
    }
    return await this.getGrants(userId);
  }

  async getGrants(userId: string): Promise<ScopeGrant[]> {
    const rows = await this.db.prepare(
      "SELECT server_id, tools FROM user_grants WHERE user_id = ? ORDER BY server_id",
    ).all(userId);
    return normalizeGrants(rows.map((row) => {
      let tools: string[] = ["*"];
      const raw = row.tools;
      if (Array.isArray(raw)) {
        tools = raw.map(String);
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) tools = parsed.map(String);
        } catch {
          // keep default
        }
      }
      return { serverId: String(row.server_id), tools };
    }));
  }

  async toPublicUser(user: UserRecord): Promise<PublicUser> {
    const { passwordHash, ...rest } = user;
    const permissions = await this.permissionsForRole(user.tenantId, user.role);
    const fullMcp = hasPermission(permissions, "mcp:full");
    return {
      ...rest,
      hasPassword: passwordHash !== OAUTH_PASSWORD_MARKER,
      permissions,
      grants: fullMcp
        ? [{ serverId: "*", tools: ["*"] }]
        : await this.getGrants(user.id),
    };
  }

  // --- sessions ---

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<SessionRecord> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.userId, input.tokenHash, input.expiresAt, ts);
    return (await this.getSessionByHash(input.tokenHash))!;
  }

  async getSessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash);
    return row ? rowToSession(row) : null;
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const row = await this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? rowToSession(row) : null;
  }

  async listSessionsForUser(userId: string): Promise<SessionRecord[]> {
    return (await this.db.prepare(
      "SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC",
    ).all(userId)).map(rowToSession);
  }

  async deleteSessionsForUser(userId: string, exceptId?: string | null): Promise<void> {
    if (exceptId) {
    await this.db.prepare(
        "DELETE FROM sessions WHERE user_id = ? AND id != ?",
      ).run(userId, exceptId);
      return;
    }
    await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  // --- api keys ---

  async createApiKey(input: {
    id: string;
    tenantId: string;
    ownerType: ApiKeyOwnerType;
    userId: string | null;
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: ScopeGrant[];
    createdBy: string | null;
    expiresAt?: string | null;
  }): Promise<ApiKeyRecord> {
    const ts = now();
    const scopes = normalizeGrants(input.scopes);
    await this.db.prepare(`
      INSERT INTO api_keys (
        id, tenant_id, owner_type, user_id, name, key_prefix, key_hash,
        scopes, created_by, last_used_at, expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
    `).run(
      input.id,
      input.tenantId,
      input.ownerType,
      input.userId,
      input.name,
      input.keyPrefix,
      input.keyHash,
      JSON.stringify(scopes),
      input.createdBy,
      input.expiresAt ?? null,
      ts,
    );
    return (await this.getApiKey(input.id))!;
  }

  async getApiKey(id: string): Promise<ApiKeyRecord | null> {
    const row = await this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
    return row ? rowToApiKey(row) : null;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = await this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?")
      .get(keyHash);
    return row ? rowToApiKey(row) : null;
  }

  async listTenantApiKeys(tenantId: string): Promise<PublicApiKey[]> {
    return (await this.db.prepare(`
      SELECT * FROM api_keys
      WHERE tenant_id = ? AND owner_type = 'tenant'
      ORDER BY created_at DESC
    `).all(tenantId)).map((r) => toPublicKey(rowToApiKey(r)));
  }

  async listUserApiKeys(userId: string): Promise<PublicApiKey[]> {
    return (await this.db.prepare(`
      SELECT * FROM api_keys
      WHERE user_id = ? AND owner_type = 'user'
      ORDER BY created_at DESC
    `).all(userId)).map((r) => toPublicKey(rowToApiKey(r)));
  }

  async touchApiKey(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
    ).run(now(), id);
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).run(now(), id);
  }

  // --- invites ---

  async createInvite(input: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    grants: ScopeGrant[];
    tokenHash: string;
    expiresAt: string;
    createdBy: string | null;
  }): Promise<InviteRecord> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO invites (
        id, tenant_id, email, role, grants, token_hash, expires_at,
        created_by, accepted_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    `).run(
      input.id,
      input.tenantId,
      input.email.trim().toLowerCase(),
      input.role,
      JSON.stringify(normalizeGrants(input.grants)),
      input.tokenHash,
      input.expiresAt,
      input.createdBy,
      ts,
    );
    return (await this.getInvite(input.id))!;
  }

  async getInvite(id: string): Promise<InviteRecord | null> {
    const row = await this.db.prepare("SELECT * FROM invites WHERE id = ?").get(id);
    return row ? rowToInvite(row) : null;
  }

  async getInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    const row = await this.db.prepare("SELECT * FROM invites WHERE token_hash = ?")
      .get(tokenHash);
    return row ? rowToInvite(row) : null;
  }

  async listInvites(tenantId: string): Promise<PublicInvite[]> {
    return (await this.db.prepare(`
      SELECT * FROM invites
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(tenantId)).map((r) => toPublicInvite(rowToInvite(r)));
  }

  async markInviteAccepted(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE invites SET accepted_at = ? WHERE id = ?",
    ).run(now(), id);
  }

  async revokeInvite(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND accepted_at IS NULL",
    ).run(now(), id);
  }

  publicInvite(invite: InviteRecord, token?: string): PublicInvite {
    return toPublicInvite(invite, token);
  }

  // --- oauth ---

  async createOAuthState(input: {
    state: string;
    provider: string;
    codeVerifier?: string | null;
    redirectTo?: string | null;
    inviteTokenHash?: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO oauth_states (
        state, provider, code_verifier, redirect_to, invite_token_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.state,
      input.provider,
      input.codeVerifier ?? null,
      input.redirectTo ?? null,
      input.inviteTokenHash ?? null,
      input.expiresAt,
      now(),
    );
  }

  async takeOAuthState(state: string): Promise<OAuthStateRecord | null> {
    const row = await this.db.prepare("SELECT * FROM oauth_states WHERE state = ?")
      .get(state);
    if (!row) return null;
    await this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (String(row.expires_at) < now()) return null;
    return {
      state: String(row.state),
      provider: String(row.provider),
      codeVerifier: (row.code_verifier as string | null) ?? null,
      redirectTo: (row.redirect_to as string | null) ?? null,
      inviteTokenHash: (row.invite_token_hash as string | null) ?? null,
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  async getOAuthAccount(
    provider: string,
    subject: string,
  ): Promise<OAuthAccountRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM oauth_accounts WHERE provider = ? AND provider_subject = ?",
    ).get(provider, subject);
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      provider: String(row.provider),
      providerSubject: String(row.provider_subject),
      email: (row.email as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  }

  async linkOAuthAccount(input: {
    id: string;
    userId: string;
    provider: string;
    providerSubject: string;
    email?: string | null;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO oauth_accounts (id, user_id, provider, provider_subject, email, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.userId,
      input.provider,
      input.providerSubject,
      input.email ?? null,
      now(),
    );
  }

  async listOAuthAccounts(userId: string): Promise<OAuthAccountRecord[]> {
    return (await this.db.prepare(
      "SELECT * FROM oauth_accounts WHERE user_id = ? ORDER BY provider",
    ).all(userId)).map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      provider: String(row.provider),
      providerSubject: String(row.provider_subject),
      email: (row.email as string | null) ?? null,
      createdAt: String(row.created_at),
    }));
  }

  // --- oauth settings (DB-backed) ---

  async getOAuthConfigRow(): Promise<OAuthConfigRow | null> {
    const row = await this.db.prepare("SELECT * FROM oauth_config WHERE id = ?")
      .get("default");
    if (!row) return null;
    return {
      id: String(row.id),
      publicUrl: (row.public_url as string | null) ?? null,
      autoProvision: Boolean(row.auto_provision),
      defaultRole: String(row.default_role ?? "user"),
      updatedAt: String(row.updated_at),
    };
  }

  async upsertOAuthConfig(input: {
    publicUrl: string | null;
    autoProvision: boolean;
    defaultRole: string;
  }): Promise<OAuthConfigRow> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO oauth_config (id, public_url, auto_provision, default_role, updated_at)
      VALUES ('default', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        public_url = excluded.public_url,
        auto_provision = excluded.auto_provision,
        default_role = excluded.default_role,
        updated_at = excluded.updated_at
    `).run(
      input.publicUrl,
      input.autoProvision ? 1 : 0,
      input.defaultRole || "user",
      ts,
    );
    return (await this.getOAuthConfigRow())!;
  }

  async listOAuthProviderRows(): Promise<OAuthProviderRow[]> {
    return (await this.db.prepare(
      "SELECT * FROM oauth_providers ORDER BY id",
    ).all()).map((row) => rowToOAuthProvider(row));
  }

  async getOAuthProviderRow(id: string): Promise<OAuthProviderRow | null> {
    const row = await this.db.prepare("SELECT * FROM oauth_providers WHERE id = ?")
      .get(id);
    return row ? rowToOAuthProvider(row) : null;
  }

  async upsertOAuthProvider(input: {
    id: string;
    enabled: boolean;
    label: string;
    clientId: string;
    clientSecret: string;
    issuer?: string | null;
    authorizationEndpoint?: string | null;
    tokenEndpoint?: string | null;
    userinfoEndpoint?: string | null;
    scopes: string[];
  }): Promise<OAuthProviderRow> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO oauth_providers (
        id, enabled, label, client_id, client_secret, issuer,
        authorization_endpoint, token_endpoint, userinfo_endpoint, scopes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        label = excluded.label,
        client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        issuer = excluded.issuer,
        authorization_endpoint = excluded.authorization_endpoint,
        token_endpoint = excluded.token_endpoint,
        userinfo_endpoint = excluded.userinfo_endpoint,
        scopes = excluded.scopes,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.enabled ? 1 : 0,
      input.label,
      input.clientId,
      input.clientSecret,
      input.issuer ?? null,
      input.authorizationEndpoint ?? null,
      input.tokenEndpoint ?? null,
      input.userinfoEndpoint ?? null,
      JSON.stringify(input.scopes),
      ts,
    );
    return (await this.getOAuthProviderRow(input.id))!;
  }

  /** True when oauth_config row exists (providers may still be empty). */
  async hasOAuthConfig(): Promise<boolean> {
    return (await this.getOAuthConfigRow()) != null;
  }

  // --- MCP OAuth AS (host-issued tokens for browser MCP clients) ---

  async createMcpOAuthClient(input: {
    clientId: string;
    clientSecretHash: string | null;
    clientName: string;
    redirectUris: string[];
    grantTypes: string[];
    responseTypes: string[];
    tokenEndpointAuthMethod: string;
  }): Promise<McpOAuthClientRecord> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO mcp_oauth_clients (
        client_id, client_secret_hash, client_name, redirect_uris,
        grant_types, response_types, token_endpoint_auth_method, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.clientId,
      input.clientSecretHash,
      input.clientName,
      JSON.stringify(input.redirectUris),
      JSON.stringify(input.grantTypes),
      JSON.stringify(input.responseTypes),
      input.tokenEndpointAuthMethod,
      ts,
    );
    return (await this.getMcpOAuthClient(input.clientId))!;
  }

  async getMcpOAuthClient(clientId: string): Promise<McpOAuthClientRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM mcp_oauth_clients WHERE client_id = ?",
    ).get(clientId);
    return row ? rowToMcpOAuthClient(row) : null;
  }

  async createMcpOAuthAuthRequest(input: {
    id: string;
    clientId: string;
    redirectUri: string;
    scope: string | null;
    state: string | null;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource: string | null;
    expiresAt: string;
  }): Promise<McpOAuthAuthRequestRecord> {
    const ts = now();
    await this.db.prepare(`
      INSERT INTO mcp_oauth_auth_requests (
        id, client_id, redirect_uri, scope, state, code_challenge,
        code_challenge_method, resource, user_id, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      input.id,
      input.clientId,
      input.redirectUri,
      input.scope,
      input.state,
      input.codeChallenge,
      input.codeChallengeMethod,
      input.resource,
      input.expiresAt,
      ts,
    );
    return (await this.getMcpOAuthAuthRequest(input.id))!;
  }

  async getMcpOAuthAuthRequest(id: string): Promise<McpOAuthAuthRequestRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM mcp_oauth_auth_requests WHERE id = ?",
    ).get(id);
    return row ? rowToMcpOAuthAuthRequest(row) : null;
  }

  async deleteMcpOAuthAuthRequest(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM mcp_oauth_auth_requests WHERE id = ?").run(id);
  }

  async createMcpOAuthCode(input: {
    id: string;
    codeHash: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string | null;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO mcp_oauth_codes (
        id, code_hash, client_id, user_id, redirect_uri, scope,
        code_challenge, code_challenge_method, resource, expires_at,
        consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      input.id,
      input.codeHash,
      input.clientId,
      input.userId,
      input.redirectUri,
      input.scope,
      input.codeChallenge,
      input.codeChallengeMethod,
      input.resource,
      input.expiresAt,
      now(),
    );
  }

  async getMcpOAuthCodeByHash(codeHash: string): Promise<McpOAuthCodeRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM mcp_oauth_codes WHERE code_hash = ?",
    ).get(codeHash);
    return row ? rowToMcpOAuthCode(row) : null;
  }

  async consumeMcpOAuthCode(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE mcp_oauth_codes SET consumed_at = ? WHERE id = ?",
    ).run(now(), id);
  }

  async createMcpOAuthToken(input: {
    id: string;
    accessTokenHash: string;
    refreshTokenHash: string | null;
    clientId: string;
    userId: string;
    scope: string | null;
    resource: string | null;
    accessExpiresAt: string;
    refreshExpiresAt: string | null;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO mcp_oauth_tokens (
        id, access_token_hash, refresh_token_hash, client_id, user_id,
        scope, resource, access_expires_at, refresh_expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      input.id,
      input.accessTokenHash,
      input.refreshTokenHash,
      input.clientId,
      input.userId,
      input.scope,
      input.resource,
      input.accessExpiresAt,
      input.refreshExpiresAt,
      now(),
    );
  }

  async getMcpOAuthTokenByAccessHash(hash: string): Promise<McpOAuthTokenRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM mcp_oauth_tokens WHERE access_token_hash = ?",
    ).get(hash);
    return row ? rowToMcpOAuthToken(row) : null;
  }

  async getMcpOAuthTokenByRefreshHash(hash: string): Promise<McpOAuthTokenRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM mcp_oauth_tokens WHERE refresh_token_hash = ?",
    ).get(hash);
    return row ? rowToMcpOAuthToken(row) : null;
  }

  async revokeMcpOAuthToken(id: string): Promise<void> {
    await this.db.prepare(
      "UPDATE mcp_oauth_tokens SET revoked_at = ? WHERE id = ?",
    ).run(now(), id);
  }

  async rotateMcpOAuthToken(input: {
    id: string;
    accessTokenHash: string;
    refreshTokenHash: string | null;
    accessExpiresAt: string;
    refreshExpiresAt: string | null;
  }): Promise<void> {
    await this.db.prepare(`
      UPDATE mcp_oauth_tokens SET
        access_token_hash = ?,
        refresh_token_hash = ?,
        access_expires_at = ?,
        refresh_expires_at = ?
      WHERE id = ?
    `).run(
      input.accessTokenHash,
      input.refreshTokenHash,
      input.accessExpiresAt,
      input.refreshExpiresAt,
      input.id,
    );
  }
}

export type McpOAuthClientRecord = {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: string;
};

export type McpOAuthAuthRequestRecord = {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string | null;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  userId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type McpOAuthCodeRecord = {
  id: string;
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type McpOAuthTokenRecord = {
  id: string;
  accessTokenHash: string;
  refreshTokenHash: string | null;
  clientId: string;
  userId: string;
  scope: string | null;
  resource: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type OAuthConfigRow = {
  id: string;
  publicUrl: string | null;
  autoProvision: boolean;
  defaultRole: string;
  updatedAt: string;
};

function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToMcpOAuthClient(row: Record<string, unknown>): McpOAuthClientRecord {
  return {
    clientId: String(row.client_id),
    clientSecretHash: (row.client_secret_hash as string | null) ?? null,
    clientName: String(row.client_name),
    redirectUris: parseJsonStringArray(row.redirect_uris ?? "[]"),
    grantTypes: parseJsonStringArray(row.grant_types ?? "[]"),
    responseTypes: parseJsonStringArray(row.response_types ?? "[]"),
    tokenEndpointAuthMethod: String(row.token_endpoint_auth_method ?? "none"),
    createdAt: String(row.created_at),
  };
}

function rowToMcpOAuthAuthRequest(
  row: Record<string, unknown>,
): McpOAuthAuthRequestRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    redirectUri: String(row.redirect_uri),
    scope: (row.scope as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    codeChallenge: String(row.code_challenge),
    codeChallengeMethod: String(row.code_challenge_method ?? "S256"),
    resource: (row.resource as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
}

function rowToMcpOAuthCode(row: Record<string, unknown>): McpOAuthCodeRecord {
  return {
    id: String(row.id),
    codeHash: String(row.code_hash),
    clientId: String(row.client_id),
    userId: String(row.user_id),
    redirectUri: String(row.redirect_uri),
    scope: (row.scope as string | null) ?? null,
    codeChallenge: String(row.code_challenge),
    codeChallengeMethod: String(row.code_challenge_method ?? "S256"),
    resource: (row.resource as string | null) ?? null,
    expiresAt: String(row.expires_at),
    consumedAt: (row.consumed_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function rowToMcpOAuthToken(row: Record<string, unknown>): McpOAuthTokenRecord {
  return {
    id: String(row.id),
    accessTokenHash: String(row.access_token_hash),
    refreshTokenHash: (row.refresh_token_hash as string | null) ?? null,
    clientId: String(row.client_id),
    userId: String(row.user_id),
    scope: (row.scope as string | null) ?? null,
    resource: (row.resource as string | null) ?? null,
    accessExpiresAt: String(row.access_expires_at),
    refreshExpiresAt: (row.refresh_expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export type OAuthProviderRow = {
  id: string;
  enabled: boolean;
  label: string;
  clientId: string;
  clientSecret: string;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  userinfoEndpoint: string | null;
  scopes: string[];
  updatedAt: string;
};

function rowToOAuthProvider(row: Record<string, unknown>): OAuthProviderRow {
  const scopes = parseJsonStringArray(row.scopes ?? "[]");
  return {
    id: String(row.id),
    enabled: Boolean(row.enabled),
    label: String(row.label),
    clientId: String(row.client_id ?? ""),
    clientSecret: String(row.client_secret ?? ""),
    issuer: (row.issuer as string | null) ?? null,
    authorizationEndpoint: (row.authorization_endpoint as string | null) ?? null,
    tokenEndpoint: (row.token_endpoint as string | null) ?? null,
    userinfoEndpoint: (row.userinfo_endpoint as string | null) ?? null,
    scopes,
    updatedAt: String(row.updated_at),
  };
}

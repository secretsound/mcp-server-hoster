import {
  FULL_ACCESS,
  isSubsetOf,
  normalizeGrants,
  type ScopeGrant,
} from "./scopes.ts";
import {
  generateApiKeySecret,
  generateSessionToken,
  hashPassword,
  newId,
  sha256Hex,
  verifyPassword,
} from "./crypto.ts";
import {
  hasPermission,
  normalizePermissions,
  PERMISSION_META,
  PERMISSIONS,
  type Permission,
} from "./permissions.ts";
import {
  applyOAuthSettingsUpdate,
  buildAuthorizeUrl,
  configFromDb,
  exchangeCode,
  fetchProfile,
  getProvider,
  newOAuthState,
  type OAuthConfig,
  type OAuthSettings,
  seedOAuthFromEnv,
  settingsFromDb,
} from "./oauth.ts";
import { McpOAuthService } from "./mcp_oauth.ts";
import type {
  ApiKeyRecord,
  AuthRepository,
  InviteRecord,
  PublicApiKey,
  PublicInvite,
  PublicUser,
  RoleRecord,
  UserRecord,
  UserRole,
} from "../db/repos/auth.ts";
import { OAUTH_PASSWORD_MARKER as OAUTH_MARKER } from "../db/repos/auth.ts";
import type { AuditAppendInput, AuditRepository } from "../db/repos/audit.ts";

const DEFAULT_TENANT_ID = "default";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_STATE_TTL_MS = 1000 * 60 * 15;

export type AuthPrincipal =
  | {
    kind: "session";
    user: PublicUser;
    sessionId: string;
    scopes: ScopeGrant[];
  }
  | {
    kind: "api_key";
    key: PublicApiKey;
    user: PublicUser | null;
    scopes: ScopeGrant[];
  }
  | {
    kind: "oauth_token";
    user: PublicUser;
    tokenId: string;
    clientId: string;
    resource: string | null;
    scopes: ScopeGrant[];
  };

export type AuthServiceOptions = {
  disabled: boolean;
  /** Allow unauthenticated access when the user table is empty (local POC only). */
  allowOpen: boolean;
  bootstrapEmail: string | null;
  bootstrapPassword: string | null;
  bootstrapDisplayName: string | null;
  publicUrl: string | null;
};

export class AuthService {
  readonly mcpOAuth: McpOAuthService;

  constructor(
    private readonly repo: AuthRepository,
    private readonly opts: AuthServiceOptions,
    private readonly audit: AuditRepository | null = null,
  ) {
    this.mcpOAuth = new McpOAuthService(repo, (user) => this.ceilingFor(user));
  }

  async recordAudit(input: AuditAppendInput): Promise<void> {
    try {
      await this.audit?.append(input);
    } catch (err) {
      console.error(
        "[audit] failed to record event:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async auditActor(
    actor: PublicUser | null | undefined,
    action: string,
    summary: string,
    extra?: Partial<AuditAppendInput>,
  ): Promise<void> {
    await this.recordAudit({
      tenantId: actor?.tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action,
      summary,
      ...extra,
    });
  }

  /** Load OAuth config from DB (re-read on each call so Settings changes apply). */
  async getOAuthConfig(): Promise<OAuthConfig> {
    return await configFromDb(this.repo, this.opts.publicUrl);
  }

  /** Public base URL for AS metadata / challenges (configured or bootstrap). */
  async publicBaseUrl(): Promise<string | null> {
    return (await this.getOAuthConfig()).publicUrl ?? this.opts.publicUrl;
  }

  async isRequired(): Promise<boolean> {
    if (this.opts.disabled) return false;
    return (await this.repo.userCount()) > 0;
  }

  async bootstrap(): Promise<void> {
    await this.repo.ensureDefaultTenant(DEFAULT_TENANT_ID, "Default");
    await this.repo.ensureSystemRoles(DEFAULT_TENANT_ID);
    await seedOAuthFromEnv(this.repo, this.opts.publicUrl);
    if ((await this.repo.userCount()) > 0) return;

    const email = this.opts.bootstrapEmail?.trim().toLowerCase();
    const password = this.opts.bootstrapPassword;
    if (email && password) {
      const user = await this.createUser({
        email,
        password,
        role: "admin",
        displayName: this.opts.bootstrapDisplayName ?? "Admin",
        grants: FULL_ACCESS,
      });
      console.error(`[auth] bootstrapped admin user ${user.email}`);
      return;
    }

    if (this.opts.disabled) {
      console.error("[auth] AUTH_DISABLED=1 — API/MCP accept unauthenticated access");
      return;
    }

    if (this.opts.allowOpen) {
      console.error(
        "[auth] AUTH_ALLOW_OPEN=1 — API/MCP are open until the first user is created (set BOOTSTRAP_ADMIN_EMAIL/PASSWORD to close)",
      );
      return;
    }

    throw new Error(
      "Refusing to start with an open auth surface: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, or AUTH_ALLOW_OPEN=1 for local POC, or AUTH_DISABLED=1 for tests",
    );
  }

  async userCan(
    user: PublicUser | null | undefined,
    permission: Permission,
  ): Promise<boolean> {
    if (!await this.isRequired()) return true;
    return hasPermission(user?.permissions, permission);
  }

  async ceilingFor(user: UserRecord | PublicUser): Promise<ScopeGrant[]> {
    const permissions = "permissions" in user
      ? user.permissions
      : await this.repo.permissionsForRole(user.tenantId, user.role);
    if (hasPermission(permissions, "mcp:full")) return FULL_ACCESS;
    return "grants" in user ? user.grants : await this.repo.getGrants(user.id);
  }

  private async issueSession(user: UserRecord): Promise<{
    user: PublicUser;
    token: string;
    expiresAt: string;
  }> {
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await this.repo.createSession({
      id: newId("sess"),
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    return {
      user: await this.repo.toPublicUser(user),
      token,
      expiresAt,
    };
  }

  async login(
    email: string,
    password: string,
    tenantId = DEFAULT_TENANT_ID,
  ): Promise<{ user: PublicUser; token: string; expiresAt: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.repo.getUserByEmail(tenantId, normalized);
    if (!user || user.disabled) {
      await this.recordAudit({
        tenantId,
        action: "auth.login_failed",
        summary: `Failed login for ${normalized || "(empty)"}`,
        metadata: { reason: "invalid_credentials" },
      });
      throw new Error("Invalid email or password");
    }
    if (user.passwordHash === OAUTH_MARKER) {
      await this.recordAudit({
        tenantId,
        actorUserId: user.id,
        actorEmail: user.email,
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: user.id,
        summary: `Failed login for ${user.email} (SSO-only account)`,
        metadata: { reason: "sso_only" },
      });
      throw new Error("This account uses SSO — sign in with OAuth");
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await this.recordAudit({
        tenantId,
        actorUserId: user.id,
        actorEmail: user.email,
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: user.id,
        summary: `Failed login for ${user.email}`,
        metadata: { reason: "invalid_credentials" },
      });
      throw new Error("Invalid email or password");
    }
    const session = await this.issueSession(user);
    await this.auditActor(session.user, "auth.login", `Signed in as ${session.user.email}`, {
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { method: "password" },
    });
    return session;
  }

  async listMySessions(
    actor: PublicUser,
    currentSessionId?: string | null,
  ): Promise<Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    current: boolean;
  }>> {
    return (await this.repo.listSessionsForUser(actor.id)).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: !!currentSessionId && s.id === currentSessionId,
    }));
  }

  async revokeSession(actor: PublicUser, sessionId: string): Promise<void> {
    const session = await this.repo.getSession(sessionId);
    if (!session || session.userId !== actor.id) {
      throw new Error("Session not found");
    }
    await this.repo.deleteSession(sessionId);
    await this.auditActor(actor, "auth.session_revoke", `Revoked session ${sessionId}`, {
      resourceType: "session",
      resourceId: sessionId,
    });
  }

  async revokeOtherSessions(
    actor: PublicUser,
    currentToken: string,
  ): Promise<number> {
    const hash = await sha256Hex(currentToken);
    const current = await this.repo.getSessionByHash(hash);
    const before = (await this.repo.listSessionsForUser(actor.id)).length;
    await this.repo.deleteSessionsForUser(actor.id, current?.id ?? null);
    const after = (await this.repo.listSessionsForUser(actor.id)).length;
    const revoked = Math.max(0, before - after);
    await this.auditActor(
      actor,
      "auth.session_revoke_all",
      `Revoked ${revoked} other session${revoked === 1 ? "" : "s"}`,
      { metadata: { revoked } },
    );
    return revoked;
  }

  async logout(token: string): Promise<void> {
    const hash = await sha256Hex(token);
    const session = await this.repo.getSessionByHash(hash);
    if (session) await this.repo.deleteSession(session.id);
  }

  async resolveBearer(token: string): Promise<AuthPrincipal | null> {
    if (!token) return null;

    if (token.startsWith("mcs_")) {
      const hash = await sha256Hex(token);
      const session = await this.repo.getSessionByHash(hash);
      if (!session) return null;
      if (session.expiresAt < new Date().toISOString()) {
        await this.repo.deleteSession(session.id);
        return null;
      }
      const user = await this.repo.getUser(session.userId);
      if (!user || user.disabled) return null;
      const publicUser = await this.repo.toPublicUser(user);
      return {
        kind: "session",
        user: publicUser,
        sessionId: session.id,
        scopes: await this.ceilingFor(publicUser),
      };
    }

    if (token.startsWith("mch_")) {
      const hash = await sha256Hex(token);
      const key = await this.repo.getApiKeyByHash(hash);
      if (!key || key.revokedAt) return null;
      if (key.expiresAt && key.expiresAt < new Date().toISOString()) return null;
      await this.repo.touchApiKey(key.id);

      const user = key.userId ? await this.repo.getUser(key.userId) : null;
      if (user?.disabled) return null;

      const { keyHash: _h, ...publicKey } = key;
      return {
        kind: "api_key",
        key: publicKey,
        user: user ? await this.repo.toPublicUser(user) : null,
        scopes: key.scopes,
      };
    }

    if (token.startsWith("mca_")) {
      const resolved = await this.mcpOAuth.resolveAccessToken(token);
      if (!resolved) return null;
      return {
        kind: "oauth_token",
        user: resolved.user,
        tokenId: resolved.tokenId,
        clientId: resolved.clientId,
        resource: resolved.resource,
        scopes: resolved.scopes,
      };
    }

    return null;
  }

  async listUsers(tenantId = DEFAULT_TENANT_ID): Promise<PublicUser[]> {
    return await Promise.all(
      (await this.repo.listUsers(tenantId)).map((u) => this.repo.toPublicUser(u)),
    );
  }

  async getUser(id: string): Promise<PublicUser | null> {
    const user = await this.repo.getUser(id);
    return user ? await this.repo.toPublicUser(user) : null;
  }

  private async assertRoleExists(tenantId: string, role: string): Promise<void> {
    if (!await this.repo.getRoleBySlug(tenantId, role)) {
      throw new Error(`Unknown role: ${role}`);
    }
  }

  async createUser(input: {
    email: string;
    password?: string | null;
    role: UserRole;
    displayName?: string | null;
    grants?: ScopeGrant[];
    tenantId?: string;
  }): Promise<PublicUser> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    await this.repo.ensureDefaultTenant(tenantId, "Default");
    await this.repo.ensureSystemRoles(tenantId);
    if (await this.repo.getUserByEmail(tenantId, input.email)) {
      throw new Error("User with that email already exists");
    }
    this.assertRoleExists(tenantId, input.role);

    let passwordHash = OAUTH_MARKER;
    if (input.password) {
      if (input.password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      passwordHash = await hashPassword(input.password);
    }

    const user = await this.repo.createUser({
      id: newId("usr"),
      tenantId,
      email: input.email,
      passwordHash,
      role: input.role,
      displayName: input.displayName,
    });

    const perms = await this.repo.permissionsForRole(tenantId, input.role);
    if (!hasPermission(perms, "mcp:full")) {
      await this.repo.setGrants(user.id, normalizeGrants(input.grants ?? []));
    } else if (input.grants?.length) {
      await this.repo.setGrants(user.id, normalizeGrants(input.grants));
    }

    return await this.repo.toPublicUser(user);
  }

  async updateUser(
    id: string,
    patch: {
      role?: UserRole;
      displayName?: string | null;
      disabled?: boolean;
      grants?: ScopeGrant[];
      password?: string;
      email?: string;
    },
  ): Promise<PublicUser> {
    const existing = await this.repo.getUser(id);
    if (!existing) throw new Error("User not found");

    let passwordHash: string | undefined;
    if (patch.password !== undefined) {
      if (patch.password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      passwordHash = await hashPassword(patch.password);
    }

    let email: string | undefined;
    if (patch.email !== undefined) {
      const normalized = patch.email.trim().toLowerCase();
      if (!normalized || !normalized.includes("@")) {
        throw new Error("A valid email is required");
      }
      if (normalized !== existing.email) {
        const clash = await this.repo.getUserByEmail(existing.tenantId, normalized);
        if (clash && clash.id !== id) {
          throw new Error("User with that email already exists");
        }
      }
      email = normalized;
    }

    const role = patch.role ?? existing.role;
    this.assertRoleExists(existing.tenantId, role);

    if (
      existing.role !== role ||
      (patch.disabled === true && !existing.disabled)
    ) {
      const wasAdminCapable = hasPermission(
        await this.repo.permissionsForRole(existing.tenantId, existing.role),
        "users:write",
      );
      if (wasAdminCapable) {
        const remaining = await this.repo.countUsersWithPermission(
          existing.tenantId,
          "users:write",
        );
        const stillCapable = hasPermission(
          await this.repo.permissionsForRole(existing.tenantId, role),
          "users:write",
        );
        if (remaining <= 1 && (!stillCapable || patch.disabled === true)) {
          throw new Error("Cannot remove the last user-admin");
        }
      }
    }

    await this.repo.updateUser(id, {
      email,
      passwordHash,
      role,
      displayName: patch.displayName,
      disabled: patch.disabled,
    });

    if (patch.grants !== undefined) {
      await this.repo.setGrants(id, normalizeGrants(patch.grants));
    }

    return await this.repo.toPublicUser((await this.repo.getUser(id))!);
  }

  /** Self-service profile updates (name, email, password). */
  async updateMyProfile(
    userId: string,
    patch: {
      displayName?: string | null;
      email?: string;
      currentPassword?: string;
      password?: string;
    },
  ): Promise<PublicUser> {
    const existing = await this.repo.getUser(userId);
    if (!existing) throw new Error("User not found");

    const wantsEmail = patch.email !== undefined &&
      patch.email.trim().toLowerCase() !== existing.email;
    const wantsPassword = patch.password !== undefined && patch.password.length > 0;
    const needsVerify = wantsEmail || wantsPassword;

    if (needsVerify) {
      if (existing.passwordHash === OAUTH_MARKER) {
        throw new Error(
          "This account uses single sign-on — email and password are managed by your identity provider",
        );
      }
      if (!patch.currentPassword) {
        throw new Error("Current password is required to change email or password");
      }
      const ok = await verifyPassword(patch.currentPassword, existing.passwordHash);
      if (!ok) throw new Error("Current password is incorrect");
    }

    return await this.updateUser(userId, {
      displayName: patch.displayName,
      email: wantsEmail ? patch.email : undefined,
      password: wantsPassword ? patch.password : undefined,
    });
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.repo.getUser(id);
    if (!user) throw new Error("User not found");
    const perms = await this.repo.permissionsForRole(user.tenantId, user.role);
    if (hasPermission(perms, "users:write")) {
      if (await this.repo.countUsersWithPermission(user.tenantId, "users:write") <= 1) {
        throw new Error("Cannot delete the last user-admin");
      }
    }
    await this.repo.deleteUser(id);
  }

  // --- roles ---

  async listRoles(tenantId = DEFAULT_TENANT_ID): Promise<RoleRecord[]> {
    await this.repo.ensureSystemRoles(tenantId);
    return await this.repo.listRoles(tenantId);
  }

  listPermissionCatalog() {
    return PERMISSIONS.map((id) => ({ id, ...PERMISSION_META[id] }));
  }

  async createRole(input: {
    tenantId?: string;
    slug: string;
    name: string;
    description?: string | null;
    permissions: string[];
  }): Promise<RoleRecord> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    await this.repo.ensureSystemRoles(tenantId);
    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!slug) throw new Error("Invalid role slug");
    if (slug === "admin" || slug === "user") {
      throw new Error("Cannot recreate system role slugs");
    }
    return await this.repo.createRole({
      id: newId("role"),
      tenantId,
      slug,
      name: input.name.trim() || slug,
      description: input.description,
      permissions: normalizePermissions(input.permissions),
    });
  }

  async updateRole(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      permissions?: string[];
    },
  ): Promise<RoleRecord> {
    return await this.repo.updateRole(id, {
      name: patch.name,
      description: patch.description,
      permissions: patch.permissions
        ? normalizePermissions(patch.permissions)
        : undefined,
    });
  }

  async deleteRole(id: string): Promise<void> {
    await this.repo.deleteRole(id);
  }

  // --- invites ---

  async createInvite(input: {
    actor: PublicUser;
    email: string;
    role?: string;
    grants?: ScopeGrant[];
    expiresInDays?: number;
  }): Promise<PublicInvite> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Valid email is required");
    const role = input.role ?? "user";
    this.assertRoleExists(input.actor.tenantId, role);
    if (await this.repo.getUserByEmail(input.actor.tenantId, email)) {
      throw new Error("User with that email already exists");
    }

    const raw = `mci_${cryptoRandom()}`;
    const tokenHash = await sha256Hex(raw);
    const days = Math.max(1, input.expiresInDays ?? 7);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const invite = await this.repo.createInvite({
      id: newId("inv"),
      tenantId: input.actor.tenantId,
      email,
      role,
      grants: normalizeGrants(input.grants ?? []),
      tokenHash,
      expiresAt,
      createdBy: input.actor.id,
    });
    await this.auditActor(
      input.actor,
      "invite.create",
      `Created invite for ${email} (${role})`,
      {
        resourceType: "invite",
        resourceId: invite.id,
        metadata: { email, role },
      },
    );
    return await this.repo.publicInvite(invite, raw);
  }

  async listInvites(tenantId = DEFAULT_TENANT_ID): Promise<PublicInvite[]> {
    return await this.repo.listInvites(tenantId);
  }

  async revokeInvite(actor: PublicUser, id: string): Promise<void> {
    const invite = await this.repo.getInvite(id);
    if (!invite || invite.tenantId !== actor.tenantId) {
      throw new Error("Invite not found");
    }
    await this.repo.revokeInvite(id);
    await this.auditActor(
      actor,
      "invite.revoke",
      `Revoked invite for ${invite.email}`,
      {
        resourceType: "invite",
        resourceId: invite.id,
        metadata: { email: invite.email },
      },
    );
  }

  async getInvitePreview(token: string): Promise<{
    email: string;
    role: string;
    grants: ScopeGrant[];
    expiresAt: string;
  }> {
    const invite = await this.requireActiveInvite(token);
    return {
      email: invite.email,
      role: invite.role,
      grants: invite.grants,
      expiresAt: invite.expiresAt,
    };
  }

  private async requireActiveInvite(token: string): Promise<InviteRecord> {
    const hash = await sha256Hex(token);
    const invite = await this.repo.getInviteByTokenHash(hash);
    if (!invite || invite.revokedAt || invite.acceptedAt) {
      throw new Error("Invite is invalid or already used");
    }
    if (invite.expiresAt < new Date().toISOString()) {
      throw new Error("Invite has expired");
    }
    return invite;
  }

  async acceptInvite(input: {
    token: string;
    password: string;
    displayName?: string | null;
  }): Promise<{ user: PublicUser; token: string; expiresAt: string }> {
    const invite = await this.requireActiveInvite(input.token);
    if (input.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const user = await this.createUser({
      email: invite.email,
      password: input.password,
      role: invite.role,
      displayName: input.displayName,
      grants: invite.grants,
      tenantId: invite.tenantId,
    });
    await this.repo.markInviteAccepted(invite.id);
    const record = (await this.repo.getUser(user.id))!;
    const session = await this.issueSession(record);
    await this.auditActor(
      session.user,
      "invite.accept",
      `${session.user.email} accepted invite (${invite.role})`,
      {
        resourceType: "invite",
        resourceId: invite.id,
        metadata: { method: "password", role: invite.role },
      },
    );
    return session;
  }

  // --- keys ---

  async createTenantApiKey(input: {
    actor: PublicUser;
    name: string;
    scopes?: ScopeGrant[];
    expiresAt?: string | null;
  }): Promise<{ key: PublicApiKey; secret: string }> {
    if (!hasPermission(input.actor.permissions, "keys:tenant")) {
      throw new Error("Missing permission: keys:tenant");
    }
    const scopes = normalizeGrants(input.scopes ?? FULL_ACCESS);
    return this.insertKey({
      tenantId: input.actor.tenantId,
      ownerType: "tenant",
      userId: null,
      name: input.name,
      scopes,
      createdBy: input.actor.id,
      expiresAt: input.expiresAt,
    });
  }

  async createUserApiKey(input: {
    actor: PublicUser;
    name: string;
    scopes: ScopeGrant[];
    expiresAt?: string | null;
  }): Promise<{ key: PublicApiKey; secret: string }> {
    if (!hasPermission(input.actor.permissions, "keys:own")) {
      throw new Error("Missing permission: keys:own");
    }
    const ceiling = await this.ceilingFor(input.actor);
    const scopes = normalizeGrants(input.scopes);
    if (!isSubsetOf(scopes, ceiling)) {
      throw new Error("Key scopes exceed your available grants");
    }
    if (scopes.length === 0) {
      throw new Error("At least one scope is required");
    }
    return this.insertKey({
      tenantId: input.actor.tenantId,
      ownerType: "user",
      userId: input.actor.id,
      name: input.name,
      scopes,
      createdBy: input.actor.id,
      expiresAt: input.expiresAt,
    });
  }

  private async insertKey(input: {
    tenantId: string;
    ownerType: "tenant" | "user";
    userId: string | null;
    name: string;
    scopes: ScopeGrant[];
    createdBy: string | null;
    expiresAt?: string | null;
  }): Promise<{ key: PublicApiKey; secret: string }> {
    if (!input.name.trim()) throw new Error("Name is required");
    const { secret, prefix } = generateApiKeySecret();
    const keyHash = await sha256Hex(secret);
    const record = await this.repo.createApiKey({
      id: newId("key"),
      tenantId: input.tenantId,
      ownerType: input.ownerType,
      userId: input.userId,
      name: input.name.trim(),
      keyPrefix: prefix,
      keyHash,
      scopes: input.scopes,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    });
    const { keyHash: _h, ...publicKey } = record;
    const actor = input.createdBy
      ? await this.repo.getUser(input.createdBy)
      : null;
    const publicActor = actor ? await this.repo.toPublicUser(actor) : null;
    await this.auditActor(
      publicActor,
      "api_key.create",
      `Created ${input.ownerType} API key “${publicKey.name}” (${publicKey.keyPrefix}…)`,
      {
        tenantId: input.tenantId,
        resourceType: "api_key",
        resourceId: publicKey.id,
        metadata: {
          ownerType: input.ownerType,
          keyPrefix: publicKey.keyPrefix,
          name: publicKey.name,
        },
      },
    );
    return { key: publicKey, secret };
  }

  async listTenantApiKeys(actor: PublicUser): Promise<PublicApiKey[]> {
    if (!hasPermission(actor.permissions, "keys:tenant")) {
      throw new Error("Missing permission: keys:tenant");
    }
    return await this.repo.listTenantApiKeys(actor.tenantId);
  }

  async listMyApiKeys(actor: PublicUser): Promise<PublicApiKey[]> {
    return await this.repo.listUserApiKeys(actor.id);
  }

  async revokeApiKey(actor: PublicUser, keyId: string): Promise<void> {
    const key = await this.repo.getApiKey(keyId);
    if (!key || key.tenantId !== actor.tenantId) {
      throw new Error("API key not found");
    }
    if (key.ownerType === "tenant") {
      if (!hasPermission(actor.permissions, "keys:tenant")) {
        throw new Error("Missing permission: keys:tenant");
      }
    } else if (
      key.userId !== actor.id &&
      !hasPermission(actor.permissions, "users:write")
    ) {
      throw new Error("API key not found");
    }
    await this.repo.revokeApiKey(keyId);
    await this.auditActor(
      actor,
      "api_key.revoke",
      `Revoked ${key.ownerType} API key “${key.name}” (${key.keyPrefix}…)`,
      {
        resourceType: "api_key",
        resourceId: key.id,
        metadata: {
          ownerType: key.ownerType,
          keyPrefix: key.keyPrefix,
          name: key.name,
        },
      },
    );
  }

  getActiveKey(key: ApiKeyRecord): ApiKeyRecord | null {
    if (key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt < new Date().toISOString()) return null;
    return key;
  }

  // --- oauth ---

  async listOAuthProviders(): Promise<Array<{ id: string; label: string }>> {
    return (await this.getOAuthConfig()).providers.map((p) => ({
      id: p.id,
      label: p.label,
    }));
  }

  async getOAuthSettings(): Promise<OAuthSettings> {
    return await settingsFromDb(this.repo, this.opts.publicUrl);
  }

  async updateOAuthSettings(patch: {
    publicUrl?: string | null;
    autoProvision?: boolean;
    defaultRole?: string;
    providers?: Array<{
      id: string;
      enabled?: boolean;
      label?: string;
      clientId?: string;
      clientSecret?: string | null;
      issuer?: string | null;
      authorizationEndpoint?: string | null;
      tokenEndpoint?: string | null;
      userinfoEndpoint?: string | null;
      scopes?: string[];
    }>;
  }): Promise<OAuthSettings> {
    return await applyOAuthSettingsUpdate(this.repo, patch);
  }

  async startOAuth(input: {
    providerId: string;
    redirectTo?: string | null;
    inviteToken?: string | null;
    requestPublicUrl: string;
  }): Promise<{ url: string }> {
    const oauth = await this.getOAuthConfig();
    const provider = getProvider(oauth, input.providerId);
    if (!provider) throw new Error("Unknown or unconfigured OAuth provider");
    const publicUrl = oauth.publicUrl ?? input.requestPublicUrl;
    if (!publicUrl) {
      throw new Error("Set a public URL in Settings → OAuth (or HOST_PUBLIC_URL)");
    }

    const state = newOAuthState();
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    const inviteTokenHash = input.inviteToken
      ? await sha256Hex(input.inviteToken)
      : null;
    await this.repo.createOAuthState({
      state,
      provider: provider.id,
      redirectTo: input.redirectTo ?? "/ui/",
      inviteTokenHash,
      expiresAt,
    });

    return { url: buildAuthorizeUrl(provider, publicUrl, state) };
  }

  async finishOAuth(input: {
    providerId: string;
    code: string;
    state: string;
    requestPublicUrl: string;
  }): Promise<{ user: PublicUser; token: string; expiresAt: string; redirectTo: string }> {
    const oauth = await this.getOAuthConfig();
    const provider = getProvider(oauth, input.providerId);
    if (!provider) throw new Error("Unknown or unconfigured OAuth provider");
    const publicUrl = oauth.publicUrl ?? input.requestPublicUrl;
    if (!publicUrl) {
      throw new Error("Set a public URL in Settings → OAuth (or HOST_PUBLIC_URL)");
    }

    const stored = await this.repo.takeOAuthState(input.state);
    if (!stored || stored.provider !== provider.id) {
      throw new Error("Invalid or expired OAuth state");
    }

    const accessToken = await exchangeCode(provider, publicUrl, input.code);
    const profile = await fetchProfile(provider, accessToken);
    if (!profile.email) {
      throw new Error("OAuth provider did not return an email address");
    }

    const linked = await this.repo.getOAuthAccount(provider.id, profile.subject);
    let userRecord: UserRecord | null = linked
      ? await this.repo.getUser(linked.userId)
      : await this.repo.getUserByEmail(DEFAULT_TENANT_ID, profile.email);

    let acceptedInviteId: string | null = null;
    let acceptedInviteRole: string | null = null;

    if (!userRecord) {
      // Provision via invite or auto-provision
      let role = oauth.defaultRole;
      let grants: ScopeGrant[] = [];
      if (stored.inviteTokenHash) {
        const invite = await this.repo.getInviteByTokenHash(stored.inviteTokenHash);
        if (!invite || invite.revokedAt || invite.acceptedAt) {
          throw new Error("Invite is invalid or already used");
        }
        if (invite.expiresAt < new Date().toISOString()) {
          throw new Error("Invite has expired");
        }
        if (invite.email !== profile.email) {
          throw new Error("Invite email does not match OAuth account");
        }
        role = invite.role;
        grants = invite.grants;
        const created = await this.createUser({
          email: profile.email,
          role,
          displayName: profile.displayName,
          grants,
          tenantId: invite.tenantId,
        });
        await this.repo.markInviteAccepted(invite.id);
        acceptedInviteId = invite.id;
        acceptedInviteRole = invite.role;
        userRecord = (await this.repo.getUser(created.id))!;
      } else if (oauth.autoProvision) {
        const created = await this.createUser({
          email: profile.email,
          role,
          displayName: profile.displayName,
          grants,
        });
        userRecord = (await this.repo.getUser(created.id))!;
      } else {
        throw new Error(
          "No account for this identity. Ask an admin for an invite, or enable auto-provision in Settings → OAuth.",
        );
      }
    }

    if (userRecord.disabled) throw new Error("Account is disabled");

    if (!await this.repo.getOAuthAccount(provider.id, profile.subject)) {
      await this.repo.linkOAuthAccount({
        id: newId("oa"),
        userId: userRecord.id,
        provider: provider.id,
        providerSubject: profile.subject,
        email: profile.email,
      });
    }

    const session = await this.issueSession(userRecord);
    if (acceptedInviteId) {
      await this.auditActor(
        session.user,
        "invite.accept",
        `${session.user.email} accepted invite (${acceptedInviteRole})`,
        {
          resourceType: "invite",
          resourceId: acceptedInviteId,
          metadata: {
            method: "oauth",
            provider: provider.id,
            role: acceptedInviteRole,
          },
        },
      );
    }
    await this.auditActor(session.user, "auth.login", `Signed in as ${session.user.email}`, {
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { method: "oauth", provider: provider.id },
    });
    return {
      ...session,
      redirectTo: stored.redirectTo ?? "/ui/",
    };
  }
}

function cryptoRandom(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

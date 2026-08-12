import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api, ApiError, getSessionToken, setSessionToken } from "../api/client";
import type {
  ApiKey,
  AuditEvent,
  AuthStatus,
  AuthUser,
  InviteRecord,
  OAuthProvider,
  PermissionInfo,
  RoleRecord,
  ScopeGrant,
  UserRole,
} from "../types";

export const useAuthStore = defineStore("auth", () => {
  const ready = ref(false);
  const required = ref(false);
  const user = ref<AuthUser | null>(null);
  const oauthProviders = ref<OAuthProvider[]>([]);
  const bootstrapping = ref(false);

  const isAdmin = computed(
    () =>
      user.value?.role === "admin" ||
      !!user.value?.permissions?.includes("users:write"),
  );
  const isAuthenticated = computed(() => user.value != null);
  const needsLogin = computed(() => required.value && !user.value);

  function can(permission: string): boolean {
    if (!required.value) return true;
    return !!user.value?.permissions?.includes(permission);
  }

  async function hydrate() {
    bootstrapping.value = true;
    try {
      const status = await api<AuthStatus>("/api/auth/status");
      required.value = status.required;
      oauthProviders.value = status.oauthProviders ?? [];
      if (status.user) {
        user.value = status.user;
      } else if (getSessionToken()) {
        try {
          const me = await api<{ user: AuthUser | null }>("/api/auth/me");
          user.value = me.user;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            setSessionToken(null);
            user.value = null;
          } else {
            throw err;
          }
        }
      } else {
        user.value = null;
      }
    } finally {
      ready.value = true;
      bootstrapping.value = false;
    }
  }

  async function login(email: string, password: string) {
    const res = await api<{
      user: AuthUser;
      token: string;
      expiresAt: string;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setSessionToken(res.token);
    user.value = res.user;
    required.value = true;
    return res.user;
  }

  function acceptSessionToken(token: string, nextUser?: AuthUser | null) {
    setSessionToken(token);
    if (nextUser) user.value = nextUser;
    required.value = true;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* still clear local session */
    }
    setSessionToken(null);
    user.value = null;
    await hydrate();
  }

  async function listUsers() {
    const { users } = await api<{ users: AuthUser[] }>("/api/auth/users");
    return users;
  }

  async function createUser(input: {
    email: string;
    password: string;
    role: UserRole;
    displayName?: string | null;
    grants?: ScopeGrant[];
  }) {
    const { user: created } = await api<{ user: AuthUser }>("/api/auth/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return created;
  }

  async function updateUser(
    id: string,
    patch: {
      role?: UserRole;
      displayName?: string | null;
      disabled?: boolean;
      grants?: ScopeGrant[];
      password?: string;
      email?: string;
    },
  ) {
    const { user: updated } = await api<{ user: AuthUser }>(
      `/api/auth/users/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    if (user.value?.id === id) user.value = updated;
    return updated;
  }

  async function updateMyProfile(patch: {
    displayName?: string | null;
    email?: string;
    currentPassword?: string;
    password?: string;
  }) {
    const { user: updated } = await api<{ user: AuthUser }>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    user.value = updated;
    return updated;
  }

  async function deleteUser(id: string) {
    await api(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function listRoles() {
    const { roles } = await api<{ roles: RoleRecord[] }>("/api/auth/roles");
    return roles;
  }

  async function listPermissions() {
    const { permissions } = await api<{ permissions: PermissionInfo[] }>(
      "/api/auth/permissions",
    );
    return permissions;
  }

  async function createRole(input: {
    slug: string;
    name: string;
    description?: string | null;
    permissions: string[];
  }) {
    const { role } = await api<{ role: RoleRecord }>("/api/auth/roles", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return role;
  }

  async function updateRole(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      permissions?: string[];
    },
  ) {
    const { role } = await api<{ role: RoleRecord }>(
      `/api/auth/roles/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    return role;
  }

  async function deleteRole(id: string) {
    await api(`/api/auth/roles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function listInvites() {
    const { invites } = await api<{ invites: InviteRecord[] }>(
      "/api/auth/invites",
    );
    return invites;
  }

  async function createInvite(input: {
    email: string;
    role?: string;
    grants?: ScopeGrant[];
    expiresInDays?: number;
  }) {
    const { invite } = await api<{ invite: InviteRecord }>(
      "/api/auth/invites",
      { method: "POST", body: JSON.stringify(input) },
    );
    return invite;
  }

  async function revokeInvite(id: string) {
    await api(`/api/auth/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function previewInvite(token: string) {
    return api<{
      invite: {
        email: string;
        role: string;
        grants: ScopeGrant[];
        expiresAt: string;
      };
      oauthProviders: OAuthProvider[];
    }>(`/api/auth/invites/preview/${encodeURIComponent(token)}`);
  }

  async function acceptInvite(input: {
    token: string;
    password: string;
    displayName?: string | null;
  }) {
    const res = await api<{
      user: AuthUser;
      token: string;
      expiresAt: string;
    }>("/api/auth/invites/accept", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setSessionToken(res.token);
    user.value = res.user;
    required.value = true;
    return res.user;
  }

  async function listMyKeys() {
    const { keys } = await api<{ keys: ApiKey[] }>("/api/auth/keys");
    return keys;
  }

  async function createMyKey(input: {
    name: string;
    scopes: ScopeGrant[];
    expiresAt?: string | null;
  }) {
    return api<{ key: ApiKey; secret: string }>("/api/auth/keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function revokeMyKey(id: string) {
    await api(`/api/auth/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function listTenantKeys() {
    const { keys } = await api<{ keys: ApiKey[] }>("/api/auth/tenant-keys");
    return keys;
  }

  async function createTenantKey(input: {
    name: string;
    scopes?: ScopeGrant[];
    expiresAt?: string | null;
  }) {
    return api<{ key: ApiKey; secret: string }>("/api/auth/tenant-keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function revokeTenantKey(id: string) {
    await api(`/api/auth/tenant-keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function listAudit(opts?: {
    limit?: number;
    offset?: number;
    action?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
  }) {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    if (opts?.action) q.set("action", opts.action);
    if (opts?.resourceType) q.set("resourceType", opts.resourceType);
    if (opts?.resourceId) q.set("resourceId", opts.resourceId);
    const qs = q.toString();
    return api<{ events: AuditEvent[]; total: number }>(
      `/api/audit${qs ? `?${qs}` : ""}`,
    );
  }

  async function listSessions() {
    return api<{
      sessions: Array<{
        id: string;
        createdAt: string;
        expiresAt: string;
        current: boolean;
      }>;
    }>("/api/auth/sessions");
  }

  async function revokeSession(id: string) {
    await api(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async function revokeOtherSessions() {
    return api<{ ok: boolean; revoked: number }>("/api/auth/sessions", {
      method: "DELETE",
    });
  }

  function oauthStartUrl(
    providerId: string,
    opts?: { invite?: string; redirect?: string },
  ) {
    const url = new URL(
      `/api/auth/oauth/${encodeURIComponent(providerId)}/start`,
      window.location.origin,
    );
    // Backend redirects to absolute /ui/... paths after IdP callback.
    let redirectPath = opts?.redirect || "/ui/";
    if (!redirectPath.startsWith("/ui")) {
      redirectPath = redirectPath.startsWith("/")
        ? `/ui${redirectPath}`
        : "/ui/";
    }
    url.searchParams.set("redirect", redirectPath);
    if (opts?.invite) url.searchParams.set("invite", opts.invite);
    return url.toString();
  }

  return {
    ready,
    required,
    user,
    oauthProviders,
    bootstrapping,
    isAdmin,
    isAuthenticated,
    needsLogin,
    can,
    hydrate,
    login,
    acceptSessionToken,
    logout,
    listUsers,
    createUser,
    updateUser,
    updateMyProfile,
    deleteUser,
    listRoles,
    listPermissions,
    createRole,
    updateRole,
    deleteRole,
    listInvites,
    createInvite,
    revokeInvite,
    previewInvite,
    acceptInvite,
    listMyKeys,
    createMyKey,
    revokeMyKey,
    listTenantKeys,
    createTenantKey,
    revokeTenantKey,
    listAudit,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    oauthStartUrl,
  };
});

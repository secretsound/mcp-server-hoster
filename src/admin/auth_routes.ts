import { Hono } from "hono";
import type { ScopeGrant } from "../auth/scopes.ts";
import {
  actor,
  type AuthEnv,
  requirePermission,
  requireSession,
} from "../auth/middleware.ts";
import type { AuthService } from "../auth/service.ts";
import { createRateLimiter } from "../auth/rate_limit.ts";

function requestPublicUrl(c: { req: { url: string; header: (n: string) => string | undefined } }): string {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return new URL(c.req.url).origin;
}

function clientKey(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local";
}

export function createAuthRoutes(auth: AuthService): Hono<AuthEnv> {
  const api = new Hono<AuthEnv>();
  const loginLimit = createRateLimiter({ windowMs: 60_000, max: 10 });
  const inviteLimit = createRateLimiter({ windowMs: 60_000, max: 20 });

  api.get("/status", async (c) =>
    c.json({
      required: await auth.isRequired(),
      user: actor(c),
      oauthProviders: await auth.listOAuthProviders(),
    }));

  api.post("/login", async (c) => {
    const limited = loginLimit(`${clientKey(c)}:login`);
    if (!limited.ok) {
      c.header("Retry-After", String(limited.retryAfterSec));
      return c.json({ error: "Too many login attempts — try again shortly" }, 429);
    }
    try {
      const body = await c.req.json<{ email?: string; password?: string }>();
      if (!body.email || !body.password) {
        return c.json({ error: "email and password are required" }, 400);
      }
      const result = await auth.login(body.email, body.password);
      c.header(
        "set-cookie",
        `mcp_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      return c.json({
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 401);
    }
  });

  api.get("/sessions", requireSession(), async (c) => {
    const me = actor(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    const principal = c.get("auth");
    const currentId = principal?.kind === "session" ? principal.sessionId : null;
    return c.json({ sessions: await auth.listMySessions(me, currentId) });
  });

  api.delete("/sessions", requireSession(), async (c) => {
    const me = actor(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    const header = c.req.header("authorization");
    const token = header?.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    if (!token) return c.json({ error: "Bearer token required" }, 400);
    const revoked = await auth.revokeOtherSessions(me, token);
    return c.json({ ok: true, revoked });
  });

  api.delete("/sessions/:id", requireSession(), async (c) => {
    const me = actor(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    try {
      await auth.revokeSession(me, c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  api.post("/logout", requireSession(), async (c) => {
    const header = c.req.header("authorization");
    const token = header?.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : null;
    if (token) await auth.logout(token);
    c.header(
      "set-cookie",
      "mcp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return c.json({ ok: true });
  });

  api.get("/me", requireSession(), async (c) => {
    const user = actor(c);
    if (!user && await auth.isRequired()) {
      return c.json({ error: "Authentication required" }, 401);
    }
    return c.json({ user });
  });

  // --- users ---

  api.get("/users", requirePermission("users:read"), async (c) => {
    const me = actor(c);
    return c.json({ users: await auth.listUsers(me?.tenantId ?? "default") });
  });

  api.post("/users", requirePermission("users:write"), async (c) => {
    try {
      const body = await c.req.json<{
        email?: string;
        password?: string;
        role?: string;
        displayName?: string | null;
        grants?: ScopeGrant[];
      }>();
      if (!body.email || !body.password) {
        return c.json({ error: "email and password are required" }, 400);
      }
      const user = await auth.createUser({
        email: body.email,
        password: body.password,
        role: body.role ?? "user",
        displayName: body.displayName,
        grants: body.grants,
        tenantId: actor(c)?.tenantId,
      });
      return c.json({ user }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.patch("/users/:id", requirePermission("users:write"), async (c) => {
    try {
      const body = await c.req.json<{
        role?: string;
        displayName?: string | null;
        disabled?: boolean;
        grants?: ScopeGrant[];
        password?: string;
      }>();
      const user = await auth.updateUser(c.req.param("id"), body);
      return c.json({ user });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/users/:id", requirePermission("users:write"), async (c) => {
    try {
      await auth.deleteUser(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // --- roles ---

  api.get("/permissions", requirePermission("roles:read"), async (c) =>
    c.json({ permissions: await auth.listPermissionCatalog() }));

  api.get("/roles", requirePermission("roles:read"), async (c) => {
    const me = actor(c);
    return c.json({ roles: await auth.listRoles(me?.tenantId ?? "default") });
  });

  api.post("/roles", requirePermission("roles:write"), async (c) => {
    try {
      const body = await c.req.json<{
        slug?: string;
        name?: string;
        description?: string | null;
        permissions?: string[];
      }>();
      if (!body.slug || !body.name) {
        return c.json({ error: "slug and name are required" }, 400);
      }
      const role = await auth.createRole({
        tenantId: actor(c)?.tenantId,
        slug: body.slug,
        name: body.name,
        description: body.description,
        permissions: body.permissions ?? [],
      });
      return c.json({ role }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.patch("/roles/:id", requirePermission("roles:write"), async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        description?: string | null;
        permissions?: string[];
      }>();
      const role = await auth.updateRole(c.req.param("id"), body);
      return c.json({ role });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/roles/:id", requirePermission("roles:write"), async (c) => {
    try {
      await auth.deleteRole(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // --- invites ---

  api.get("/invites", requirePermission("invites:write"), async (c) => {
    const me = actor(c);
    return c.json({ invites: await auth.listInvites(me?.tenantId ?? "default") });
  });

  api.post("/invites", requirePermission("invites:write"), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      const body = await c.req.json<{
        email?: string;
        role?: string;
        grants?: ScopeGrant[];
        expiresInDays?: number;
      }>();
      if (!body.email) return c.json({ error: "email is required" }, 400);
      const invite = await auth.createInvite({
        actor: me,
        email: body.email,
        role: body.role,
        grants: body.grants,
        expiresInDays: body.expiresInDays,
      });
      return c.json({ invite }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/invites/:id", requirePermission("invites:write"), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      await auth.revokeInvite(me, c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.get("/invites/preview/:token", async (c) => {
    try {
      const preview = await auth.getInvitePreview(c.req.param("token"));
      return c.json({ invite: preview, oauthProviders: await auth.listOAuthProviders() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.post("/invites/accept", async (c) => {
    const limited = inviteLimit(`${clientKey(c)}:invite`);
    if (!limited.ok) {
      c.header("Retry-After", String(limited.retryAfterSec));
      return c.json({ error: "Too many invite attempts — try again shortly" }, 429);
    }
    try {
      const body = await c.req.json<{
        token?: string;
        password?: string;
        displayName?: string | null;
      }>();
      if (!body.token || !body.password) {
        return c.json({ error: "token and password are required" }, 400);
      }
      const result = await auth.acceptInvite({
        token: body.token,
        password: body.password,
        displayName: body.displayName,
      });
      c.header(
        "set-cookie",
        `mcp_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // --- API keys ---

  api.get("/keys", requireSession(), async (c) => {
    const me = actor(c);
    if (!me) return c.json({ keys: [] });
    return c.json({ keys: await auth.listMyApiKeys(me) });
  });

  api.post("/keys", requireSession(), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      const body = await c.req.json<{
        name?: string;
        scopes?: ScopeGrant[];
        expiresAt?: string | null;
      }>();
      if (!body.name) return c.json({ error: "name is required" }, 400);
      if (!body.scopes) return c.json({ error: "scopes are required" }, 400);
      const result = await auth.createUserApiKey({
        actor: me,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
      });
      return c.json({ key: result.key, secret: result.secret }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/keys/:id", requireSession(), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      await auth.revokeApiKey(me, c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.get("/tenant-keys", requirePermission("keys:tenant"), async (c) => {
    const me = actor(c);
    if (!me) return c.json({ keys: [] });
    return c.json({ keys: await auth.listTenantApiKeys(me) });
  });

  api.post("/tenant-keys", requirePermission("keys:tenant"), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      const body = await c.req.json<{
        name?: string;
        scopes?: ScopeGrant[];
        expiresAt?: string | null;
      }>();
      if (!body.name) return c.json({ error: "name is required" }, 400);
      const result = await auth.createTenantApiKey({
        actor: me,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
      });
      return c.json({ key: result.key, secret: result.secret }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.delete("/tenant-keys/:id", requirePermission("keys:tenant"), async (c) => {
    try {
      const me = actor(c);
      if (!me) return c.json({ error: "Authentication required" }, 401);
      await auth.revokeApiKey(me, c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // --- oauth settings (DB) ---

  api.get("/oauth/settings", requirePermission("settings:read"), async (c) =>
    c.json({ oauth: await auth.getOAuthSettings() }));

  api.put("/oauth/settings", requirePermission("settings:write"), async (c) => {
    try {
      const body = await c.req.json<{
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
      }>();
      const oauth = await auth.updateOAuthSettings(body);
      return c.json({ oauth });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // --- oauth ---

  api.get("/oauth/:provider/start", async (c) => {
    try {
      const { url } = await auth.startOAuth({
        providerId: c.req.param("provider"),
        redirectTo: c.req.query("redirect") ?? "/ui/",
        inviteToken: c.req.query("invite") ?? null,
        requestPublicUrl: requestPublicUrl(c),
      });
      return c.redirect(url);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  api.get("/oauth/:provider/callback", async (c) => {
    try {
      const err = c.req.query("error");
      if (err) {
        return c.redirect(
          `/ui/login?error=${encodeURIComponent(err)}`,
        );
      }
      const code = c.req.query("code");
      const state = c.req.query("state");
      if (!code || !state) {
        return c.json({ error: "code and state are required" }, 400);
      }
      const result = await auth.finishOAuth({
        providerId: c.req.param("provider"),
        code,
        state,
        requestPublicUrl: requestPublicUrl(c),
      });
      c.header(
        "set-cookie",
        `mcp_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      const dest = new URL(result.redirectTo, requestPublicUrl(c));
      // Prefer SPA oauth callback so localStorage can store the token.
      const ui = new URL("/ui/oauth/callback", requestPublicUrl(c));
      ui.searchParams.set("token", result.token);
      ui.searchParams.set("redirect", dest.pathname + dest.search);
      return c.redirect(ui.toString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.redirect(`/ui/login?error=${encodeURIComponent(msg)}`);
    }
  });

  return api;
}

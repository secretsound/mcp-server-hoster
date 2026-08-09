import type { Context, MiddlewareHandler, Next } from "hono";
import type { AuthPrincipal, AuthService } from "./service.ts";
import type { PublicUser } from "../db/repos/auth.ts";
import { hasPermission, type Permission } from "./permissions.ts";

export type AuthEnv = {
  Variables: {
    auth: AuthPrincipal | null;
    authService: AuthService;
  };
};

function extractBearer(c: Context): string | null {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookie = c.req.header("cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)mcp_session=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export function createAuthMiddleware(auth: AuthService): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    c.set("authService", auth);
    const token = extractBearer(c);
    const principal = token ? await auth.resolveBearer(token) : null;
    c.set("auth", principal);
    await next();
  };
}

/** Require a logged-in user session (not an API key). */
export function requireSession(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const auth = c.get("authService");
    if (!await auth.isRequired()) {
      await next();
      return;
    }
    const principal = c.get("auth");
    if (!principal || principal.kind !== "session") {
      return c.json({ error: "Authentication required" }, 401);
    }
    await next();
  };
}

export function requirePermission(
  ...needed: Permission[]
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const auth = c.get("authService");
    if (!await auth.isRequired()) {
      await next();
      return;
    }
    const principal = c.get("auth");
    if (!principal || principal.kind !== "session") {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (!hasPermission(principal.user.permissions, needed)) {
      return c.json({
        error: `Missing permission: ${needed.join(" or ")}`,
      }, 403);
    }
    await next();
  };
}

/** @deprecated Prefer requirePermission — kept as alias for users:write. */
export function requireAdmin(): MiddlewareHandler<AuthEnv> {
  return requirePermission("users:write");
}

/** Session required when auth is on; API keys are rejected for admin API. */
export async function requireSessionUser(
  c: Context<AuthEnv>,
  next: Next,
): Promise<Response | void> {
  const auth = c.get("authService");
  if (!await auth.isRequired()) {
    await next();
    return;
  }
  const principal = c.get("auth");
  if (!principal) {
    return c.json({ error: "Authentication required" }, 401);
  }
  if (principal.kind !== "session") {
    return c.json({
      error: "Use a user session for the admin API; API keys are for MCP only",
    }, 403);
  }
  await next();
}

export function actor(c: Context<AuthEnv>): PublicUser | null {
  const principal = c.get("auth");
  if (principal?.kind === "session") return principal.user;
  return null;
}

export async function actorCan(
  c: Context<AuthEnv>,
  permission: Permission,
): Promise<boolean> {
  const auth = c.get("authService");
  if (!await auth.isRequired()) return true;
  return hasPermission(actor(c)?.permissions, permission);
}

/** True when the actor has full MCP / broad admin-style access. */
export async function isAdminActor(c: Context<AuthEnv>): Promise<boolean> {
  return (await actorCan(c, "mcp:full")) || (await actorCan(c, "servers:write"));
}

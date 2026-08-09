import { Hono } from "hono";
import type { AuthEnv } from "./middleware.ts";
import { actor, createAuthMiddleware } from "./middleware.ts";
import type { AuthService } from "./service.ts";
import {
  authorizationServerMetadata,
  McpOAuthError,
  protectedResourceMetadata,
} from "./mcp_oauth.ts";

async function baseUrl(c: {
  req: { url: string; header: (n: string) => string | undefined };
}, auth: AuthService): Promise<string> {
  const configured = (await auth.getOAuthConfig()).publicUrl;
  if (configured) return configured.replace(/\/$/, "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return new URL(c.req.url).origin;
}

function oauthError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (err instanceof McpOAuthError) {
    return c.json(
      { error: err.code, error_description: err.message },
      err.status as 400,
    );
  }
  return c.json(
    {
      error: "server_error",
      error_description: err instanceof Error ? err.message : String(err),
    },
    500,
  );
}

async function parseTokenBody(
  c: {
    req: {
      header: (n: string) => string | undefined;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    };
  },
): Promise<Record<string, string>> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await c.req.json() as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (v != null) out[k] = String(v);
    }
    return out;
  }
  const text = await c.req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

/** Register MCP OAuth discovery + AS endpoints on the root app (no catch-all). */
export function mountMcpOAuthRoutes(app: Hono, auth: AuthService): void {
  const mcpOAuth = () => auth.mcpOAuth;

  app.get("/.well-known/oauth-protected-resource", async (c) => {
    return c.json(protectedResourceMetadata(await baseUrl(c, auth)));
  });
  app.get("/.well-known/oauth-protected-resource/mcp", async (c) => {
    return c.json(protectedResourceMetadata(await baseUrl(c, auth)));
  });
  app.get("/.well-known/oauth-authorization-server", async (c) => {
    return c.json(authorizationServerMetadata(await baseUrl(c, auth)));
  });
  app.get("/.well-known/openid-configuration", async (c) => {
    return c.json(authorizationServerMetadata(await baseUrl(c, auth)));
  });

  const oauth = new Hono<AuthEnv>();
  oauth.use("*", createAuthMiddleware(auth));

  oauth.post("/register", async (c) => {
    if (!await auth.isRequired()) {
      return c.json({
        error: "temporarily_unavailable",
        error_description: "Auth is disabled on this host",
      }, 503);
    }
    try {
      const body = await c.req.json().catch(() => ({}));
      const registered = await mcpOAuth().registerClient(
        body as {
          client_name?: string;
          redirect_uris?: string[];
          grant_types?: string[];
          response_types?: string[];
          token_endpoint_auth_method?: string;
        },
      );
      return c.json(registered, 201);
    } catch (err) {
      return oauthError(c, err);
    }
  });

  oauth.get("/authorize", async (c) => {
    if (!await auth.isRequired()) {
      return c.json({
        error: "temporarily_unavailable",
        error_description: "Auth is disabled on this host",
      }, 503);
    }
    const q = c.req.query();
    const clientId = q.client_id ?? "";
    const redirectUri = q.redirect_uri ?? "";
    const state = q.state;

    try {
      const { requestId } = await mcpOAuth().beginAuthorize({
        clientId,
        redirectUri,
        responseType: q.response_type ?? "",
        scope: q.scope,
        state,
        codeChallenge: q.code_challenge,
        codeChallengeMethod: q.code_challenge_method,
        resource: q.resource,
      });
      const root = await baseUrl(c, auth);
      const consent = new URL(`${root}/ui/oauth/consent`);
      consent.searchParams.set("request", requestId);
      return c.redirect(consent.toString(), 302);
    } catch (err) {
      if (err instanceof McpOAuthError) {
        const bounced = await mcpOAuth().safeRedirectError({
          clientId,
          redirectUri,
          state,
          error: err.code,
          errorDescription: err.message,
        });
        if (bounced) return c.redirect(bounced, 302);
        return c.json(
          { error: err.code, error_description: err.message },
          err.status as 400,
        );
      }
      return oauthError(c, err);
    }
  });

  oauth.get("/authorize/request/:id", async (c) => {
    const req = await mcpOAuth().getAuthorizeRequest(c.req.param("id"));
    if (!req) {
      return c.json({
        error: "invalid_request",
        error_description: "Unknown or expired authorization request",
      }, 404);
    }
    const user = actor(c);
    return c.json({
      request: req,
      user,
      authenticated: user != null,
    });
  });

  oauth.post("/authorize/decide", async (c) => {
    const user = actor(c);
    if (!user) {
      return c.json({
        error: "login_required",
        error_description: "Sign in to authorize this client",
      }, 401);
    }
    try {
      const body = await c.req.json<{
        requestId?: string;
        approve?: boolean;
      }>();
      if (!body.requestId) {
        return c.json({
          error: "invalid_request",
          error_description: "requestId is required",
        }, 400);
      }
      const result = await mcpOAuth().decideAuthorize({
        requestId: body.requestId,
        user,
        approve: body.approve !== false,
      });
      return c.json(result);
    } catch (err) {
      return oauthError(c, err);
    }
  });

  oauth.post("/token", async (c) => {
    try {
      const body = await parseTokenBody(c);
      const tokens = await mcpOAuth().exchangeToken({
        grantType: body.grant_type,
        code: body.code,
        redirectUri: body.redirect_uri,
        clientId: body.client_id,
        codeVerifier: body.code_verifier,
        refreshToken: body.refresh_token,
        resource: body.resource,
        scope: body.scope,
      });
      return c.json(tokens);
    } catch (err) {
      return oauthError(c, err);
    }
  });

  oauth.post("/revoke", async (c) => {
    try {
      const body = await parseTokenBody(c);
      const token = body.token;
      if (!token) {
        return c.json({
          error: "invalid_request",
          error_description: "token is required",
        }, 400);
      }
      await mcpOAuth().revoke(token);
      return c.body(null, 200);
    } catch (err) {
      return oauthError(c, err);
    }
  });

  app.route("/oauth", oauth);
}

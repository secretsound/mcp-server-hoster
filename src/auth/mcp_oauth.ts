/**
 * Host-as-authorization-server for MCP clients (OAuth 2.1 + PKCE + DCR).
 * Issues mca_/mcr_ tokens bound to a logged-in user's tool grants.
 * Tenant/user mch_ API keys remain available for M2M / alternate auth.
 */
import type { AuthRepository, PublicUser } from "../db/repos/auth.ts";
import {
  generateOAuthAccessToken,
  generateOAuthAuthCode,
  generateOAuthRefreshToken,
  newId,
  randomToken,
  sha256Base64Url,
  sha256Hex,
} from "./crypto.ts";
import type { ScopeGrant } from "./scopes.ts";

export const MCP_OAUTH_SCOPE = "mcp";
export const ACCESS_TTL_SEC = 60 * 60; // 1h
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30d
const AUTH_REQUEST_TTL_MS = 1000 * 60 * 15;
const AUTH_CODE_TTL_MS = 1000 * 60 * 5;

export type McpOAuthPublicRequest = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string;
  resource: string | null;
  state: string | null;
  expiresAt: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export class McpOAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function normalizeScope(scope: string | null | undefined): string {
  const parts = (scope ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return MCP_OAUTH_SCOPE;
  // Only mcp (and legacy aliases) are recognized; always grant mcp.
  const allowed = new Set(["mcp", "mcp:tools", "mcp:resources"]);
  for (const p of parts) {
    if (!allowed.has(p)) {
      throw new McpOAuthError("invalid_scope", `Unsupported scope: ${p}`);
    }
  }
  return MCP_OAUTH_SCOPE;
}

function redirectUriAllowed(clientUris: string[], uri: string): boolean {
  return clientUris.includes(uri);
}

export function protectedResourceMetadata(baseUrl: string) {
  const root = baseUrl.replace(/\/$/, "");
  return {
    resource: `${root}/mcp`,
    authorization_servers: [root],
    scopes_supported: [MCP_OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${root}/ui/connect`,
  };
}

export function authorizationServerMetadata(baseUrl: string) {
  const root = baseUrl.replace(/\/$/, "");
  return {
    issuer: root,
    authorization_endpoint: `${root}/oauth/authorize`,
    token_endpoint: `${root}/oauth/token`,
    registration_endpoint: `${root}/oauth/register`,
    revocation_endpoint: `${root}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [MCP_OAUTH_SCOPE],
    resource_indicators_supported: true,
  };
}

export class McpOAuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly ceilingFor: (user: PublicUser) => Promise<ScopeGrant[]>,
  ) {}

  async registerClient(input: {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  }): Promise<{
    client_id: string;
    client_name: string;
    redirect_uris: string[];
    grant_types: string[];
    response_types: string[];
    token_endpoint_auth_method: string;
    client_id_issued_at: number;
  }> {
    const redirectUris = input.redirect_uris ?? [];
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new McpOAuthError(
        "invalid_client_metadata",
        "redirect_uris is required",
      );
    }
    for (const uri of redirectUris) {
      try {
        new URL(uri); // http(s) or custom schemes (cursor://, vscode://, …)
      } catch {
        throw new McpOAuthError(
          "invalid_redirect_uri",
          `Invalid redirect_uri: ${uri}`,
        );
      }
    }

    const grantTypes = input.grant_types?.length
      ? input.grant_types
      : ["authorization_code", "refresh_token"];
    const responseTypes = input.response_types?.length
      ? input.response_types
      : ["code"];
    const authMethod = input.token_endpoint_auth_method ?? "none";
    if (authMethod !== "none" && authMethod !== "client_secret_post") {
      throw new McpOAuthError(
        "invalid_client_metadata",
        "Unsupported token_endpoint_auth_method",
      );
    }

    const clientId = `mco_${randomToken(16)}`;
    const clientName = input.client_name?.trim() || "MCP Client";
    await this.repo.createMcpOAuthClient({
      clientId,
      clientSecretHash: null,
      clientName,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: authMethod,
    });

    return {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: authMethod,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
  }

  /** Redirect OAuth errors to a registered redirect_uri (open-redirect safe). */
  async safeRedirectError(input: {
    clientId: string;
    redirectUri: string;
    state?: string | null;
    error: string;
    errorDescription: string;
  }): Promise<string | null> {
    if (!input.clientId || !input.redirectUri) return null;
    if (input.error === "invalid_client") return null;
    const client = await this.repo.getMcpOAuthClient(input.clientId);
    if (!client || !redirectUriAllowed(client.redirectUris, input.redirectUri)) {
      return null;
    }
    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set("error", input.error);
    redirect.searchParams.set("error_description", input.errorDescription);
    if (input.state) redirect.searchParams.set("state", input.state);
    return redirect.toString();
  }

  /** Validate authorize params and create a pending consent request. */
  async beginAuthorize(input: {
    clientId: string;
    redirectUri: string;
    responseType: string;
    scope?: string | null;
    state?: string | null;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
    resource?: string | null;
  }): Promise<{ requestId: string }> {
    const client = await this.repo.getMcpOAuthClient(input.clientId);
    if (!client) {
      throw new McpOAuthError("invalid_client", "Unknown client_id", 400);
    }
    if (input.responseType !== "code") {
      throw new McpOAuthError(
        "unsupported_response_type",
        "Only response_type=code is supported",
      );
    }
    if (!redirectUriAllowed(client.redirectUris, input.redirectUri)) {
      throw new McpOAuthError(
        "invalid_request",
        "redirect_uri is not registered for this client",
      );
    }
    if (!input.codeChallenge) {
      throw new McpOAuthError(
        "invalid_request",
        "code_challenge is required (PKCE)",
      );
    }
    const method = input.codeChallengeMethod || "S256";
    if (method !== "S256") {
      throw new McpOAuthError(
        "invalid_request",
        "Only code_challenge_method=S256 is supported",
      );
    }
    const scope = normalizeScope(input.scope);
    const id = newId("oareq");
    await this.repo.createMcpOAuthAuthRequest({
      id,
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      scope,
      state: input.state ?? null,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: method,
      resource: input.resource?.trim() || null,
      expiresAt: isoAfter(AUTH_REQUEST_TTL_MS),
    });
    return { requestId: id };
  }

  async getAuthorizeRequest(id: string): Promise<McpOAuthPublicRequest | null> {
    const req = await this.repo.getMcpOAuthAuthRequest(id);
    if (!req) return null;
    if (req.expiresAt < new Date().toISOString()) {
      await this.repo.deleteMcpOAuthAuthRequest(id);
      return null;
    }
    const client = await this.repo.getMcpOAuthClient(req.clientId);
    if (!client) return null;
    return {
      id: req.id,
      clientId: req.clientId,
      clientName: client.clientName,
      redirectUri: req.redirectUri,
      scope: req.scope || MCP_OAUTH_SCOPE,
      resource: req.resource,
      state: req.state,
      expiresAt: req.expiresAt,
    };
  }

  async decideAuthorize(input: {
    requestId: string;
    user: PublicUser;
    approve: boolean;
  }): Promise<{ redirectTo: string }> {
    const req = await this.repo.getMcpOAuthAuthRequest(input.requestId);
    if (!req || req.expiresAt < new Date().toISOString()) {
      throw new McpOAuthError("invalid_request", "Authorization request expired");
    }
    await this.repo.deleteMcpOAuthAuthRequest(input.requestId);

    const redirect = new URL(req.redirectUri);
    if (!input.approve) {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set(
        "error_description",
        "The user denied the authorization request",
      );
      if (req.state) redirect.searchParams.set("state", req.state);
      return { redirectTo: redirect.toString() };
    }

    if (input.user.disabled) {
      throw new McpOAuthError("access_denied", "User is disabled", 403);
    }

    const code = generateOAuthAuthCode();
    const codeHash = await sha256Hex(code);
    await this.repo.createMcpOAuthCode({
      id: newId("oac"),
      codeHash,
      clientId: req.clientId,
      userId: input.user.id,
      redirectUri: req.redirectUri,
      scope: req.scope,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
      resource: req.resource,
      expiresAt: isoAfter(AUTH_CODE_TTL_MS),
    });

    redirect.searchParams.set("code", code);
    if (req.state) redirect.searchParams.set("state", req.state);
    return { redirectTo: redirect.toString() };
  }

  async exchangeToken(input: {
    grantType: string;
    code?: string | null;
    redirectUri?: string | null;
    clientId?: string | null;
    codeVerifier?: string | null;
    refreshToken?: string | null;
    resource?: string | null;
    scope?: string | null;
  }): Promise<TokenResponse> {
    if (input.grantType === "authorization_code") {
      return await this.exchangeAuthorizationCode(input);
    }
    if (input.grantType === "refresh_token") {
      return await this.exchangeRefreshToken(input);
    }
    throw new McpOAuthError(
      "unsupported_grant_type",
      "Supported: authorization_code, refresh_token",
    );
  }

  private async exchangeAuthorizationCode(input: {
    code?: string | null;
    redirectUri?: string | null;
    clientId?: string | null;
    codeVerifier?: string | null;
    resource?: string | null;
  }): Promise<TokenResponse> {
    if (!input.code || !input.redirectUri || !input.clientId ||
      !input.codeVerifier) {
      throw new McpOAuthError(
        "invalid_request",
        "code, redirect_uri, client_id, and code_verifier are required",
      );
    }
    const client = await this.repo.getMcpOAuthClient(input.clientId);
    if (!client) {
      throw new McpOAuthError("invalid_client", "Unknown client_id", 401);
    }

    const codeHash = await sha256Hex(input.code);
    const stored = await this.repo.getMcpOAuthCodeByHash(codeHash);
    if (!stored || stored.consumedAt) {
      throw new McpOAuthError("invalid_grant", "Invalid authorization code");
    }
    if (stored.expiresAt < new Date().toISOString()) {
      throw new McpOAuthError("invalid_grant", "Authorization code expired");
    }
    if (stored.clientId !== input.clientId) {
      throw new McpOAuthError("invalid_grant", "client_id mismatch");
    }
    if (stored.redirectUri !== input.redirectUri) {
      throw new McpOAuthError("invalid_grant", "redirect_uri mismatch");
    }

    const challenge = await sha256Base64Url(input.codeVerifier);
    if (challenge !== stored.codeChallenge) {
      throw new McpOAuthError("invalid_grant", "PKCE verification failed");
    }

    await this.repo.consumeMcpOAuthCode(stored.id);

    const resource = input.resource?.trim() || stored.resource;
    return await this.issueTokens({
      clientId: stored.clientId,
      userId: stored.userId,
      scope: stored.scope || MCP_OAUTH_SCOPE,
      resource,
    });
  }

  private async exchangeRefreshToken(input: {
    refreshToken?: string | null;
    clientId?: string | null;
    resource?: string | null;
    scope?: string | null;
  }): Promise<TokenResponse> {
    if (!input.refreshToken) {
      throw new McpOAuthError("invalid_request", "refresh_token is required");
    }
    if (!input.refreshToken.startsWith("mcr_")) {
      throw new McpOAuthError("invalid_grant", "Invalid refresh token");
    }
    const hash = await sha256Hex(input.refreshToken);
    const stored = await this.repo.getMcpOAuthTokenByRefreshHash(hash);
    if (!stored || stored.revokedAt) {
      throw new McpOAuthError("invalid_grant", "Invalid refresh token");
    }
    if (
      stored.refreshExpiresAt &&
      stored.refreshExpiresAt < new Date().toISOString()
    ) {
      throw new McpOAuthError("invalid_grant", "Refresh token expired");
    }
    if (input.clientId && stored.clientId !== input.clientId) {
      throw new McpOAuthError("invalid_grant", "client_id mismatch");
    }

    const resource = input.resource?.trim() || stored.resource;
    const access = generateOAuthAccessToken();
    const refresh = generateOAuthRefreshToken();
    const accessHash = await sha256Hex(access);
    const refreshHash = await sha256Hex(refresh);
    await this.repo.rotateMcpOAuthToken({
      id: stored.id,
      accessTokenHash: accessHash,
      refreshTokenHash: refreshHash,
      accessExpiresAt: isoAfter(ACCESS_TTL_SEC * 1000),
      refreshExpiresAt: isoAfter(REFRESH_TTL_SEC * 1000),
    });

    // resource update on refresh is allowed if provided
    if (resource !== stored.resource) {
      // keep original resource binding — recreate via revoke+issue if needed
      void resource;
    }

    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: stored.scope || MCP_OAUTH_SCOPE,
    };
  }

  private async issueTokens(input: {
    clientId: string;
    userId: string;
    scope: string;
    resource: string | null;
  }): Promise<TokenResponse> {
    const access = generateOAuthAccessToken();
    const refresh = generateOAuthRefreshToken();
    const accessHash = await sha256Hex(access);
    const refreshHash = await sha256Hex(refresh);
    await this.repo.createMcpOAuthToken({
      id: newId("oat"),
      accessTokenHash: accessHash,
      refreshTokenHash: refreshHash,
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      resource: input.resource,
      accessExpiresAt: isoAfter(ACCESS_TTL_SEC * 1000),
      refreshExpiresAt: isoAfter(REFRESH_TTL_SEC * 1000),
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: input.scope,
    };
  }

  async resolveAccessToken(token: string): Promise<
    | {
      user: PublicUser;
      tokenId: string;
      clientId: string;
      resource: string | null;
      scopes: ScopeGrant[];
    }
    | null
  > {
    if (!token.startsWith("mca_")) return null;
    const hash = await sha256Hex(token);
    const stored = await this.repo.getMcpOAuthTokenByAccessHash(hash);
    if (!stored || stored.revokedAt) return null;
    if (stored.accessExpiresAt < new Date().toISOString()) return null;
    const user = await this.repo.getUser(stored.userId);
    if (!user || user.disabled) return null;
    const publicUser = await this.repo.toPublicUser(user);
    return {
      user: publicUser,
      tokenId: stored.id,
      clientId: stored.clientId,
      resource: stored.resource,
      scopes: await this.ceilingFor(publicUser),
    };
  }

  async revoke(token: string): Promise<void> {
    if (token.startsWith("mca_")) {
      const hash = await sha256Hex(token);
      const stored = await this.repo.getMcpOAuthTokenByAccessHash(hash);
      if (stored) await this.repo.revokeMcpOAuthToken(stored.id);
      return;
    }
    if (token.startsWith("mcr_")) {
      const hash = await sha256Hex(token);
      const stored = await this.repo.getMcpOAuthTokenByRefreshHash(hash);
      if (stored) await this.repo.revokeMcpOAuthToken(stored.id);
    }
  }
}

/** WWW-Authenticate challenge pointing clients at Protected Resource Metadata. */
export function mcpWwwAuthenticate(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const metadata = `${root}/.well-known/oauth-protected-resource`;
  return `Bearer realm="mcp", resource_metadata="${metadata}"`;
}

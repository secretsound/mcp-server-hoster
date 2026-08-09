/**
 * MCP OAuth AS: DCR → authorize decide → token (PKCE) → resolveBearer scopes.
 */
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { openDatabase } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { AuthRepository } from "../src/db/repos/auth.ts";
import { AuthService } from "../src/auth/service.ts";
import { sha256Base64Url } from "../src/auth/crypto.ts";
import { allowsTool } from "../src/auth/scopes.ts";

const tmp = await Deno.makeTempDir({ prefix: "mcp-oauth-" });
await ensureDir(tmp);
const dbPath = join(tmp, "test.db");
const db = await openDatabase(`sqlite://${dbPath}`, dbPath);
await migrate(db, join(Deno.cwd(), "migrations"));

const repo = new AuthRepository(db);
const auth = new AuthService(repo, {
  disabled: false,
  allowOpen: false,
  bootstrapEmail: "admin@example.com",
  bootstrapPassword: "password123",
  bootstrapDisplayName: "Admin",
  publicUrl: "http://localhost:8080",
});
await auth.bootstrap();

const member = await auth.createUser({
  email: "member@example.com",
  password: "password123",
  role: "user",
  grants: [
    { serverId: "mealie", tools: ["*"] },
    { serverId: "time", tools: ["get_current_time"] },
  ],
});

const login = await auth.login("member@example.com", "password123");
const session = await auth.resolveBearer(login.token);
if (!session || session.kind !== "session") throw new Error("session failed");

const registered = await auth.mcpOAuth.registerClient({
  client_name: "Test Client",
  redirect_uris: ["http://127.0.0.1:9999/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});
if (!registered.client_id.startsWith("mco_")) {
  throw new Error("expected mco_ client id");
}

const verifier = "test-pkce-verifier-value-abcdefghijklmnopqrstuvwxyz";
const challenge = await sha256Base64Url(verifier);

const { requestId } = await auth.mcpOAuth.beginAuthorize({
  clientId: registered.client_id,
  redirectUri: "http://127.0.0.1:9999/callback",
  responseType: "code",
  scope: "mcp",
  state: "xyz",
  codeChallenge: challenge,
  codeChallengeMethod: "S256",
  resource: "http://localhost:8080/mcp",
});

const decided = await auth.mcpOAuth.decideAuthorize({
  requestId,
  user: session.user,
  approve: true,
});
const redirect = new URL(decided.redirectTo);
const code = redirect.searchParams.get("code");
if (!code?.startsWith("mcc_")) throw new Error("expected auth code");
if (redirect.searchParams.get("state") !== "xyz") {
  throw new Error("state mismatch");
}

const tokens = await auth.mcpOAuth.exchangeToken({
  grantType: "authorization_code",
  code,
  redirectUri: "http://127.0.0.1:9999/callback",
  clientId: registered.client_id,
  codeVerifier: verifier,
  resource: "http://localhost:8080/mcp",
});
if (!tokens.access_token.startsWith("mca_")) {
  throw new Error("expected mca_ access token");
}
if (!tokens.refresh_token?.startsWith("mcr_")) {
  throw new Error("expected mcr_ refresh token");
}

const principal = await auth.resolveBearer(tokens.access_token);
if (!principal || principal.kind !== "oauth_token") {
  throw new Error("oauth principal missing");
}
if (principal.user.id !== member.id) throw new Error("wrong user on token");
if (!allowsTool(principal.scopes, "mealie", "anything")) {
  throw new Error("expected mealie grant");
}
if (allowsTool(principal.scopes, "time", "other_tool")) {
  throw new Error("time tools should be limited");
}

const refreshed = await auth.mcpOAuth.exchangeToken({
  grantType: "refresh_token",
  refreshToken: tokens.refresh_token,
  clientId: registered.client_id,
});
if (!refreshed.access_token.startsWith("mca_")) {
  throw new Error("refresh failed");
}

// Old access token should still work until expiry (we rotate hash on same row —
// actually rotate replaces access hash, so old token must fail).
const old = await auth.resolveBearer(tokens.access_token);
if (old) throw new Error("old access token should be invalid after refresh");

const tenant = await auth.createTenantApiKey({
  actor: (await auth.login("admin@example.com", "password123")).user,
  name: "m2m",
  scopes: [{ serverId: "*", tools: ["*"] }],
});
const keyPrincipal = await auth.resolveBearer(tenant.secret);
if (!keyPrincipal || keyPrincipal.kind !== "api_key") {
  throw new Error("tenant key should still work alongside OAuth");
}

console.log("test_mcp_oauth: ok");
await db.close();

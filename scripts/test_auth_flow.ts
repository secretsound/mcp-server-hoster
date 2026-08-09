/**
 * Integration test for auth bootstrap, RBAC, grants, invites, and key scoping.
 */
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { openDatabase } from "../src/db/client.ts";
import { migrate } from "../src/db/migrate.ts";
import { AuthRepository } from "../src/db/repos/auth.ts";
import { AuthService } from "../src/auth/service.ts";
import { allowsTool } from "../src/auth/scopes.ts";
import { hasPermission } from "../src/auth/permissions.ts";

const tmp = await Deno.makeTempDir({ prefix: "mcp-auth-" });
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

if (!await auth.isRequired()) throw new Error("expected auth required after bootstrap");

const login = await auth.login("admin@example.com", "password123");
const session = await auth.resolveBearer(login.token);
if (!session || session.kind !== "session" || session.user.role !== "admin") {
  throw new Error("admin session failed");
}
if (!hasPermission(session.user.permissions, "users:write")) {
  throw new Error("admin missing users:write");
}

const roles = await auth.listRoles();
if (!roles.find((r) => r.slug === "admin") || !roles.find((r) => r.slug === "user")) {
  throw new Error("system roles missing");
}

const custom = await auth.createRole({
  slug: "operator",
  name: "Operator",
  permissions: ["servers:read", "servers:lifecycle", "keys:own"],
});
if (custom.permissions.length !== 3) throw new Error("custom role perms wrong");

const member = await auth.createUser({
  email: "member@example.com",
  password: "password123",
  role: "user",
  grants: [
    { serverId: "mealie", tools: ["*"] },
    { serverId: "time", tools: ["get_current_time"] },
  ],
});
if (hasPermission(member.permissions, "mcp:full")) {
  throw new Error("member should not have mcp:full");
}

const invite = await auth.createInvite({
  actor: login.user,
  email: "invited@example.com",
  role: "user",
  grants: [{ serverId: "time", tools: ["*"] }],
});
if (!invite.token?.startsWith("mci_")) throw new Error("invite token missing");

const accepted = await auth.acceptInvite({
  token: invite.token!,
  password: "password123",
  displayName: "Invited",
});
if (accepted.user.email !== "invited@example.com") {
  throw new Error("invite accept failed");
}

let failed = false;
try {
  await auth.createUserApiKey({
    actor: member,
    name: "too-wide",
    scopes: [{ serverId: "time", tools: ["*"] }],
  });
  failed = true;
} catch {
  // expected
}
if (failed) throw new Error("expected over-scoped key to fail");

const { secret, key } = await auth.createUserApiKey({
  actor: member,
  name: "narrow",
  scopes: [{ serverId: "time", tools: ["get_current_time"] }],
});
const keyPrincipal = await auth.resolveBearer(secret);
if (!keyPrincipal || keyPrincipal.kind !== "api_key") {
  throw new Error("api key resolve failed");
}
if (!allowsTool(keyPrincipal.scopes, "time", "get_current_time")) {
  throw new Error("key should allow get_current_time");
}

const tenant = await auth.createTenantApiKey({
  actor: login.user,
  name: "tenant-wide",
  scopes: [{ serverId: "*", tools: ["*"] }],
});
const tenantPrincipal = await auth.resolveBearer(tenant.secret);
if (!tenantPrincipal || !allowsTool(tenantPrincipal.scopes, "anything", "x")) {
  throw new Error("tenant key should have full access");
}

await auth.revokeApiKey(member, key.id);
if (await auth.resolveBearer(secret)) {
  throw new Error("revoked key should not resolve");
}

await db.close();
await Deno.remove(tmp, { recursive: true });
console.log("auth flow OK");

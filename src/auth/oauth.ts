import { newId } from "./crypto.ts";
import type { AuthRepository, OAuthProviderRow } from "../db/repos/auth.ts";

export type OAuthProviderId = "google" | "github" | "oidc";

export type OAuthProviderConfig = {
  id: string;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  scopes: string[];
};

export type OAuthConfig = {
  publicUrl: string | null;
  autoProvision: boolean;
  defaultRole: string;
  providers: OAuthProviderConfig[];
};

/** Admin-facing provider row (secret redacted). */
export type OAuthProviderSettings = {
  id: string;
  enabled: boolean;
  label: string;
  clientId: string;
  /** True when a secret is stored; value itself is never returned. */
  hasClientSecret: boolean;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  userinfoEndpoint: string | null;
  scopes: string[];
};

export type OAuthSettings = {
  publicUrl: string | null;
  autoProvision: boolean;
  defaultRole: string;
  providers: OAuthProviderSettings[];
  /** Callback URL base hint for admins. */
  callbackUrlTemplate: string;
};

export type OAuthProfile = {
  subject: string;
  email: string | null;
  displayName: string | null;
};

const SECRET_PLACEHOLDER = "••••••••";

export const PROVIDER_PRESETS: Record<
  OAuthProviderId,
  {
    label: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userinfoEndpoint: string;
    scopes: string[];
    needsIssuer?: boolean;
  }
> = {
  google: {
    label: "Google",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
  },
  github: {
    label: "GitHub",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    userinfoEndpoint: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
  },
  oidc: {
    label: "OIDC",
    authorizationEndpoint: "",
    tokenEndpoint: "",
    userinfoEndpoint: "",
    scopes: ["openid", "email", "profile"],
    needsIssuer: true,
  },
};

function env(name: string): string | undefined {
  const v = Deno.env.get(name)?.trim();
  return v || undefined;
}

function resolveEndpoints(row: OAuthProviderRow): {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
} | null {
  const preset = PROVIDER_PRESETS[row.id as OAuthProviderId];
  if (row.id === "oidc" || preset?.needsIssuer) {
    const issuer = row.issuer?.replace(/\/$/, "");
    if (!issuer && !(row.authorizationEndpoint && row.tokenEndpoint && row.userinfoEndpoint)) {
      return null;
    }
    return {
      authorizationEndpoint: row.authorizationEndpoint ||
        (issuer ? `${issuer}/authorize` : ""),
      tokenEndpoint: row.tokenEndpoint || (issuer ? `${issuer}/token` : ""),
      userinfoEndpoint: row.userinfoEndpoint ||
        (issuer ? `${issuer}/userinfo` : ""),
    };
  }
  return {
    authorizationEndpoint: row.authorizationEndpoint ||
      preset?.authorizationEndpoint || "",
    tokenEndpoint: row.tokenEndpoint || preset?.tokenEndpoint || "",
    userinfoEndpoint: row.userinfoEndpoint || preset?.userinfoEndpoint || "",
  };
}

/** Build runtime OAuth config from DB rows (enabled + complete only). */
export async function configFromDb(
  repo: AuthRepository,
  fallbackPublicUrl: string | null,
): Promise<OAuthConfig> {
  const cfg = await repo.getOAuthConfigRow();
  const providers: OAuthProviderConfig[] = [];

  for (const row of await repo.listOAuthProviderRows()) {
    if (!row.enabled) continue;
    if (!row.clientId || !row.clientSecret) continue;
    const endpoints = resolveEndpoints(row);
    if (
      !endpoints?.authorizationEndpoint ||
      !endpoints.tokenEndpoint ||
      !endpoints.userinfoEndpoint
    ) {
      continue;
    }
    providers.push({
      id: row.id,
      label: row.label || PROVIDER_PRESETS[row.id as OAuthProviderId]?.label ||
        row.id,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      authorizationEndpoint: endpoints.authorizationEndpoint,
      tokenEndpoint: endpoints.tokenEndpoint,
      userinfoEndpoint: endpoints.userinfoEndpoint,
      scopes: row.scopes.length
        ? row.scopes
        : (PROVIDER_PRESETS[row.id as OAuthProviderId]?.scopes ??
          ["openid", "email", "profile"]),
    });
  }

  return {
    publicUrl: cfg?.publicUrl || fallbackPublicUrl ||
      env("HOST_PUBLIC_URL")?.replace(/\/$/, "") || null,
    autoProvision: cfg?.autoProvision ?? false,
    defaultRole: cfg?.defaultRole || "user",
    providers,
  };
}

/** Seed DB from env vars once when oauth_config is missing. */
export async function seedOAuthFromEnv(
  repo: AuthRepository,
  fallbackPublicUrl: string | null,
): Promise<void> {
  if (await repo.hasOAuthConfig()) {
    await ensureProviderPlaceholders(repo);
    return;
  }

  const publicUrl = fallbackPublicUrl ||
    env("HOST_PUBLIC_URL")?.replace(/\/$/, "") || null;
  const autoProvision = ["1", "true", "yes"].includes(
    (env("OAUTH_AUTO_PROVISION") ?? "false").toLowerCase(),
  );
  const defaultRole = env("OAUTH_DEFAULT_ROLE") ?? "user";
  await repo.upsertOAuthConfig({ publicUrl, autoProvision, defaultRole });

  const googleId = env("OAUTH_GOOGLE_CLIENT_ID");
  const googleSecret = env("OAUTH_GOOGLE_CLIENT_SECRET");
  const google = PROVIDER_PRESETS.google;
  await repo.upsertOAuthProvider({
    id: "google",
    enabled: !!(googleId && googleSecret),
    label: google.label,
    clientId: googleId ?? "",
    clientSecret: googleSecret ?? "",
    authorizationEndpoint: google.authorizationEndpoint,
    tokenEndpoint: google.tokenEndpoint,
    userinfoEndpoint: google.userinfoEndpoint,
    scopes: google.scopes,
  });

  const ghId = env("OAUTH_GITHUB_CLIENT_ID");
  const ghSecret = env("OAUTH_GITHUB_CLIENT_SECRET");
  const github = PROVIDER_PRESETS.github;
  await repo.upsertOAuthProvider({
    id: "github",
    enabled: !!(ghId && ghSecret),
    label: github.label,
    clientId: ghId ?? "",
    clientSecret: ghSecret ?? "",
    authorizationEndpoint: github.authorizationEndpoint,
    tokenEndpoint: github.tokenEndpoint,
    userinfoEndpoint: github.userinfoEndpoint,
    scopes: github.scopes,
  });

  const oidcIssuer = env("OAUTH_OIDC_ISSUER")?.replace(/\/$/, "") ?? null;
  const oidcId = env("OAUTH_OIDC_CLIENT_ID");
  const oidcSecret = env("OAUTH_OIDC_CLIENT_SECRET");
  const oidcScopes = (env("OAUTH_OIDC_SCOPES") ?? "openid email profile")
    .split(/\s+/);
  await repo.upsertOAuthProvider({
    id: "oidc",
    enabled: !!(oidcIssuer && oidcId && oidcSecret),
    label: env("OAUTH_OIDC_LABEL") ?? "SSO",
    clientId: oidcId ?? "",
    clientSecret: oidcSecret ?? "",
    issuer: oidcIssuer,
    scopes: oidcScopes,
  });
}

async function ensureProviderPlaceholders(repo: AuthRepository): Promise<void> {
  for (const id of ["google", "github", "oidc"] as const) {
    if (await repo.getOAuthProviderRow(id)) continue;
    const preset = PROVIDER_PRESETS[id];
    await repo.upsertOAuthProvider({
      id,
      enabled: false,
      label: preset.label,
      clientId: "",
      clientSecret: "",
      authorizationEndpoint: preset.authorizationEndpoint || null,
      tokenEndpoint: preset.tokenEndpoint || null,
      userinfoEndpoint: preset.userinfoEndpoint || null,
      scopes: preset.scopes,
    });
  }
  if (!await repo.hasOAuthConfig()) {
    await repo.upsertOAuthConfig({
      publicUrl: null,
      autoProvision: false,
      defaultRole: "user",
    });
  }
}

export async function settingsFromDb(
  repo: AuthRepository,
  fallbackPublicUrl: string | null,
): Promise<OAuthSettings> {
  await ensureProviderPlaceholders(repo);
  const cfg = await repo.getOAuthConfigRow();
  const publicUrl = cfg?.publicUrl || fallbackPublicUrl || null;
  const providers = (await repo.listOAuthProviderRows()).map((row) => ({
    id: row.id,
    enabled: row.enabled,
    label: row.label,
    clientId: row.clientId,
    hasClientSecret: !!row.clientSecret,
    issuer: row.issuer,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    userinfoEndpoint: row.userinfoEndpoint,
    scopes: row.scopes,
  }));

  return {
    publicUrl,
    autoProvision: cfg?.autoProvision ?? false,
    defaultRole: cfg?.defaultRole ?? "user",
    providers,
    callbackUrlTemplate: publicUrl
      ? `${publicUrl}/api/auth/oauth/{provider}/callback`
      : "{HOST_PUBLIC_URL}/api/auth/oauth/{provider}/callback",
  };
}

export async function applyOAuthSettingsUpdate(
  repo: AuthRepository,
  patch: {
    publicUrl?: string | null;
    autoProvision?: boolean;
    defaultRole?: string;
    providers?: Array<{
      id: string;
      enabled?: boolean;
      label?: string;
      clientId?: string;
      /** Omit, empty, or placeholder to keep existing secret. */
      clientSecret?: string | null;
      issuer?: string | null;
      authorizationEndpoint?: string | null;
      tokenEndpoint?: string | null;
      userinfoEndpoint?: string | null;
      scopes?: string[];
    }>;
  },
): Promise<OAuthSettings> {
  await ensureProviderPlaceholders(repo);
  const existing = await repo.getOAuthConfigRow();
  await repo.upsertOAuthConfig({
    publicUrl: patch.publicUrl !== undefined
      ? (patch.publicUrl?.trim() || null)
      : (existing?.publicUrl ?? null),
    autoProvision: patch.autoProvision ?? existing?.autoProvision ?? false,
    defaultRole: patch.defaultRole?.trim() || existing?.defaultRole || "user",
  });

  if (patch.providers) {
    for (const p of patch.providers) {
      const prev = await repo.getOAuthProviderRow(p.id);
      if (!prev && !PROVIDER_PRESETS[p.id as OAuthProviderId] && p.id !== "oidc") {
        // Allow only known presets for now
        if (!["google", "github", "oidc"].includes(p.id)) {
          throw new Error(`Unknown OAuth provider: ${p.id}`);
        }
      }
      const preset = PROVIDER_PRESETS[p.id as OAuthProviderId];
      let secret = prev?.clientSecret ?? "";
      if (
        typeof p.clientSecret === "string" &&
        p.clientSecret.length > 0 &&
        p.clientSecret !== SECRET_PLACEHOLDER
      ) {
        secret = p.clientSecret;
      }
      await repo.upsertOAuthProvider({
        id: p.id,
        enabled: p.enabled ?? prev?.enabled ?? false,
        label: p.label ?? prev?.label ?? preset?.label ?? p.id,
        clientId: p.clientId ?? prev?.clientId ?? "",
        clientSecret: secret,
        issuer: p.issuer !== undefined ? p.issuer : (prev?.issuer ?? null),
        authorizationEndpoint: p.authorizationEndpoint !== undefined
          ? p.authorizationEndpoint
          : (prev?.authorizationEndpoint ?? preset?.authorizationEndpoint ??
            null),
        tokenEndpoint: p.tokenEndpoint !== undefined
          ? p.tokenEndpoint
          : (prev?.tokenEndpoint ?? preset?.tokenEndpoint ?? null),
        userinfoEndpoint: p.userinfoEndpoint !== undefined
          ? p.userinfoEndpoint
          : (prev?.userinfoEndpoint ?? preset?.userinfoEndpoint ?? null),
        scopes: p.scopes ?? prev?.scopes ?? preset?.scopes ??
          ["openid", "email", "profile"],
      });
    }
  }

  return await settingsFromDb(repo, null);
}

export function getProvider(
  config: OAuthConfig,
  id: string,
): OAuthProviderConfig | null {
  return config.providers.find((p) => p.id === id) ?? null;
}

export function callbackUrl(publicUrl: string, providerId: string): string {
  return `${publicUrl.replace(/\/$/, "")}/api/auth/oauth/${providerId}/callback`;
}

export function buildAuthorizeUrl(
  provider: OAuthProviderConfig,
  publicUrl: string,
  state: string,
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(publicUrl, provider.id));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", state);
  if (provider.id === "google" || provider.id === "oidc") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}

export async function exchangeCode(
  provider: OAuthProviderConfig,
  publicUrl: string,
  code: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: callbackUrl(publicUrl, provider.id),
    grant_type: "authorization_code",
  });

  const res = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const params = new URLSearchParams(text);
    data = Object.fromEntries(params.entries());
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error_description === "string"
        ? data.error_description
        : `Token exchange failed (${res.status})`,
    );
  }
  const token = data.access_token;
  if (typeof token !== "string") throw new Error("No access_token in response");
  return token;
}

export async function fetchProfile(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthProfile> {
  if (provider.id === "github") {
    return fetchGitHubProfile(provider, accessToken);
  }

  const res = await fetch(provider.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Userinfo failed (${res.status})`);
  const data = await res.json() as Record<string, unknown>;
  const subject = String(data.sub ?? data.id ?? "");
  if (!subject) throw new Error("Provider profile missing subject");
  const email = typeof data.email === "string" ? data.email.toLowerCase() : null;
  const displayName =
    (typeof data.name === "string" && data.name) ||
    (typeof data.preferred_username === "string" && data.preferred_username) ||
    null;
  return { subject, email, displayName };
}

async function fetchGitHubProfile(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthProfile> {
  const res = await fetch(provider.userinfoEndpoint, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "mcp-hoster",
    },
  });
  if (!res.ok) throw new Error(`GitHub userinfo failed (${res.status})`);
  const data = await res.json() as Record<string, unknown>;
  const subject = String(data.id ?? "");
  if (!subject) throw new Error("GitHub profile missing id");

  let email = typeof data.email === "string" ? data.email.toLowerCase() : null;
  if (!email) {
    const emailRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "user-agent": "mcp-hoster",
      },
    });
    if (emailRes.ok) {
      const emails = await emailRes.json() as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified) ??
        emails.find((e) => e.verified);
      email = primary?.email.toLowerCase() ?? null;
    }
  }

  return {
    subject,
    email,
    displayName:
      (typeof data.name === "string" && data.name) ||
      (typeof data.login === "string" && data.login) ||
      null,
  };
}

export function newOAuthState(): string {
  return newId("oauth");
}

export { SECRET_PLACEHOLDER };

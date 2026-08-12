<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { api, getSessionToken } from "../api/client";
import type { AppLocale } from "../i18n";
import { useAuthStore } from "../stores/auth";
import { useLocaleStore } from "../stores/locale";
import { useServersStore } from "../stores/servers";
import { useSettingsStore } from "../stores/settings";
import type { HealthResponse } from "../types";

type OAuthProviderSettings = {
  id: string;
  enabled: boolean;
  label: string;
  clientId: string;
  hasClientSecret: boolean;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  userinfoEndpoint: string | null;
  scopes: string[];
};

type OAuthSettings = {
  publicUrl: string | null;
  autoProvision: boolean;
  defaultRole: string;
  providers: OAuthProviderSettings[];
  callbackUrlTemplate: string;
};

type DatabaseInfo = {
  engine: string;
  url: string;
  urlRedacted?: string;
  path: string;
  dataDir: string;
  sizeBytes: number | null;
  canBackup?: boolean;
  canRestore?: boolean;
  canMigrateToPostgres?: boolean;
  pendingBootstrap?: {
    pending: boolean;
    live: Record<string, string>;
    file: Record<string, string>;
  };
  migrations: Array<{ version: string; appliedAt: string }>;
  counts: Record<string, number>;
};

const { t } = useI18n();
const servers = useServersStore();
const auth = useAuthStore();
const localeStore = useLocaleStore();
const settingsStore = useSettingsStore();
const message = useMessage();
const loading = ref(true);
const savingGeneral = ref(false);
const savingHost = ref(false);
const savingOauth = ref(false);
const loadError = ref("");
const health = ref<HealthResponse | null>(null);
const authRequired = ref(false);
const database = ref<DatabaseInfo | null>(null);
const databaseError = ref("");
const restartRequired = ref(false);

const general = reactive({
  displayName: "MCP Hoster",
  logTail: 200,
  notes: "",
  publicUrl: "",
  gatewayPublicUrl: "",
});

const host = reactive({
  bind: "0.0.0.0",
  port: 8080,
  dataDir: "",
  sandboxMode: "auto" as "auto" | "bwrap" | "landlock" | "none",
  authDisabled: false,
  authAllowOpen: false,
});

const sandboxActive = ref<{
  requested: string;
  active: string;
  detail: string | null;
} | null>(null);

const sandboxModeOptions = computed(() => [
  { label: t("settings.sandboxAuto"), value: "auto" },
  { label: t("settings.sandboxBwrap"), value: "bwrap" },
  { label: t("settings.sandboxLandlock"), value: "landlock" },
  { label: t("settings.sandboxNone"), value: "none" },
]);

const oauth = reactive({
  publicUrl: "",
  autoProvision: false,
  defaultRole: "user",
  callbackUrlTemplate: "",
  providers: [] as Array<
    OAuthProviderSettings & { clientSecret: string; scopesText: string }
  >,
});

const roleOptions = ref<Array<{ label: string; value: string }>>([
  { label: t("settings.roleUser"), value: "user" },
  { label: t("settings.roleAdmin"), value: "admin" },
]);

const oauthError = ref("");
const activeTab = ref("general");
const authSubTab = ref("oidc");
const exporting = ref(false);
const restoring = ref(false);
const migrating = ref(false);
const restarting = ref(false);
const migrate = reactive({
  host: "localhost",
  port: 5432,
  database: "mcp_hoster",
  username: "",
  password: "",
  sslMode: "prefer",
});
const confirmWipe = ref(false);

const sslModeOptions = [
  { label: "prefer", value: "prefer" },
  { label: "require", value: "require" },
  { label: "verify-full", value: "verify-full" },
  { label: "allow", value: "allow" },
  { label: "disable", value: "disable" },
];

function buildPostgresUrl(parts: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: string;
}): string {
  const user = encodeURIComponent(parts.username.trim());
  const pass = encodeURIComponent(parts.password);
  const host = parts.host.trim() || "localhost";
  const port = Number.isFinite(parts.port) && parts.port > 0
    ? Math.trunc(parts.port)
    : 5432;
  const db = parts.database.trim().replace(/^\/+/, "") || "mcp_hoster";
  const auth = parts.password !== ""
    ? `${user}:${pass}@`
    : user
    ? `${user}@`
    : "";
  const ssl = parts.sslMode
    ? `?sslmode=${encodeURIComponent(parts.sslMode)}`
    : "";
  return `postgres://${auth}${host}:${port}/${db}${ssl}`;
}

function parsePostgresUrl(raw: string): Partial<typeof migrate> | null {
  const trimmed = raw.trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed.replace(/^postgres(ql)?:/i, "http:"));
    const sslMode = u.searchParams.get("sslmode") || "prefer";
    return {
      host: u.hostname || "localhost",
      port: u.port ? Number(u.port) : 5432,
      database: decodeURIComponent(u.pathname.replace(/^\/+/, "")) ||
        "mcp_hoster",
      username: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      sslMode: ["prefer", "require", "verify-full", "allow", "disable"]
          .includes(sslMode)
        ? sslMode
        : "prefer",
    };
  } catch {
    return null;
  }
}

const migrateUrlPreview = computed(() => {
  const url = buildPostgresUrl(migrate);
  return url.replace(/:([^:@/]+)@/, ":***@");
});

const saml = reactive({
  enabled: false,
  idpEntityId: "",
  ssoUrl: "",
  certificate: "",
  emailAttribute: "email",
});

const scim = reactive({
  enabled: false,
  bearerToken: "",
  /** True when a token is already stored (value may be blank in the form). */
  hasToken: false,
});

const savingAuth = ref(false);

const healthWarnings = computed(() =>
  (health.value?.checks || []).filter((c) => !c.ok),
);

const publicOrigin = computed(() =>
  (general.publicUrl || oauth.publicUrl || window.location.origin).replace(
    /\/$/,
    "",
  )
);

const oidcCallbackUrl = computed(() =>
  `${publicOrigin.value}/api/auth/oauth/oidc/callback`
);

const samlAcsUrl = computed(() =>
  `${publicOrigin.value}/api/auth/saml/acs`
);

const scimBaseUrl = computed(() => `${publicOrigin.value}/scim/v2`);

const oidcProvider = computed(() =>
  oauth.providers.find((p) => p.id === "oidc") ?? null
);

const tableOverview = computed(() => {
  const counts = database.value?.counts || {};
  const names = Object.keys(counts);
  if (!names.length) return t("settings.noTables");
  const rows = names.reduce((sum, name) => sum + Number(counts[name] || 0), 0);
  return t("settings.tablesOverview", {
    tables: names.length,
    rows: rows.toLocaleString(),
  });
});

const migrationOverview = computed(() => {
  const migrations = database.value?.migrations || [];
  if (!migrations.length) return t("settings.noneRecorded");
  const latest = migrations[migrations.length - 1];
  const when = latest?.appliedAt
    ? new Date(latest.appliedAt).toLocaleString()
    : "";
  if (when) {
    return t("settings.migrationsOverviewWhen", {
      count: migrations.length,
      version: latest.version,
      when,
    });
  }
  return t("settings.migrationsOverview", {
    count: migrations.length,
    version: latest.version,
  });
});

const needsPublicUrl = computed(() =>
  healthWarnings.value.some((c) => c.id === "oauth_public_url"),
);

const pendingRestart = computed(() =>
  restartRequired.value || Boolean(database.value?.pendingBootstrap?.pending),
);

onMounted(async () => {
  loading.value = true;
  loadError.value = "";
  oauthError.value = "";
  databaseError.value = "";
  try {
    const [h, settingsRes, authRes] = await Promise.all([
      api<HealthResponse>("/health"),
      api<{
        settings: Record<string, string>;
        sandbox?: { requested: string; active: string; detail: string | null };
        pendingBootstrap?: DatabaseInfo["pendingBootstrap"];
      }>("/api/settings"),
      api<{ required: boolean }>("/api/auth/status"),
    ]);

    health.value = h;
    authRequired.value = authRes.required;
    if (h.gateway) servers.gatewayUrl = h.gateway;
    applySettingsMap(settingsRes.settings || {});
    sandboxActive.value = settingsRes.sandbox ?? null;
    restartRequired.value = Boolean(settingsRes.pendingBootstrap?.pending);

    if (auth.can("roles:read")) {
      try {
        const roles = await auth.listRoles();
        roleOptions.value = roles.map((r) => ({
          label: `${r.name} (${r.slug})`,
          value: r.slug,
        }));
      } catch {
        /* keep defaults */
      }
    }

    if (auth.can("settings:read")) {
      try {
        const oauthRes = await api<{ oauth: OAuthSettings }>(
          "/api/auth/oauth/settings",
        );
        applyOauth(oauthRes.oauth);
        if (!general.publicUrl && oauth.publicUrl) {
          general.publicUrl = oauth.publicUrl;
        }
      } catch (err) {
        oauthError.value = err instanceof Error ? err.message : String(err);
      }
      await reloadDatabase();
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

function applySettingsMap(s: Record<string, string>) {
  general.displayName = s["host.display_name"] || "MCP Hoster";
  general.logTail = Number(s["ui.default_log_tail"] || "200");
  general.notes = s["host.notes"] || "";
  general.publicUrl = s["host.public_url"] || "";
  general.gatewayPublicUrl = s["host.gateway_public_url"] || "";
  host.bind = s["host.bind"] || "0.0.0.0";
  host.port = Number(s["host.port"] || "8080");
  host.dataDir = s["host.data_dir"] || "";
  host.authDisabled = s["host.auth_disabled"] === "true";
  host.authAllowOpen = s["host.auth_allow_open"] === "true";
  const mode = (s["host.sandbox_mode"] || "auto").toLowerCase();
  host.sandboxMode =
    mode === "bwrap" || mode === "landlock" || mode === "none" || mode === "auto"
      ? mode
      : "auto";
  if (s["host.database_url"]?.startsWith("postgres")) {
    const parsed = parsePostgresUrl(s["host.database_url"]);
    if (parsed) Object.assign(migrate, parsed);
  }
  saml.enabled = s["auth.saml_enabled"] === "true";
  saml.idpEntityId = s["auth.saml_idp_entity_id"] || "";
  saml.ssoUrl = s["auth.saml_sso_url"] || "";
  saml.certificate = s["auth.saml_certificate"] || "";
  saml.emailAttribute = s["auth.saml_email_attribute"] || "email";
  scim.enabled = s["auth.scim_enabled"] === "true";
  scim.hasToken = Boolean(s["auth.scim_bearer_token"]);
  scim.bearerToken = "";
  settingsStore.applyLocal({
    displayName: general.displayName,
    defaultLogTail: general.logTail,
  });
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function applyOauth(data: OAuthSettings) {
  oauth.publicUrl = data.publicUrl ?? "";
  oauth.autoProvision = data.autoProvision;
  oauth.defaultRole = data.defaultRole || "user";
  oauth.callbackUrlTemplate = data.callbackUrlTemplate;
  oauth.providers = data.providers.map((p) => ({
    ...p,
    clientSecret: "",
    scopesText: p.scopes.join(" "),
  }));
  if (!oauth.providers.some((p) => p.id === "oidc")) {
    oauth.providers.push({
      id: "oidc",
      enabled: false,
      label: "OIDC",
      clientId: "",
      hasClientSecret: false,
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
      userinfoEndpoint: null,
      scopes: ["openid", "email", "profile"],
      clientSecret: "",
      scopesText: "openid email profile",
    });
  }
}

async function reloadDatabase() {
  try {
    const dbRes = await api<{ database: DatabaseInfo }>("/api/database");
    database.value = dbRes.database;
    databaseError.value = "";
    if (dbRes.database.pendingBootstrap?.pending) restartRequired.value = true;
  } catch (err) {
    databaseError.value = err instanceof Error ? err.message : String(err);
  }
}

async function putSettings(body: Record<string, string>, which: "general" | "host") {
  const loadingRef = which === "general" ? savingGeneral : savingHost;
  loadingRef.value = true;
  try {
    const res = await api<{
      settings: Record<string, string>;
      restartRequired?: boolean;
      sandbox?: { requested: string; active: string; detail: string | null };
      pendingBootstrap?: DatabaseInfo["pendingBootstrap"];
    }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    applySettingsMap(res.settings);
    if (res.sandbox) sandboxActive.value = res.sandbox;
    if (res.restartRequired || res.pendingBootstrap?.pending) {
      restartRequired.value = true;
      message.warning(t("settings.savedRestart"));
    } else {
      message.success(
        res.sandbox
          ? t("settings.savedSandbox", { active: res.sandbox.active })
          : t("settings.saved"),
      );
    }
    health.value = await api<HealthResponse>("/health");
    await reloadDatabase();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loadingRef.value = false;
  }
}

async function saveGeneral() {
  await putSettings({
    "host.display_name": general.displayName,
    "ui.default_log_tail": String(general.logTail),
    "host.notes": general.notes,
  }, "general");
}

async function saveHost() {
  const siteUrl = general.publicUrl.trim().replace(/\/$/, "");
  let gatewayUrl = general.gatewayPublicUrl.trim().replace(/\/$/, "");
  // One site URL is enough for most installs — derive /mcp when gateway is blank.
  if (siteUrl && !gatewayUrl) {
    gatewayUrl = `${siteUrl}/mcp`;
    general.gatewayPublicUrl = gatewayUrl;
  }
  await putSettings({
    "host.bind": host.bind,
    "host.port": String(host.port),
    "host.data_dir": host.dataDir,
    "host.sandbox_mode": host.sandboxMode,
    "host.auth_disabled": host.authDisabled ? "true" : "false",
    "host.auth_allow_open": host.authAllowOpen ? "true" : "false",
    "host.public_url": siteUrl,
    "host.gateway_public_url": gatewayUrl,
  }, "host");
}

function generateScimToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  scim.bearerToken = Array.from(
    bytes,
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

async function saveAuth() {
  if (!auth.can("settings:write")) return;
  const oidc = oidcProvider.value;
  if (!oidc) {
    message.error(t("settings.oidcUnavailable"));
    return;
  }
  savingAuth.value = true;
  savingOauth.value = true;
  try {
    const settingsBody: Record<string, string> = {
      "auth.saml_enabled": saml.enabled ? "true" : "false",
      "auth.saml_idp_entity_id": saml.idpEntityId.trim(),
      "auth.saml_sso_url": saml.ssoUrl.trim(),
      "auth.saml_certificate": saml.certificate.trim(),
      "auth.saml_email_attribute": saml.emailAttribute.trim() || "email",
      "auth.scim_enabled": scim.enabled ? "true" : "false",
    };
    if (scim.bearerToken.trim()) {
      settingsBody["auth.scim_bearer_token"] = scim.bearerToken.trim();
    }

    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settingsBody),
    });

    const { oauth: updated } = await api<{ oauth: OAuthSettings }>(
      "/api/auth/oauth/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          // Public URL is owned by General settings.
          publicUrl: general.publicUrl.trim() || null,
          autoProvision: oauth.autoProvision,
          defaultRole: oauth.defaultRole,
          providers: [
            {
              id: "oidc",
              enabled: oidc.enabled,
              label: oidc.label || "OIDC",
              clientId: oidc.clientId,
              clientSecret: oidc.clientSecret || undefined,
              issuer: oidc.issuer,
              authorizationEndpoint: oidc.authorizationEndpoint,
              tokenEndpoint: oidc.tokenEndpoint,
              userinfoEndpoint: oidc.userinfoEndpoint,
              scopes: oidc.scopesText.split(/\s+/).filter(Boolean),
            },
            // Social IdPs are hidden for now — keep them off.
            { id: "google", enabled: false },
            { id: "github", enabled: false },
          ],
        }),
      },
    );
    applyOauth(updated);

    const settingsRes = await api<{ settings: Record<string, string> }>(
      "/api/settings",
    );
    applySettingsMap(settingsRes.settings || {});
    message.success(t("settings.authSaved"));
    health.value = await api<HealthResponse>("/health");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingAuth.value = false;
    savingOauth.value = false;
  }
}

function suggestedPublicUrl(): string {
  return window.location.origin;
}

async function downloadBackup() {
  exporting.value = true;
  try {
    const headers: Record<string, string> = {};
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch("/api/database/backup", { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || t("settings.backupFailed", { status: res.status }));
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disp);
    const filename = match?.[1] || "mcp-hoster-backup.db";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t("settings.backupDownloaded"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    exporting.value = false;
  }
}

async function uploadRestore(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  restoring.value = true;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch("/api/database/restore", {
      method: "POST",
      headers,
      body: await file.arrayBuffer(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || t("settings.restoreFailed", { status: res.status }));
    }
    restartRequired.value = true;
    message.warning(body.message || t("settings.restoreStaged"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    restoring.value = false;
  }
}

async function runMigrate() {
  if (!migrate.host.trim()) {
    message.error(t("settings.enterPgHost"));
    return;
  }
  if (!migrate.database.trim()) {
    message.error(t("settings.enterDbName"));
    return;
  }
  if (!migrate.username.trim()) {
    message.error(t("settings.enterPgUser"));
    return;
  }
  migrating.value = true;
  try {
    const res = await api<{
      ok: boolean;
      restartRequired?: boolean;
      counts?: Record<string, { source: number; target: number }>;
      error?: string;
    }>("/api/database/migrate", {
      method: "POST",
      body: JSON.stringify({
        databaseUrl: buildPostgresUrl(migrate),
        confirmWipe: confirmWipe.value,
      }),
    });
    restartRequired.value = true;
    const tableCount = Object.keys(res.counts || {}).length;
    message.success(t("settings.migrated", { count: tableCount }));
    await reloadDatabase();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    migrating.value = false;
  }
}

async function requestRestart() {
  restarting.value = true;
  try {
    await api("/api/host/restart", { method: "POST", body: "{}" });
    message.info(t("settings.hostRestarting"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    restarting.value = false;
  }
}

</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ t("settings.title") }}</h1>
        <p class="page-sub">{{ t("settings.subtitle") }}</p>
      </div>
    </div>

    <NSpin :show="loading">
      <NText v-if="loadError" type="error">{{ loadError }}</NText>

      <NAlert
        v-if="pendingRestart"
        type="warning"
        :bordered="false"
        style="margin-bottom: 1rem"
      >
        <div class="restart-banner">
          <span>
            {{ t("settings.restartPending") }}
            <template v-if="database?.pendingBootstrap?.pending">
              {{ t("settings.restartBootstrap") }}
            </template>
          </span>
          <NButton
            v-if="auth.can('settings:write')"
            size="small"
            type="warning"
            :loading="restarting"
            @click="requestRestart"
          >
            {{ t("settings.restartHost") }}
          </NButton>
        </div>
      </NAlert>

      <NTabs v-if="!loadError" v-model:value="activeTab" type="line" animated>
        <NTabPane name="general" :tab="t('settings.tabGeneral')">
          <div class="tab-body">
            <NCard
              v-if="healthWarnings.length"
              size="small"
              :title="t('settings.healthChecks')"
              style="margin-bottom: 1rem"
            >
              <div class="checks">
                <div
                  v-for="c in healthWarnings"
                  :key="c.id"
                  class="check"
                >
                  <NTag
                    size="small"
                    :type="c.severity === 'error' ? 'error' : 'warning'"
                    :bordered="false"
                  >
                    {{ c.severity }}
                  </NTag>
                  <span>{{ c.message }}</span>
                </div>
              </div>
            </NCard>

            <div class="split-2">
              <NCard size="small" :title="t('settings.appearance')">
                <NForm label-placement="top">
                  <NFormItem :label="t('settings.displayName')">
                    <NInput
                      v-model:value="general.displayName"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem :label="t('settings.language')">
                    <NSelect
                      :value="localeStore.locale"
                      :options="localeStore.options"
                      @update:value="(v: AppLocale) => localeStore.setLocale(v)"
                    />
                  </NFormItem>
                  <NFormItem :label="t('settings.defaultLogTail')">
                    <NInputNumber
                      v-model:value="general.logTail"
                      :min="50"
                      :max="5000"
                      style="width: 100%"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem :label="t('settings.notes')">
                    <NInput
                      v-model:value="general.notes"
                      type="textarea"
                      :autosize="{ minRows: 3, maxRows: 8 }"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NButton
                    type="primary"
                    :loading="savingGeneral"
                    :disabled="!auth.can('settings:write')"
                    @click="saveGeneral"
                  >
                    {{ t("settings.saveGeneral") }}
                  </NButton>
                </NForm>
              </NCard>

              <NCard size="small" :title="t('settings.runtime')">
                <table class="runtime">
                  <tbody>
                    <tr>
                      <th>{{ t("settings.gateway") }}</th>
                      <td><code>{{ servers.gatewayUrl }}</code></td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.siteUrl") }}</th>
                      <td>
                        <code>{{
                          health?.publicUrl || general.publicUrl || "—"
                        }}</code>
                      </td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.listen") }}</th>
                      <td>
                        <code>
                          {{ health?.bind || host.bind }}:{{
                            health?.port || host.port
                          }}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.database") }}</th>
                      <td><code>{{ health?.database || "—" }}</code></td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.auth") }}</th>
                      <td>
                        {{
                          authRequired
                            ? t("settings.authRequired")
                            : host.authDisabled
                            ? t("settings.authDisabled")
                            : t("settings.authOpenUntilFirst")
                        }}
                      </td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.sandbox") }}</th>
                      <td>
                        <code>{{
                          health?.sandboxRequested || host.sandboxMode
                        }}</code>
                        →
                        <code>{{
                          health?.sandbox || sandboxActive?.active || "—"
                        }}</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </NCard>
            </div>
          </div>
        </NTabPane>

        <NTabPane name="host" :tab="t('settings.tabHost')">
          <div class="tab-body host-stack">
            <NCard size="small" :title="t('settings.listenCard')">
              <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                {{ t("settings.listenHint") }}
              </NText>
              <NForm label-placement="top">
                <div class="split-2">
                  <NFormItem :label="t('settings.bindAddress')">
                    <NInput
                      v-model:value="host.bind"
                      :disabled="!auth.can('settings:write')"
                    />
                    <NTag size="tiny" :bordered="false" style="margin-top: 0.35rem">
                      {{ t("settings.restartTag") }}
                    </NTag>
                  </NFormItem>
                  <NFormItem :label="t('settings.port')">
                    <NInputNumber
                      v-model:value="host.port"
                      :min="1"
                      :max="65535"
                      style="width: 100%"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                </div>
                <NFormItem :label="t('settings.dataDirectory')">
                  <NInput
                    v-model:value="host.dataDir"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
              </NForm>
            </NCard>

            <NCard size="small" :title="t('settings.publicUrls')">
              <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                {{ t("settings.publicUrlsHint") }}
              </NText>
              <NForm label-placement="top">
                <NFormItem :label="t('settings.siteUrl')">
                  <NSpace vertical style="width: 100%">
                    <NAlert
                      v-if="needsPublicUrl"
                      type="error"
                      :bordered="false"
                    >
                      {{ t("settings.ssoNeedsUrl") }}
                    </NAlert>
                    <NSpace>
                      <NInput
                        v-model:value="general.publicUrl"
                        :placeholder="t('settings.siteUrlPlaceholder')"
                        style="min-width: min(320px, 60vw)"
                        :disabled="!auth.can('settings:write')"
                      />
                      <NButton
                        quaternary
                        :disabled="!auth.can('settings:write')"
                        @click="general.publicUrl = suggestedPublicUrl()"
                      >
                        {{ t("settings.useThisOrigin") }}
                      </NButton>
                    </NSpace>
                  </NSpace>
                </NFormItem>
                <NFormItem :label="t('settings.mcpPublicUrl')">
                  <NInput
                    v-model:value="general.gatewayPublicUrl"
                    :placeholder="t('settings.mcpPublicUrlPlaceholder')"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
              </NForm>
            </NCard>

            <NCard size="small" :title="t('settings.processAuth')">
              <NForm label-placement="top">
                <NFormItem :label="t('settings.processSandbox')">
                  <div style="width: 100%">
                    <NSelect
                      v-model:value="host.sandboxMode"
                      :options="sandboxModeOptions"
                      :disabled="!auth.can('settings:write')"
                    />
                    <NText
                      depth="3"
                      style="display: block; margin-top: 0.4rem; font-size: 0.85rem"
                    >
                      {{ t("settings.sandboxActive") }}
                      <code>{{ sandboxActive?.active || "—" }}</code>
                      <span v-if="sandboxActive?.detail">
                        — {{ sandboxActive.detail }}
                      </span>
                    </NText>
                  </div>
                </NFormItem>
                <NAlert type="warning" :bordered="false" style="margin-bottom: 0.85rem">
                  {{ t("settings.authDisableWarning") }}
                </NAlert>
                <NFormItem :label="t('settings.disableAuth')">
                  <NSwitch
                    v-model:value="host.authDisabled"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NFormItem :label="t('settings.allowOpenAccess')">
                  <NSwitch
                    v-model:value="host.authAllowOpen"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
              </NForm>
            </NCard>

            <NSpace v-if="auth.can('settings:write')">
              <NButton
                type="primary"
                :loading="savingHost"
                @click="saveHost"
              >
                {{ t("settings.saveHost") }}
              </NButton>
            </NSpace>
          </div>
        </NTabPane>

        <NTabPane
          v-if="auth.can('settings:read')"
          name="database"
          :tab="t('settings.tabDatabase')"
        >
          <div class="tab-body">
            <NText
              v-if="databaseError"
              type="error"
              style="display: block; margin-bottom: 0.75rem"
            >
              {{ t("settings.dbLoadError", { error: databaseError }) }}
            </NText>
            <div v-else-if="database" class="db-stack">
              <NCard size="small" :title="t('settings.connection')">
                <table class="runtime">
                  <tbody>
                    <tr>
                      <th>{{ t("settings.engine") }}</th>
                      <td>{{ database.engine }}</td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.url") }}</th>
                      <td>
                        <code class="wrap">{{
                          database.urlRedacted || database.url
                        }}</code>
                      </td>
                    </tr>
                    <tr v-if="database.engine === 'sqlite'">
                      <th>{{ t("settings.path") }}</th>
                      <td><code class="wrap">{{ database.path }}</code></td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.dataDir") }}</th>
                      <td><code class="wrap">{{ database.dataDir }}</code></td>
                    </tr>
                    <tr v-if="database.sizeBytes != null">
                      <th>{{ t("settings.size") }}</th>
                      <td>{{ formatBytes(database.sizeBytes) }}</td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.tables") }}</th>
                      <td>{{ tableOverview }}</td>
                    </tr>
                    <tr>
                      <th>{{ t("settings.migrations") }}</th>
                      <td>{{ migrationOverview }}</td>
                    </tr>
                  </tbody>
                </table>

                <NSpace
                  v-if="auth.can('settings:write') && database.canBackup"
                  style="margin-top: 0.85rem"
                >
                  <NButton
                    type="primary"
                    secondary
                    :loading="exporting"
                    @click="downloadBackup"
                  >
                    {{ t("settings.downloadBackup") }}
                  </NButton>
                  <NButton
                    v-if="database.canRestore"
                    secondary
                    :loading="restoring"
                    tag="label"
                    style="cursor: pointer"
                  >
                    {{ t("settings.uploadRestore") }}
                    <input
                      type="file"
                      accept=".db,application/x-sqlite3,application/octet-stream"
                      hidden
                      @change="uploadRestore"
                    />
                  </NButton>
                </NSpace>
                <NText
                  v-if="database.engine === 'postgres'"
                  depth="3"
                  style="display: block; margin-top: 0.75rem; font-size: 0.85rem"
                >
                  {{ t("settings.postgresBackupHint") }}
                </NText>
              </NCard>

              <NCard
                v-if="database.canMigrateToPostgres && auth.can('settings:write')"
                size="small"
                :title="t('settings.migrateTitle')"
              >
                <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                  {{ t("settings.migrateHint") }}
                </NText>
                <NForm label-placement="top">
                  <div class="split-2">
                    <NFormItem :label="t('settings.host')">
                      <NInput
                        v-model:value="migrate.host"
                        :placeholder="t('settings.hostPlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.port')">
                      <NInputNumber
                        v-model:value="migrate.port"
                        :min="1"
                        :max="65535"
                        style="width: 100%"
                      />
                    </NFormItem>
                  </div>
                  <div class="split-2">
                    <NFormItem :label="t('settings.databaseLabel')">
                      <NInput
                        v-model:value="migrate.database"
                        :placeholder="t('settings.databasePlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.sslMode')">
                      <NSelect
                        v-model:value="migrate.sslMode"
                        :options="sslModeOptions"
                      />
                    </NFormItem>
                  </div>
                  <div class="split-2">
                    <NFormItem :label="t('settings.username')">
                      <NInput
                        v-model:value="migrate.username"
                        :placeholder="t('settings.usernamePlaceholder')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.password')">
                      <NInput
                        v-model:value="migrate.password"
                        type="password"
                        show-password-on="click"
                        placeholder="••••••••"
                      />
                    </NFormItem>
                  </div>
                  <NText
                    depth="3"
                    style="display: block; margin: -0.25rem 0 0.85rem; font-size: 0.85rem"
                  >
                    {{ t("settings.connectionPreview") }}
                    <code class="wrap">{{ migrateUrlPreview }}</code>
                  </NText>
                  <NFormItem :label="t('settings.wipeTarget')">
                    <NSwitch v-model:value="confirmWipe" />
                  </NFormItem>
                  <NButton
                    type="primary"
                    :loading="migrating"
                    @click="runMigrate"
                  >
                    {{ t("settings.migrateSwitch") }}
                  </NButton>
                </NForm>
              </NCard>
            </div>
          </div>
        </NTabPane>

        <NTabPane
          v-if="auth.can('settings:read')"
          name="authentication"
          :tab="t('settings.tabAuthentication')"
        >
          <div class="tab-body auth-stack">
            <NText
              v-if="oauthError"
              type="error"
              style="display: block; margin-bottom: 0.75rem"
            >
              {{ t("settings.authLoadError", { error: oauthError }) }}
            </NText>

            <p class="hint">
              {{
                t("settings.authHint", {
                  origin: publicOrigin || t("settings.notSet"),
                })
              }}
            </p>

            <NCard size="small" :title="t('settings.ssoProvisioning')">
              <NForm label-placement="top">
                <div class="split-2">
                  <NFormItem :label="t('settings.defaultRole')">
                    <NSelect
                      v-model:value="oauth.defaultRole"
                      :options="roleOptions"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem :label="t('settings.autoProvision')">
                    <NSwitch
                      v-model:value="oauth.autoProvision"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                </div>
              </NForm>
            </NCard>

            <NTabs v-model:value="authSubTab" type="line" animated size="small">
              <NTabPane name="oidc" :tab="t('settings.tabOidc')">
                <div v-if="oidcProvider" class="auth-pane">
                  <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                    {{ t("settings.oidcCallback") }}
                    <code class="wrap">{{ oidcCallbackUrl }}</code>
                  </NText>
                  <NForm label-placement="top">
                    <div class="provider-head">
                      <NSwitch
                        v-model:value="oidcProvider.enabled"
                        :disabled="!auth.can('settings:write')"
                      >
                        <template #checked>{{ t("settings.enabled") }}</template>
                        <template #unchecked>{{ t("settings.disabled") }}</template>
                      </NSwitch>
                    </div>
                    <NFormItem :label="t('settings.issuerUrl')">
                      <NInput
                        v-model:value="oidcProvider.issuer"
                        :placeholder="t('settings.issuerPlaceholder')"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <div class="split-2">
                      <NFormItem :label="t('settings.clientId')">
                        <NInput
                          v-model:value="oidcProvider.clientId"
                          :disabled="!auth.can('settings:write')"
                        />
                      </NFormItem>
                      <NFormItem
                        :label="
                          oidcProvider.hasClientSecret
                            ? t('settings.clientSecretKeep')
                            : t('settings.clientSecret')
                        "
                      >
                        <NInput
                          v-model:value="oidcProvider.clientSecret"
                          type="password"
                          show-password-on="click"
                          :placeholder="oidcProvider.hasClientSecret ? '••••••••' : ''"
                          :disabled="!auth.can('settings:write')"
                        />
                      </NFormItem>
                    </div>
                    <NFormItem :label="t('settings.scopesSpace')">
                      <NInput
                        v-model:value="oidcProvider.scopesText"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                  </NForm>
                </div>
              </NTabPane>

              <NTabPane name="saml" :tab="t('settings.tabSaml')">
                <div class="auth-pane">
                  <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                    {{ t("settings.samlAcs") }}
                    <code class="wrap">{{ samlAcsUrl }}</code>
                  </NText>
                  <NForm label-placement="top">
                    <NFormItem :label="t('settings.enableSaml')">
                      <NSwitch
                        v-model:value="saml.enabled"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.idpEntityId')">
                      <NInput
                        v-model:value="saml.idpEntityId"
                        :placeholder="t('settings.idpEntityPlaceholder')"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.idpSsoUrl')">
                      <NInput
                        v-model:value="saml.ssoUrl"
                        :placeholder="t('settings.idpSsoPlaceholder')"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.idpCertificate')">
                      <NInput
                        v-model:value="saml.certificate"
                        type="textarea"
                        :autosize="{ minRows: 3, maxRows: 8 }"
                        :placeholder="t('settings.certPlaceholder')"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <NFormItem :label="t('settings.emailAttribute')">
                      <NInput
                        v-model:value="saml.emailAttribute"
                        :placeholder="t('settings.emailAttrPlaceholder')"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                  </NForm>
                </div>
              </NTabPane>

              <NTabPane name="scim" :tab="t('settings.tabScim')">
                <div class="auth-pane">
                  <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                    {{ t("settings.scimBase") }}
                    <code class="wrap">{{ scimBaseUrl }}</code>
                  </NText>
                  <NForm label-placement="top">
                    <NFormItem :label="t('settings.enableScim')">
                      <NSwitch
                        v-model:value="scim.enabled"
                        :disabled="!auth.can('settings:write')"
                      />
                    </NFormItem>
                    <NFormItem
                      :label="
                        scim.hasToken
                          ? t('settings.bearerTokenKeep')
                          : t('settings.bearerToken')
                      "
                    >
                      <div class="token-row">
                        <NInput
                          v-model:value="scim.bearerToken"
                          type="password"
                          show-password-on="click"
                          :placeholder="scim.hasToken ? '••••••••' : t('settings.tokenPlaceholder')"
                          :disabled="!auth.can('settings:write')"
                        />
                        <NButton
                          secondary
                          :disabled="!auth.can('settings:write')"
                          @click="generateScimToken"
                        >
                          {{ t("settings.generate") }}
                        </NButton>
                      </div>
                    </NFormItem>
                  </NForm>
                </div>
              </NTabPane>
            </NTabs>

            <NSpace v-if="auth.can('settings:write')">
              <NButton
                type="primary"
                :loading="savingAuth || savingOauth"
                @click="saveAuth"
              >
                {{ t("settings.saveAuth") }}
              </NButton>
            </NSpace>
          </div>
        </NTabPane>
      </NTabs>
    </NSpin>
  </div>
</template>

<style scoped>
.tab-body {
  margin-top: 1rem;
}
.span-2 {
  grid-column: 1 / -1;
}
.db-stack,
.auth-stack,
.host-stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.auth-pane {
  padding-top: 0.85rem;
}
.token-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}
.token-row .n-input {
  flex: 1;
}
code.wrap {
  word-break: break-all;
  white-space: pre-wrap;
}
.runtime {
  width: 100%;
  border-collapse: collapse;
}
.runtime th,
.runtime td {
  text-align: left;
  padding: 0.55rem 0.35rem;
  border-bottom: 1px solid var(--n-divider-color, #e2e8ee);
  vertical-align: top;
  font-size: 0.92rem;
}
.runtime th {
  width: 7rem;
  color: var(--app-text-muted);
  font-weight: 500;
}
.hint {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  opacity: 0.8;
}
.provider {
  padding: 0.85rem;
  margin-bottom: 0.85rem;
  border: 1px solid var(--n-border-color, #d5dde5);
  border-radius: 10px;
}
.provider-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.5rem;
}
.checks {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.9rem;
  line-height: 1.4;
}
.restart-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
</style>

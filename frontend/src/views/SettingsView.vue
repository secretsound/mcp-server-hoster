<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
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
import { useAuthStore } from "../stores/auth";
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

const servers = useServersStore();
const auth = useAuthStore();
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

const sandboxModeOptions = [
  { label: "Auto (bwrap → landlock → none)", value: "auto" },
  { label: "Bubblewrap", value: "bwrap" },
  { label: "Landlock", value: "landlock" },
  { label: "None (soft isolation only)", value: "none" },
];

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
  { label: "User", value: "user" },
  { label: "Admin", value: "admin" },
]);

const oauthError = ref("");
const activeTab = ref("general");
const exporting = ref(false);
const restoring = ref(false);
const migrating = ref(false);
const restarting = ref(false);
const migrateUrl = ref("");
const confirmWipe = ref(false);
const sessions = ref<
  Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>
>([]);
const sessionsLoading = ref(false);
const revokingSessions = ref(false);

const healthWarnings = computed(() =>
  (health.value?.checks || []).filter((c) => !c.ok),
);

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
    await loadSessions();
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
  migrateUrl.value = s["host.database_url"]?.startsWith("postgres")
    ? s["host.database_url"]
    : migrateUrl.value || "postgres://user:pass@localhost:5432/mcp_hoster";
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
      message.warning("Saved — restart the host to apply pending changes");
    } else {
      message.success(
        res.sandbox
          ? `Saved (sandbox active: ${res.sandbox.active})`
          : "Saved",
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
    "host.public_url": general.publicUrl,
    "host.gateway_public_url": general.gatewayPublicUrl,
  }, "general");
}

async function saveHost() {
  await putSettings({
    "host.bind": host.bind,
    "host.port": String(host.port),
    "host.data_dir": host.dataDir,
    "host.sandbox_mode": host.sandboxMode,
    "host.auth_disabled": host.authDisabled ? "true" : "false",
    "host.auth_allow_open": host.authAllowOpen ? "true" : "false",
  }, "host");
}

async function saveOauth() {
  savingOauth.value = true;
  try {
    const { oauth: updated } = await api<{ oauth: OAuthSettings }>(
      "/api/auth/oauth/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          publicUrl: oauth.publicUrl.trim() || null,
          autoProvision: oauth.autoProvision,
          defaultRole: oauth.defaultRole,
          providers: oauth.providers.map((p) => ({
            id: p.id,
            enabled: p.enabled,
            label: p.label,
            clientId: p.clientId,
            clientSecret: p.clientSecret || undefined,
            issuer: p.issuer,
            authorizationEndpoint: p.authorizationEndpoint,
            tokenEndpoint: p.tokenEndpoint,
            userinfoEndpoint: p.userinfoEndpoint,
            scopes: p.scopesText.split(/\s+/).filter(Boolean),
          })),
        }),
      },
    );
    applyOauth(updated);
    general.publicUrl = updated.publicUrl ?? general.publicUrl;
    message.success("OAuth settings saved");
    health.value = await api<HealthResponse>("/health");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
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
      throw new Error(body.error || `Backup failed (${res.status})`);
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
    message.success("Backup downloaded");
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
    if (!res.ok) throw new Error(body.error || `Restore failed (${res.status})`);
    restartRequired.value = true;
    message.warning(body.message || "Restore staged — restart the host");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    restoring.value = false;
  }
}

async function runMigrate() {
  if (!migrateUrl.value.trim()) {
    message.error("Enter a Postgres database URL");
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
        databaseUrl: migrateUrl.value.trim(),
        confirmWipe: confirmWipe.value,
      }),
    });
    restartRequired.value = true;
    const tableCount = Object.keys(res.counts || {}).length;
    message.success(
      `Migrated ${tableCount} tables to Postgres. Restart the host to switch.`,
    );
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
    message.info("Host is restarting…");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    restarting.value = false;
  }
}

async function loadSessions() {
  if (!auth.isAuthenticated) return;
  sessionsLoading.value = true;
  try {
    const res = await auth.listSessions();
    sessions.value = res.sessions ?? [];
  } catch {
    sessions.value = [];
  } finally {
    sessionsLoading.value = false;
  }
}

async function revokeOtherSessions() {
  revokingSessions.value = true;
  try {
    await auth.revokeOtherSessions();
    message.success("Other sessions revoked");
    await loadSessions();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    revokingSessions.value = false;
  }
}

async function revokeOneSession(id: string) {
  try {
    await auth.revokeSession(id);
    message.success("Session revoked");
    await loadSessions();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="page-sub">Host configuration, database, and authentication</p>
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
            Some settings are pending until the host restarts
            <template v-if="database?.pendingBootstrap?.pending">
              (bootstrap file differs from the live process).
            </template>
          </span>
          <NButton
            v-if="auth.can('settings:write')"
            size="small"
            type="warning"
            :loading="restarting"
            @click="requestRestart"
          >
            Restart host
          </NButton>
        </div>
      </NAlert>

      <NTabs v-if="!loadError" v-model:value="activeTab" type="line" animated>
        <NTabPane name="general" tab="General">
          <div class="tab-body">
            <NCard
              v-if="healthWarnings.length"
              size="small"
              title="Health checks"
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
              <NCard size="small" title="Appearance & URLs">
                <NForm label-placement="top">
                  <NFormItem label="Display name">
                    <NInput
                      v-model:value="general.displayName"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem label="Default log tail">
                    <NInputNumber
                      v-model:value="general.logTail"
                      :min="50"
                      :max="5000"
                      style="width: 100%"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem label="Notes">
                    <NInput
                      v-model:value="general.notes"
                      type="textarea"
                      :autosize="{ minRows: 3, maxRows: 8 }"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem label="Public URL">
                    <NSpace vertical style="width: 100%">
                      <NAlert
                        v-if="needsPublicUrl"
                        type="error"
                        :bordered="false"
                      >
                        OAuth needs a public URL for browser sign-in.
                      </NAlert>
                      <NSpace>
                        <NInput
                          v-model:value="general.publicUrl"
                          placeholder="https://mcp.example.com"
                          style="min-width: min(320px, 60vw)"
                          :disabled="!auth.can('settings:write')"
                        />
                        <NButton
                          quaternary
                          :disabled="!auth.can('settings:write')"
                          @click="general.publicUrl = suggestedPublicUrl()"
                        >
                          Use this origin
                        </NButton>
                      </NSpace>
                    </NSpace>
                  </NFormItem>
                  <NFormItem label="Gateway public URL">
                    <NInput
                      v-model:value="general.gatewayPublicUrl"
                      placeholder="https://mcp.example.com/mcp"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NButton
                    type="primary"
                    :loading="savingGeneral"
                    :disabled="!auth.can('settings:write')"
                    @click="saveGeneral"
                  >
                    Save general
                  </NButton>
                </NForm>
              </NCard>

              <NCard size="small" title="Runtime">
                <table class="runtime">
                  <tbody>
                    <tr>
                      <th>Gateway</th>
                      <td><code>{{ servers.gatewayUrl }}</code></td>
                    </tr>
                    <tr>
                      <th>Public URL</th>
                      <td>
                        <code>{{
                          health?.publicUrl || general.publicUrl || "—"
                        }}</code>
                      </td>
                    </tr>
                    <tr>
                      <th>Listen</th>
                      <td>
                        <code>
                          {{ health?.bind || host.bind }}:{{
                            health?.port || host.port
                          }}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <th>Database</th>
                      <td><code>{{ health?.database || "—" }}</code></td>
                    </tr>
                    <tr>
                      <th>Auth</th>
                      <td>
                        {{
                          authRequired
                            ? "Required"
                            : host.authDisabled
                            ? "Disabled"
                            : "Open until first user"
                        }}
                      </td>
                    </tr>
                    <tr>
                      <th>Sandbox</th>
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

        <NTabPane name="host" tab="Host">
          <div class="tab-body">
            <NCard size="small" title="Process & listen">
              <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                Bind, port, data directory, and auth flags require a restart.
                Sandbox mode applies to newly started servers immediately.
              </NText>
              <NForm label-placement="top">
                <div class="split-2">
                  <NFormItem label="Bind address">
                    <NInput
                      v-model:value="host.bind"
                      :disabled="!auth.can('settings:write')"
                    />
                    <NTag size="tiny" :bordered="false" style="margin-top: 0.35rem">
                      restart
                    </NTag>
                  </NFormItem>
                  <NFormItem label="Port">
                    <NInputNumber
                      v-model:value="host.port"
                      :min="1"
                      :max="65535"
                      style="width: 100%"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                </div>
                <NFormItem label="Data directory">
                  <NInput
                    v-model:value="host.dataDir"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NFormItem label="Process sandbox">
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
                      Active:
                      <code>{{ sandboxActive?.active || "—" }}</code>
                      <span v-if="sandboxActive?.detail">
                        — {{ sandboxActive.detail }}
                      </span>
                    </NText>
                  </div>
                </NFormItem>
                <NAlert type="warning" :bordered="false" style="margin-bottom: 0.85rem">
                  Disabling auth exposes the admin API and MCP gateway without
                  credentials. Prefer bootstrap admin users in production.
                </NAlert>
                <NFormItem label="Disable authentication">
                  <NSwitch
                    v-model:value="host.authDisabled"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NFormItem label="Allow open access until first user">
                  <NSwitch
                    v-model:value="host.authAllowOpen"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NButton
                  type="primary"
                  :loading="savingHost"
                  :disabled="!auth.can('settings:write')"
                  @click="saveHost"
                >
                  Save host settings
                </NButton>
              </NForm>
            </NCard>
          </div>
        </NTabPane>

        <NTabPane
          v-if="auth.can('settings:read')"
          name="database"
          tab="Database"
        >
          <div class="tab-body">
            <NText
              v-if="databaseError"
              type="error"
              style="display: block; margin-bottom: 0.75rem"
            >
              Could not load database info: {{ databaseError }}
            </NText>
            <div v-else-if="database" class="split-2">
              <NCard size="small" title="Connection">
                <table class="runtime">
                  <tbody>
                    <tr>
                      <th>Engine</th>
                      <td>{{ database.engine }}</td>
                    </tr>
                    <tr>
                      <th>URL</th>
                      <td>
                        <code class="wrap">{{
                          database.urlRedacted || database.url
                        }}</code>
                      </td>
                    </tr>
                    <tr v-if="database.engine === 'sqlite'">
                      <th>Path</th>
                      <td><code class="wrap">{{ database.path }}</code></td>
                    </tr>
                    <tr>
                      <th>Data dir</th>
                      <td><code class="wrap">{{ database.dataDir }}</code></td>
                    </tr>
                    <tr v-if="database.sizeBytes != null">
                      <th>Size</th>
                      <td>{{ formatBytes(database.sizeBytes) }}</td>
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
                    Download SQLite backup
                  </NButton>
                  <NButton
                    v-if="database.canRestore"
                    secondary
                    :loading="restoring"
                    tag="label"
                    style="cursor: pointer"
                  >
                    Upload restore…
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
                  Postgres backups use <code>pg_dump</code> outside this UI.
                </NText>
              </NCard>

              <NCard size="small" title="Tables">
                <table class="runtime">
                  <tbody>
                    <tr v-for="(n, name) in database.counts" :key="name">
                      <th>{{ name }}</th>
                      <td>{{ n }}</td>
                    </tr>
                  </tbody>
                </table>
              </NCard>

              <NCard
                v-if="database.canMigrateToPostgres && auth.can('settings:write')"
                size="small"
                title="Migrate to Postgres"
                class="span-2"
              >
                <NText depth="3" style="display: block; margin-bottom: 0.75rem">
                  Copies all application tables into a Postgres database, writes
                  <code>host.json</code>, then requires a host restart. Existing
                  target rows need “confirm wipe”.
                </NText>
                <NForm label-placement="top">
                  <NFormItem label="Postgres URL">
                    <NInput
                      v-model:value="migrateUrl"
                      type="password"
                      show-password-on="click"
                      placeholder="postgres://user:pass@host:5432/mcp_hoster"
                    />
                  </NFormItem>
                  <NFormItem label="Wipe existing target rows if present">
                    <NSwitch v-model:value="confirmWipe" />
                  </NFormItem>
                  <NButton
                    type="primary"
                    :loading="migrating"
                    @click="runMigrate"
                  >
                    Migrate &amp; switch
                  </NButton>
                </NForm>
              </NCard>

              <NCard size="small" title="Migrations" class="span-2">
                <table class="runtime">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="m in database.migrations" :key="m.version">
                      <td><code>{{ m.version }}</code></td>
                      <td>{{ new Date(m.appliedAt).toLocaleString() }}</td>
                    </tr>
                    <tr v-if="!database.migrations.length">
                      <td colspan="2">No migrations recorded</td>
                    </tr>
                  </tbody>
                </table>
              </NCard>
            </div>
          </div>
        </NTabPane>

        <NTabPane
          v-if="auth.can('settings:read')"
          name="authentication"
          tab="Authentication"
        >
          <div class="tab-body">
            <NCard
              v-if="auth.isAuthenticated"
              size="small"
              title="Your sessions"
              style="margin-bottom: 1rem"
            >
              <NSpace style="margin-bottom: 0.75rem">
                <NButton size="small" :loading="sessionsLoading" @click="loadSessions">
                  Refresh
                </NButton>
                <NButton
                  size="small"
                  type="warning"
                  secondary
                  :loading="revokingSessions"
                  @click="revokeOtherSessions"
                >
                  Revoke other sessions
                </NButton>
              </NSpace>
              <table class="runtime">
                <tbody>
                  <tr v-for="s in sessions" :key="s.id">
                    <th>
                      <code>{{ s.id.slice(0, 12) }}…</code>
                      <NTag
                        v-if="s.current"
                        size="tiny"
                        type="success"
                        :bordered="false"
                        style="margin-left: 0.35rem"
                      >
                        this device
                      </NTag>
                    </th>
                    <td>
                      Created {{ new Date(s.createdAt).toLocaleString() }}
                      · expires {{ new Date(s.expiresAt).toLocaleString() }}
                      <NButton
                        v-if="!s.current"
                        size="tiny"
                        quaternary
                        type="error"
                        style="margin-left: 0.5rem"
                        @click="revokeOneSession(s.id)"
                      >
                        Revoke
                      </NButton>
                    </td>
                  </tr>
                  <tr v-if="!sessions.length">
                    <td colspan="2">No sessions listed</td>
                  </tr>
                </tbody>
              </table>
            </NCard>

            <NText
              v-if="oauthError"
              type="error"
              style="display: block; margin-bottom: 0.75rem"
            >
              Could not load OAuth settings: {{ oauthError }}
            </NText>
            <p class="hint">
              Configure OAuth / SSO providers. Register this callback with each
              IdP:
              <code>{{ oauth.callbackUrlTemplate }}</code>
            </p>
            <NForm label-placement="top">
              <div class="split-2">
                <NFormItem label="Public URL">
                  <NInput
                    v-model:value="oauth.publicUrl"
                    placeholder="https://mcp.example.com"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NFormItem label="Default role (auto-provision)">
                  <NSelect
                    v-model:value="oauth.defaultRole"
                    :options="roleOptions"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
              </div>
              <NFormItem label="Auto-provision users on first login">
                <NSwitch
                  v-model:value="oauth.autoProvision"
                  :disabled="!auth.can('settings:write')"
                />
              </NFormItem>

              <div v-for="p in oauth.providers" :key="p.id" class="provider">
                <div class="provider-head">
                  <strong>{{ p.label }}</strong>
                  <code>{{ p.id }}</code>
                  <NSwitch
                    v-model:value="p.enabled"
                    :disabled="!auth.can('settings:write')"
                  >
                    <template #checked>Enabled</template>
                    <template #unchecked>Disabled</template>
                  </NSwitch>
                </div>
                <div class="split-2">
                  <NFormItem label="Client ID">
                    <NInput
                      v-model:value="p.clientId"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                  <NFormItem
                    :label="
                      p.hasClientSecret
                        ? 'Client secret (leave blank to keep)'
                        : 'Client secret'
                    "
                  >
                    <NInput
                      v-model:value="p.clientSecret"
                      type="password"
                      show-password-on="click"
                      :placeholder="p.hasClientSecret ? '••••••••' : ''"
                      :disabled="!auth.can('settings:write')"
                    />
                  </NFormItem>
                </div>
                <NFormItem v-if="p.id === 'oidc'" label="Issuer URL">
                  <NInput
                    v-model:value="p.issuer"
                    placeholder="https://idp.example.com"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
                <NFormItem label="Scopes (space-separated)">
                  <NInput
                    v-model:value="p.scopesText"
                    :disabled="!auth.can('settings:write')"
                  />
                </NFormItem>
              </div>

              <NSpace v-if="auth.can('settings:write')">
                <NButton
                  type="primary"
                  :loading="savingOauth"
                  @click="saveOauth"
                >
                  Save OAuth settings
                </NButton>
              </NSpace>
            </NForm>
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

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NCheckbox,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NText,
  useMessage,
} from "naive-ui";
import { ArrowBackOutline, CopyOutline } from "@vicons/ionicons5";
import LogViewer from "../components/LogViewer.vue";
import ServerFormFields from "../components/ServerFormFields.vue";
import StatusTag from "../components/StatusTag.vue";
import ToolList from "../components/ToolList.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type {
  AuditEvent,
  ServerFormValues,
  ServerWithRuntime,
  ToolInfo,
} from "../types";
import { splitUvxInvocation, versionLabel } from "../utils/packageSpec";
import {
  buildUpdatePayload,
  copyText,
  isActiveStatus,
  isCrashedStatus,
  serverGatewayUrl,
  showCrashBanner,
  statusOf,
  valuesFromServer,
} from "../utils/serverForm";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const servers = useServersStore();
const auth = useAuthStore();
const message = useMessage();

const id = computed(() => String(route.params.id || ""));
const server = ref<ServerWithRuntime | null>(null);
const loadError = ref("");
const formError = ref("");
const saving = ref(false);
const logs = ref(t("serverDetail.logsLoading"));
const tools = ref<ToolInfo[]>([]);
const logsLoading = ref(false);
const toolsLoading = ref(false);
const activity = ref<AuditEvent[]>([]);
const activityLoading = ref(false);
const deleteOpen = ref(false);
const deleteConfirm = ref("");
const deleting = ref(false);
const upgradeVersion = ref("");
const clearCacheOnUpgrade = ref(true);
const upgrading = ref(false);
const TAB_NAMES = ["config", "upgrade", "logs", "tools", "activity"] as const;

const activeTab = ref(
  typeof route.query.tab === "string" &&
    (TAB_NAMES as readonly string[]).includes(route.query.tab)
    ? route.query.tab
    : "config",
);
let stopLogStream: (() => void) | null = null;

const canUpgrade = computed(() => {
  if (!server.value || !auth.can("servers:write")) return false;
  if (server.value.source?.git) return true;
  const cmd = server.value.command;
  const args = server.value.args || [];
  if (cmd === "npx" && args[0] === "-y" && args[1]) return true;
  if (cmd === "uvx") {
    const { packageSpec } = splitUvxInvocation(args);
    if (packageSpec && !packageSpec.includes("://")) return true;
  }
  return false;
});

const displayedVersion = computed(() =>
  server.value ? versionLabel(server.value) : null,
);

watch(
  () => route.query.tab,
  (tab) => {
    if (
      typeof tab === "string" &&
      (TAB_NAMES as readonly string[]).includes(tab)
    ) {
      activeTab.value = tab;
    }
  },
);

const form = reactive<ServerFormValues>({
  id: "",
  name: "",
  launcher: "npx",
  package: "",
  packageVersion: "",
  command: "",
  extraArgs: "",
  argsLines: "",
  env: [{ key: "", value: "" }],
  git: "",
  ref: "",
  startNow: true,
});

const mcpUrl = computed(() =>
  server.value
    ? serverGatewayUrl(servers.gatewayUrl, server.value.id)
    : "",
);

const st = computed(() => (server.value ? statusOf(server.value) : "stopped"));

const monogram = computed(() => {
  const name = (server.value?.name || server.value?.id || "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const launcher = computed(() => {
  if (!server.value) return "";
  if (server.value.command === "npx") return "npx";
  if (server.value.command === "uvx") return "uvx";
  return server.value.command || "custom";
});

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function applyServer(s: ServerWithRuntime) {
  server.value = s;
  Object.assign(form, valuesFromServer(s));
  upgradeVersion.value = s.packageVersion || s.source?.ref || "";
}

async function loadServer() {
  loadError.value = "";
  try {
    const s = await servers.getServer(id.value);
    applyServer(s);
  } catch (err) {
    server.value = null;
    loadError.value = err instanceof Error ? err.message : String(err);
  }
}

function startLogStream() {
  stopLogStream?.();
  stopLogStream = null;
  logsLoading.value = true;
  logs.value = t("serverDetail.logsConnecting");
  stopLogStream = servers.streamLogs(
    id.value,
    {
      onReset: (text) => {
        logs.value = text || t("serverDetail.logsEmpty");
        logsLoading.value = false;
      },
      onChunk: (chunk) => {
        if (!chunk) return;
        if (
          logs.value === t("serverDetail.logsEmpty") ||
          logs.value === t("serverDetail.logsConnecting")
        ) {
          logs.value = chunk;
        } else {
          logs.value += chunk;
        }
        // Keep a reasonable in-memory tail
        if (logs.value.length > 200_000) {
          logs.value = logs.value.slice(-160_000);
        }
      },
      onError: () => {
        logsLoading.value = false;
      },
    },
    300,
  );
}

async function loadTools() {
  toolsLoading.value = true;
  try {
    tools.value = await servers.tools(id.value);
  } catch (err) {
    tools.value = [];
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    toolsLoading.value = false;
  }
}

const toolsBusy = ref(false);
const enabledToolCount = computed(
  () => tools.value.filter((tool) => tool.enabled !== false).length,
);

const toolsTabLabel = computed(() => {
  if (!tools.value.length) return t("serverDetail.tabTools");
  if (enabledToolCount.value === tools.value.length) {
    return t("serverDetail.tabToolsCount", { count: enabledToolCount.value });
  }
  return t("serverDetail.tabToolsPartial", {
    enabled: enabledToolCount.value,
    total: tools.value.length,
  });
});

async function persistDisabledTools(disabledTools: string[]) {
  toolsBusy.value = true;
  try {
    const updated = await servers.update(id.value, { disabledTools });
    applyServer(updated);
    // Keep list in sync immediately (SSE may lag).
    const disabled = new Set(disabledTools);
    tools.value = tools.value.map((t) => ({
      ...t,
      enabled: !disabled.has(t.name),
    }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await loadTools();
  } finally {
    toolsBusy.value = false;
  }
}

async function onToolSetEnabled(payload: { name: string; enabled: boolean }) {
  const current = new Set(server.value?.disabledTools ?? []);
  if (payload.enabled) current.delete(payload.name);
  else current.add(payload.name);
  await persistDisabledTools([...current].sort());
}

async function onToolSetAllEnabled(enabled: boolean) {
  if (enabled) {
    await persistDisabledTools([]);
    return;
  }
  await persistDisabledTools(
    tools.value.map((t) => t.name).sort(),
  );
}

async function act(action: "start" | "stop" | "restart") {
  try {
    await servers.lifecycle(id.value, action);
    await loadServer();
    await loadTools();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

const enabling = ref(false);

async function onEnabledChange(enabled: boolean) {
  enabling.value = true;
  try {
    const updated = await servers.update(id.value, { enabled });
    applyServer(updated);
    await loadTools();
    message.success(
      enabled ? t("serverDetail.enabledKeepRunning") : t("common.disabled"),
    );
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await loadServer();
  } finally {
    enabling.value = false;
  }
}

async function onUpgrade(toLatest = false) {
  upgrading.value = true;
  try {
    const result = await servers.upgrade(id.value, {
      version: toLatest ? null : (upgradeVersion.value.trim() || null),
      clearCache: clearCacheOnUpgrade.value,
    });
    message.success(
      t("serverDetail.upgradedTo", { label: result.upgrade.label }),
    );
    await loadServer();
    await loadTools();
    if (auth.can("audit:read")) void loadActivity();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    upgrading.value = false;
  }
}

function openDelete() {
  deleteConfirm.value = "";
  deleteOpen.value = true;
}

async function onDelete() {
  if (deleteConfirm.value !== id.value) {
    message.warning(t("serverDetail.typeToConfirm", { id: id.value }));
    return;
  }
  deleting.value = true;
  try {
    await servers.remove(id.value);
    message.success(t("common.deleted"));
    deleteOpen.value = false;
    await router.push("/");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    deleting.value = false;
  }
}

async function loadActivity() {
  if (!auth.can("audit:read")) return;
  activityLoading.value = true;
  try {
    const res = await auth.listAudit({
      limit: 30,
      resourceType: "server",
      resourceId: id.value,
    });
    activity.value = res.events;
  } catch {
    activity.value = [];
  } finally {
    activityLoading.value = false;
  }
}

async function onSave() {
  formError.value = "";
  saving.value = true;
  try {
    // Keep header Enabled switch authoritative — don't flip it via form save.
    const body = {
      ...buildUpdatePayload(form),
      enabled: server.value?.enabled !== false,
    };
    const s = await servers.update(id.value, body);
    applyServer(s);
    message.success(t("common.saved"));
    await loadTools();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function copyEndpoint() {
  if (await copyText(mcpUrl.value)) {
    message.success(t("serverDetail.endpointCopied"));
  }
}

onMounted(async () => {
  await loadServer();
  await loadTools();
  startLogStream();
  await loadActivity();
});

onUnmounted(() => {
  stopLogStream?.();
  stopLogStream = null;
});

watch(id, async () => {
  await loadServer();
  await loadTools();
  startLogStream();
  await loadActivity();
});

watch(activeTab, (tab) => {
  if (tab === "activity") void loadActivity();
});

// Keep status/pid in sync from the live servers SSE feed without clobbering the form.
watch(
  () => servers.servers.find((s) => s.id === id.value),
  (live) => {
    if (!live || !server.value) return;
    server.value = {
      ...server.value,
      runtime: live.runtime,
      toolCount: live.toolCount,
    };
  },
  { deep: true },
);
</script>

<template>
  <div class="detail-page">
    <NSpin v-if="!server && !loadError" style="margin-top: 2rem" />

    <template v-else-if="loadError">
      <div class="page-head">
        <div>
          <RouterLink class="back" to="/">
            <NIcon :component="ArrowBackOutline" />
            {{ t("serverDetail.backToServers") }}
          </RouterLink>
          <h1 class="page-title">{{ t("serverDetail.notFound") }}</h1>
          <p class="page-sub">{{ loadError }}</p>
        </div>
      </div>
    </template>

    <template v-else-if="server">
      <section
        class="hero"
        :class="{
          running: st === 'running',
          crashed: isCrashedStatus(st),
        }"
      >
        <div class="hero-main">
          <RouterLink class="back" to="/">
            <NIcon :component="ArrowBackOutline" />
            {{ t("serverDetail.backToServers") }}
          </RouterLink>
          <div class="hero-row">
            <div class="hero-mark" aria-hidden="true">{{ monogram }}</div>
            <div class="hero-text">
              <h1 class="hero-title">{{ server.name || server.id }}</h1>
              <div class="hero-chips">
                <span class="chip mono">{{ server.id }}</span>
                <StatusTag
                  :status="st"
                  :error="isCrashedStatus(st) ? server.runtime?.lastError : null"
                />
                <span v-if="launcher" class="chip">{{ launcher }}</span>
                <span v-if="displayedVersion" class="chip">{{ displayedVersion }}</span>
                <span v-if="server.enabled === false" class="chip chip-warn">
                  {{ t("common.disabled") }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="hero-actions">
          <div
            v-if="auth.can('servers:write')"
            class="enabled-toggle"
            :title="t('serverDetail.enabledTitle')"
          >
            <NText depth="3">{{ t("common.enabled") }}</NText>
            <NSwitch
              :value="server.enabled !== false"
              :loading="enabling"
              @update:value="onEnabledChange"
            />
          </div>
          <NButton
            v-if="auth.can('servers:lifecycle') && isActiveStatus(st)"
            :loading="servers.busyIds[server.id]"
            @click="act('stop')"
          >
            {{ t("common.stop") }}
          </NButton>
          <NButton
            v-else-if="auth.can('servers:lifecycle')"
            type="primary"
            :loading="servers.busyIds[server.id]"
            @click="act('start')"
          >
            {{ t("common.start") }}
          </NButton>
          <NButton
            v-if="auth.can('servers:lifecycle') && isActiveStatus(st)"
            :loading="servers.busyIds[server.id]"
            @click="act('restart')"
          >
            {{ t("common.restart") }}
          </NButton>
          <NButton
            v-if="auth.can('servers:write')"
            type="error"
            secondary
            @click="openDelete"
          >
            {{ t("common.delete") }}
          </NButton>
        </div>
      </section>

      <div class="metrics">
        <div class="metric">
          <span class="metric-label">{{ t("serverDetail.restarts") }}</span>
          <strong>{{ server.runtime?.restartCount ?? 0 }}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">{{ t("serverDetail.lastStarted") }}</span>
          <strong>{{ formatWhen(server.runtime?.lastStartedAt) }}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">{{ t("serverDetail.lastCrash") }}</span>
          <strong>{{ formatWhen(server.runtime?.lastCrashAt) }}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">{{ t("serverDetail.tools") }}</span>
          <strong>{{ server.toolCount ?? tools.length }}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">{{ t("serverDetail.lastUpgraded") }}</span>
          <strong>{{ formatWhen(server.lastUpgradedAt) }}</strong>
        </div>
      </div>

      <div class="url-card">
        <div class="url-card-top">
          <span class="metric-label">{{ t("serverDetail.mcpEndpoint") }}</span>
          <NButton size="tiny" quaternary @click="copyEndpoint">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
        </div>
        <code class="url-value">{{ mcpUrl }}</code>
        <p class="url-hint">
          {{ t("serverDetail.endpointHint", { ns: `${server.id}__*` }) }}
        </p>
      </div>

      <div
        v-if="showCrashBanner(st, server.runtime?.lastError)"
        class="banner banner-err"
      >
        <div>
          <strong>{{ t("serverDetail.crashedTitle") }}</strong>
          <p>{{ server.runtime?.lastError }}</p>
        </div>
        <NButton size="small" type="error" secondary @click="activeTab = 'logs'">
          {{ t("serverDetail.openLogs") }}
        </NButton>
      </div>
      <div v-else-if="st === 'restarting'" class="banner banner-warn">
        {{ t("serverDetail.restarting") }}
      </div>

      <NTabs v-model:value="activeTab" type="line" animated class="detail-tabs">
        <NTabPane name="config" :tab="t('serverDetail.tabConfig')">
          <div class="panel">
            <ServerFormFields
              v-model="form"
              :show-id="true"
              id-disabled
              :show-enabled="false"
            />
            <p v-if="formError" class="form-error">{{ formError }}</p>
            <div class="panel-foot">
              <NButton type="primary" :loading="saving" @click="onSave">
                {{ t("serverDetail.saveChanges") }}
              </NButton>
            </div>
          </div>
        </NTabPane>

        <NTabPane v-if="canUpgrade" name="upgrade" :tab="t('serverDetail.tabUpgrade')">
          <div class="panel">
            <h3 class="panel-title">{{ t("serverDetail.upgradeTitle") }}</h3>
            <p class="panel-help">{{ t("serverDetail.upgradeHelp") }}</p>
            <div class="upgrade-row">
              <NInput
                v-model:value="upgradeVersion"
                :placeholder="t('serverDetail.upgradePlaceholder')"
                style="max-width: 18rem"
              />
              <NCheckbox v-model:checked="clearCacheOnUpgrade">
                {{ t("serverDetail.clearCache") }}
              </NCheckbox>
              <NSpace>
                <NButton
                  type="primary"
                  :loading="upgrading"
                  @click="onUpgrade(false)"
                >
                  {{
                    upgradeVersion.trim()
                      ? t("serverDetail.upgradeToPin")
                      : t("serverDetail.upgradeToLatest")
                  }}
                </NButton>
                <NButton
                  v-if="upgradeVersion.trim()"
                  secondary
                  :loading="upgrading"
                  @click="onUpgrade(true)"
                >
                  {{ t("serverDetail.pullLatest") }}
                </NButton>
              </NSpace>
            </div>
            <p v-if="server.lastUpgradedAt" class="panel-meta">
              {{
                t("serverDetail.lastUpgradedAt", {
                  when: formatWhen(server.lastUpgradedAt),
                })
              }}
            </p>
          </div>
        </NTabPane>

        <NTabPane name="logs" :tab="t('serverDetail.tabLogs')">
          <div class="panel panel-flush">
            <LogViewer
              :logs="logs"
              :loading="logsLoading"
              @refresh="startLogStream"
            />
          </div>
        </NTabPane>

        <NTabPane name="tools" :tab="toolsTabLabel">
          <div class="panel panel-flush">
            <ToolList
              :tools="tools"
              :loading="toolsLoading"
              :can-edit="auth.can('servers:write')"
              :busy="toolsBusy"
              @refresh="loadTools"
              @set-enabled="onToolSetEnabled"
              @set-all-enabled="onToolSetAllEnabled"
            />
          </div>
        </NTabPane>

        <NTabPane
          v-if="auth.can('audit:read')"
          name="activity"
          :tab="t('serverDetail.tabActivity')"
        >
          <div class="panel">
            <NSpin :show="activityLoading">
              <NEmpty
                v-if="!activity.length"
                :description="t('serverDetail.noAuditEvents')"
              />
              <div v-else class="activity">
                <div v-for="ev in activity" :key="ev.id" class="activity-row">
                  <span class="activity-action">{{ ev.action }}</span>
                  <div class="activity-body">
                    <div>{{ ev.summary }}</div>
                    <span class="activity-meta">
                      {{ ev.actorEmail || t("serverDetail.systemActor") }} ·
                      {{ formatWhen(ev.createdAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </NSpin>
          </div>
        </NTabPane>
      </NTabs>

      <NModal
        v-model:show="deleteOpen"
        preset="card"
        class="delete-modal"
        :title="t('serverDetail.deleteTitle')"
        style="width: min(440px, 96vw)"
        :bordered="false"
      >
        <div class="banner banner-warn" style="margin-bottom: 0.85rem">
          {{ t("serverDetail.deleteWarning", { id }) }}
        </div>
        <NInput
          v-model:value="deleteConfirm"
          :placeholder="id"
          autocomplete="off"
        />
        <NSpace justify="end" style="margin-top: 1rem">
          <NButton @click="deleteOpen = false">{{ t("common.cancel") }}</NButton>
          <NButton
            type="error"
            :loading="deleting"
            :disabled="deleteConfirm !== id"
            @click="onDelete"
          >
            {{ t("serverDetail.deletePermanently") }}
          </NButton>
        </NSpace>
      </NModal>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--app-text-muted);
  font-size: 0.88rem;
  text-decoration: none;
  margin-bottom: 0.65rem;
}
.back:hover {
  color: var(--app-chip-active-text);
}
.page-title {
  margin: 0.35rem 0 0;
}

.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.15rem 1.15rem;
  border-radius: 16px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.hero.running {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 38%, var(--app-border));
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 12%, transparent),
      transparent 58%
    ),
    var(--app-surface);
}
.hero.crashed {
  border-color: color-mix(in srgb, #c23b3b 40%, var(--app-border));
}
.hero-main {
  min-width: 0;
  flex: 1;
}
.hero-row {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
}
.hero-mark {
  flex: 0 0 auto;
  width: 3rem;
  height: 3rem;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  color: #fff;
  background: linear-gradient(145deg, #0d8660 0%, #0b6e4f 55%, #095a41 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, #0b6e4f 28%, transparent);
}
:global(html[data-theme="dark"]) .hero-mark {
  color: #0f161c;
  background: linear-gradient(145deg, #56d9a8 0%, #3ecf9a 55%, #2bb884 100%);
  box-shadow: 0 8px 22px color-mix(in srgb, #3ecf9a 22%, transparent);
}
.hero-title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--app-text);
}
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--app-surface-raised);
  color: var(--app-text-soft);
  border: 1px solid var(--app-border);
}
.chip.mono {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
}
.chip-warn {
  background: color-mix(in srgb, #b8860b 14%, transparent);
  border-color: color-mix(in srgb, #b8860b 32%, transparent);
  color: #9a7209;
}
:global(html[data-theme="dark"]) .chip-warn {
  color: #e0b44a;
  background: color-mix(in srgb, #e0b44a 14%, transparent);
  border-color: color-mix(in srgb, #e0b44a 30%, transparent);
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.enabled-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-right: 0.15rem;
  font-size: 0.88rem;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.7rem;
}
.metric {
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.metric-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.metric strong {
  font-size: 0.92rem;
  font-weight: 650;
  word-break: break-word;
  color: var(--app-text);
}

.url-card {
  display: grid;
  gap: 0.35rem;
  padding: 0.9rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.url-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.url-value {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.86rem;
  word-break: break-all;
  color: var(--app-text);
}
.url-hint {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--app-text-muted);
}

.banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  font-size: 0.88rem;
  line-height: 1.45;
  border: 1px solid var(--app-border);
}
.banner p {
  margin: 0.25rem 0 0;
}
.banner-err {
  background: color-mix(in srgb, #c23b3b 12%, transparent);
  border-color: color-mix(in srgb, #c23b3b 32%, transparent);
  color: #c23b3b;
}
:global(html[data-theme="dark"]) .banner-err {
  color: #f07178;
  background: color-mix(in srgb, #f07178 12%, transparent);
  border-color: color-mix(in srgb, #f07178 30%, transparent);
}
.banner-warn {
  background: color-mix(in srgb, #b8860b 12%, transparent);
  border-color: color-mix(in srgb, #b8860b 30%, transparent);
  color: var(--app-text-soft);
}
:global(html[data-theme="dark"]) .banner-warn {
  background: color-mix(in srgb, #e0b44a 12%, transparent);
  border-color: color-mix(in srgb, #e0b44a 28%, transparent);
}

.detail-tabs :deep(.n-tabs-nav) {
  margin-bottom: 0.85rem;
}
.panel {
  padding: 1.05rem 1.1rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.panel-flush {
  padding: 0.65rem;
}
.panel-title {
  margin: 0 0 0.35rem;
  font-size: 1.02rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.panel-help {
  margin: 0 0 0.9rem;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--app-text-muted);
}
.panel-meta {
  margin: 0.85rem 0 0;
  font-size: 0.82rem;
  color: var(--app-text-muted);
}
.panel-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--app-border);
}
.form-error {
  margin: 0.5rem 0 0;
  color: #c23b3b;
  font-size: 0.88rem;
}
:global(html[data-theme="dark"]) .form-error {
  color: #f07178;
}

.upgrade-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.activity {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.activity-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  border-radius: 11px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.activity-action {
  display: inline-flex;
  align-items: center;
  height: fit-content;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 650;
  background: var(--app-chip-active-bg);
  border: 1px solid var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.activity-body {
  font-size: 0.9rem;
  color: var(--app-text);
}
.activity-meta {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
}

@media (max-width: 720px) {
  .hero-title {
    font-size: 1.25rem;
  }
  .hero-mark {
    width: 2.6rem;
    height: 2.6rem;
  }
}
</style>

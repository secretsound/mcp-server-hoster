<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NEmpty,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
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
  <div>
    <NSpin v-if="!server && !loadError" style="margin-top: 2rem" />

    <template v-else-if="loadError">
      <div class="page-head">
        <div>
          <RouterLink class="back" to="/">{{ t("serverDetail.backToServers") }}</RouterLink>
          <h1 style="margin-top: 0.35rem">{{ t("serverDetail.notFound") }}</h1>
          <p class="page-sub">{{ loadError }}</p>
        </div>
      </div>
    </template>

    <template v-else-if="server">
      <div class="page-head">
        <div>
          <RouterLink class="back" to="/">{{ t("serverDetail.backToServers") }}</RouterLink>
          <h1 style="margin-top: 0.35rem">{{ server.name || server.id }}</h1>
          <p class="page-sub">
            {{ server.id }} ·
            <StatusTag
              :status="st"
              :error="isCrashedStatus(st) ? server.runtime?.lastError : null"
            />
            <template v-if="displayedVersion">
              ·
              <NTag size="small" :bordered="false">{{ displayedVersion }}</NTag>
            </template>
          </p>
        </div>
        <NSpace align="center">
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
            secondary
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
        </NSpace>
      </div>

      <div class="metrics">
        <div class="metric">
          <NText depth="3">{{ t("serverDetail.restarts") }}</NText>
          <strong>{{ server.runtime?.restartCount ?? 0 }}</strong>
        </div>
        <div class="metric">
          <NText depth="3">{{ t("serverDetail.lastStarted") }}</NText>
          <strong>
            {{
              server.runtime?.lastStartedAt
                ? new Date(server.runtime.lastStartedAt).toLocaleString()
                : "—"
            }}
          </strong>
        </div>
        <div class="metric">
          <NText depth="3">{{ t("serverDetail.lastCrash") }}</NText>
          <strong>
            {{
              server.runtime?.lastCrashAt
                ? new Date(server.runtime.lastCrashAt).toLocaleString()
                : "—"
            }}
          </strong>
        </div>
        <div class="metric">
          <NText depth="3">{{ t("serverDetail.tools") }}</NText>
          <strong>{{ server.toolCount ?? tools.length }}</strong>
        </div>
        <div class="metric">
          <NText depth="3">{{ t("serverDetail.lastUpgraded") }}</NText>
          <strong>
            {{
              server.lastUpgradedAt
                ? new Date(server.lastUpgradedAt).toLocaleString()
                : "—"
            }}
          </strong>
        </div>
      </div>

      <NCard size="small" style="margin-bottom: 1rem" class="endpoint-card">
        <div class="endpoint-row">
          <div class="endpoint-main">
            <NText depth="3">{{ t("serverDetail.mcpEndpoint") }}</NText>
            <code class="endpoint-url">{{ mcpUrl }}</code>
          </div>
          <NButton size="small" @click="copyEndpoint">{{ t("common.copy") }}</NButton>
        </div>
        <NText depth="3" class="endpoint-hint">
          {{ t("serverDetail.endpointHint", { ns: `${server.id}__*` }) }}
        </NText>
      </NCard>

      <NAlert
        v-if="showCrashBanner(st, server.runtime?.lastError)"
        type="error"
        style="margin-bottom: 1rem"
        :bordered="false"
        :title="t('serverDetail.crashedTitle')"
      >
        <div class="crash-alert">
          <span>{{ server.runtime?.lastError }}</span>
          <NButton size="tiny" type="error" secondary @click="activeTab = 'logs'">
            {{ t("serverDetail.openLogs") }}
          </NButton>
        </div>
      </NAlert>
      <NAlert
        v-else-if="st === 'restarting'"
        type="warning"
        style="margin-bottom: 1rem"
        :bordered="false"
      >
        {{ t("serverDetail.restarting") }}
      </NAlert>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="config" :tab="t('serverDetail.tabConfig')">
          <NCard size="small">
            <ServerFormFields
              v-model="form"
              :show-id="true"
              id-disabled
              :show-enabled="false"
            />
            <NText v-if="formError" type="error">{{ formError }}</NText>
            <NSpace justify="end" style="margin-top: 0.5rem">
              <NButton type="primary" :loading="saving" @click="onSave">
                {{ t("serverDetail.saveChanges") }}
              </NButton>
            </NSpace>
          </NCard>
        </NTabPane>

        <NTabPane v-if="canUpgrade" name="upgrade" :tab="t('serverDetail.tabUpgrade')">
          <NCard size="small" :title="t('serverDetail.upgradeTitle')">
            <NText depth="3" style="display: block; margin-bottom: 0.75rem">
              {{ t("serverDetail.upgradeHelp") }}
            </NText>
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
            <NText
              v-if="server.lastUpgradedAt"
              depth="3"
              style="display: block; margin-top: 0.85rem; font-size: 0.85rem"
            >
              {{
                t("serverDetail.lastUpgradedAt", {
                  when: new Date(server.lastUpgradedAt).toLocaleString(),
                })
              }}
            </NText>
          </NCard>
        </NTabPane>

        <NTabPane name="logs" :tab="t('serverDetail.tabLogs')">
          <LogViewer
            :logs="logs"
            :loading="logsLoading"
            @refresh="startLogStream"
          />
        </NTabPane>

        <NTabPane name="tools" :tab="toolsTabLabel">
          <ToolList
            :tools="tools"
            :loading="toolsLoading"
            :can-edit="auth.can('servers:write')"
            :busy="toolsBusy"
            @refresh="loadTools"
            @set-enabled="onToolSetEnabled"
            @set-all-enabled="onToolSetAllEnabled"
          />
        </NTabPane>

        <NTabPane
          v-if="auth.can('audit:read')"
          name="activity"
          :tab="t('serverDetail.tabActivity')"
        >
          <NSpin :show="activityLoading">
            <NEmpty
              v-if="!activity.length"
              :description="t('serverDetail.noAuditEvents')"
            />
            <div v-else class="activity">
              <div v-for="ev in activity" :key="ev.id" class="activity-row">
                <NTag size="small" :bordered="false">{{ ev.action }}</NTag>
                <div class="activity-body">
                  <div>{{ ev.summary }}</div>
                  <NText depth="3">
                    {{ ev.actorEmail || t("serverDetail.systemActor") }} ·
                    {{ new Date(ev.createdAt).toLocaleString() }}
                  </NText>
                </div>
              </div>
            </div>
          </NSpin>
        </NTabPane>
      </NTabs>

      <NModal
        v-model:show="deleteOpen"
        preset="card"
        :title="t('serverDetail.deleteTitle')"
        style="width: min(440px, 96vw)"
      >
        <NAlert type="warning" :bordered="false" style="margin-bottom: 0.85rem">
          {{ t("serverDetail.deleteWarning", { id }) }}
        </NAlert>
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
.back {
  color: var(--app-text-muted);
  font-size: 0.9rem;
}
.back:hover {
  color: var(--n-primary-color, #0b6e4f);
}
.crash-alert {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.65rem;
  margin-bottom: 1rem;
}
.metric {
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.metric strong {
  font-size: 0.92rem;
  word-break: break-word;
}
.activity {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.activity-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.activity-body {
  font-size: 0.9rem;
}
.upgrade-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.endpoint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.endpoint-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.endpoint-url {
  font-size: 0.92rem;
  word-break: break-all;
}
.endpoint-hint {
  display: block;
  margin-top: 0.55rem;
  font-size: 0.82rem;
  line-height: 1.4;
}
.enabled-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-right: 0.25rem;
  font-size: 0.88rem;
}
</style>

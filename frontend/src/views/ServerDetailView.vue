<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
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
import { versionLabel } from "../utils/packageSpec";
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
const logs = ref("(loading)");
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
  if (
    cmd === "uvx" &&
    args[0] &&
    !String(args[0]).startsWith("-") &&
    !String(args[0]).includes("://")
  ) {
    return true;
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
  logs.value = "(connecting…)";
  stopLogStream = servers.streamLogs(
    id.value,
    {
      onReset: (text) => {
        logs.value = text || "(empty)";
        logsLoading.value = false;
      },
      onChunk: (chunk) => {
        if (!chunk) return;
        if (logs.value === "(empty)" || logs.value === "(connecting…)") {
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
  () => tools.value.filter((t) => t.enabled !== false).length,
);

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
    message.success(enabled ? "Enabled — will keep running" : "Disabled");
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
    message.success(`Upgraded to ${result.upgrade.label}`);
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
    message.warning(`Type ${id.value} to confirm`);
    return;
  }
  deleting.value = true;
  try {
    await servers.remove(id.value);
    message.success("Deleted");
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
    message.success("Saved");
    await loadTools();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function copyEndpoint() {
  if (await copyText(mcpUrl.value)) message.success("Endpoint copied");
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
          <RouterLink class="back" to="/">← Servers</RouterLink>
          <h1 style="margin-top: 0.35rem">Not found</h1>
          <p class="page-sub">{{ loadError }}</p>
        </div>
      </div>
    </template>

    <template v-else-if="server">
      <div class="page-head">
        <div>
          <RouterLink class="back" to="/">← Servers</RouterLink>
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
            title="When enabled, the host keeps this server running"
          >
            <NText depth="3">Enabled</NText>
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
            Stop
          </NButton>
          <NButton
            v-else-if="auth.can('servers:lifecycle')"
            type="primary"
            secondary
            :loading="servers.busyIds[server.id]"
            @click="act('start')"
          >
            Start
          </NButton>
          <NButton
            v-if="auth.can('servers:lifecycle') && isActiveStatus(st)"
            :loading="servers.busyIds[server.id]"
            @click="act('restart')"
          >
            Restart
          </NButton>
          <NButton
            v-if="auth.can('servers:write')"
            type="error"
            secondary
            @click="openDelete"
          >
            Delete
          </NButton>
        </NSpace>
      </div>

      <div class="metrics">
        <div class="metric">
          <NText depth="3">Restarts</NText>
          <strong>{{ server.runtime?.restartCount ?? 0 }}</strong>
        </div>
        <div class="metric">
          <NText depth="3">Last started</NText>
          <strong>
            {{
              server.runtime?.lastStartedAt
                ? new Date(server.runtime.lastStartedAt).toLocaleString()
                : "—"
            }}
          </strong>
        </div>
        <div class="metric">
          <NText depth="3">Last crash</NText>
          <strong>
            {{
              server.runtime?.lastCrashAt
                ? new Date(server.runtime.lastCrashAt).toLocaleString()
                : "—"
            }}
          </strong>
        </div>
        <div class="metric">
          <NText depth="3">Tools</NText>
          <strong>{{ server.toolCount ?? tools.length }}</strong>
        </div>
        <div class="metric">
          <NText depth="3">Last upgraded</NText>
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
            <NText depth="3">MCP endpoint</NText>
            <code class="endpoint-url">{{ mcpUrl }}</code>
          </div>
          <NButton size="small" @click="copyEndpoint">Copy</NButton>
        </div>
        <NText depth="3" class="endpoint-hint">
          Original tool names on this URL · namespaced as
          <code>{{ server.id }}__*</code> on the unified gateway
        </NText>
      </NCard>

      <NAlert
        v-if="showCrashBanner(st, server.runtime?.lastError)"
        type="error"
        style="margin-bottom: 1rem"
        :bordered="false"
        title="Server crashed"
      >
        <div class="crash-alert">
          <span>{{ server.runtime?.lastError }}</span>
          <NButton size="tiny" type="error" secondary @click="activeTab = 'logs'">
            Open logs
          </NButton>
        </div>
      </NAlert>
      <NAlert
        v-else-if="st === 'restarting'"
        type="warning"
        style="margin-bottom: 1rem"
        :bordered="false"
      >
        Process exited — automatically restarting…
      </NAlert>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="config" tab="Configuration">
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
                Save changes
              </NButton>
            </NSpace>
          </NCard>
        </NTabPane>

        <NTabPane v-if="canUpgrade" name="upgrade" tab="Upgrade">
          <NCard size="small" title="Version & upgrade">
            <NText depth="3" style="display: block; margin-bottom: 0.75rem">
              Pin a package version (or git ref), or pull the latest and restart.
              Clearing the sandbox cache forces a fresh download.
            </NText>
            <div class="upgrade-row">
              <NInput
                v-model:value="upgradeVersion"
                placeholder="Leave empty for latest"
                style="max-width: 18rem"
              />
              <NCheckbox v-model:checked="clearCacheOnUpgrade">
                Clear package cache
              </NCheckbox>
              <NSpace>
                <NButton
                  type="primary"
                  :loading="upgrading"
                  @click="onUpgrade(false)"
                >
                  {{
                    upgradeVersion.trim()
                      ? "Upgrade to pin"
                      : "Upgrade to latest"
                  }}
                </NButton>
                <NButton
                  v-if="upgradeVersion.trim()"
                  secondary
                  :loading="upgrading"
                  @click="onUpgrade(true)"
                >
                  Pull latest
                </NButton>
              </NSpace>
            </div>
            <NText
              v-if="server.lastUpgradedAt"
              depth="3"
              style="display: block; margin-top: 0.85rem; font-size: 0.85rem"
            >
              Last upgraded
              {{ new Date(server.lastUpgradedAt).toLocaleString() }}
            </NText>
          </NCard>
        </NTabPane>

        <NTabPane name="logs" tab="Logs">
          <LogViewer
            :logs="logs"
            :loading="logsLoading"
            @refresh="startLogStream"
          />
        </NTabPane>

        <NTabPane
          name="tools"
          :tab="
            tools.length
              ? `Tools (${enabledToolCount}${
                enabledToolCount === tools.length
                  ? ''
                  : `/${tools.length}`
              })`
              : 'Tools'
          "
        >
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
          tab="Activity"
        >
          <NSpin :show="activityLoading">
            <NEmpty
              v-if="!activity.length"
              description="No audit events for this server yet"
            />
            <div v-else class="activity">
              <div v-for="ev in activity" :key="ev.id" class="activity-row">
                <NTag size="small" :bordered="false">{{ ev.action }}</NTag>
                <div class="activity-body">
                  <div>{{ ev.summary }}</div>
                  <NText depth="3">
                    {{ ev.actorEmail || "system" }} ·
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
        title="Delete server"
        style="width: min(440px, 96vw)"
      >
        <NAlert type="warning" :bordered="false" style="margin-bottom: 0.85rem">
          This removes the server definition and stops it. Type
          <code>{{ id }}</code> to confirm.
        </NAlert>
        <NInput
          v-model:value="deleteConfirm"
          :placeholder="id"
          autocomplete="off"
        />
        <NSpace justify="end" style="margin-top: 1rem">
          <NButton @click="deleteOpen = false">Cancel</NButton>
          <NButton
            type="error"
            :loading="deleting"
            :disabled="deleteConfirm !== id"
            @click="onDelete"
          >
            Delete permanently
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

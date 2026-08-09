<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NSteps,
  NStep,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { useLibraryStore } from "../stores/library";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import type { LibraryItem, ServerFormValues, ServerWithRuntime, ToolInfo } from "../types";
import {
  buildCreatePayload,
  copyText,
  displayLibraryTags,
  isOfficialLibraryItem,
  isSelfHostedLibraryItem,
  optionalEnvKeysFromPairs,
  requiredEnvKeysFromPairs,
  serverGatewayUrl,
  statusOf,
} from "../utils/serverForm";
import EnvKeyValueEditor from "./EnvKeyValueEditor.vue";
import StatusTag from "./StatusTag.vue";

type Step = 1 | 2 | 3;

const ui = useUiStore();
const servers = useServersStore();
const library = useLibraryStore();
const router = useRouter();
const message = useMessage();

const step = ref<Step>(1);
const submitting = ref(false);
const formError = ref("");
const createdId = ref<string | null>(null);
const createdServer = ref<ServerWithRuntime | null>(null);
const discoveredTools = ref<ToolInfo[]>([]);
const statusPolling = ref(false);
const statusTimedOut = ref(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollGeneration = 0;

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

const item = computed(() => ui.installItem);

const categoryLabel = computed(() => {
  const id = item.value?.category;
  if (!id) return "";
  return library.categories.find((c) => c.id === id)?.label || id;
});

const commandPreview = computed(() => {
  try {
    const payload = buildCreatePayload(form);
    return [payload.command, ...(payload.args || [])].join(" ");
  } catch {
    const p = item.value?.preset;
    if (!p) return "";
    if (p.launcher === "npx") {
      return ["npx", "-y", p.package, p.extraArgs].filter(Boolean).join(" ");
    }
    if (p.launcher === "uvx") {
      return ["uvx", p.package, p.extraArgs].filter(Boolean).join(" ");
    }
    return [p.command, ...(String(p.argsLines || "").split("\n"))].filter(Boolean).join(" ");
  }
});

const requiredEnvKeys = computed(() =>
  requiredEnvKeysFromPairs(form.env.length ? form.env : item.value?.preset.env),
);

const optionalEnvKeys = computed(() =>
  optionalEnvKeysFromPairs(form.env.length ? form.env : item.value?.preset.env),
);

const docsUrl = computed(() => {
  const src = item.value?.source || "";
  if (/^https?:\/\//i.test(src)) return src;
  if (/^github\.com\//i.test(src)) return `https://${src}`;
  return "";
});

const hasEnv = computed(() =>
  (form.env || []).some((e) => e.key.trim()),
);

const mcpUrl = computed(() => {
  if (!createdId.value) return "";
  return serverGatewayUrl(servers.gatewayUrl, createdId.value);
});

const unifiedUrl = computed(() => servers.gatewayUrl);

const runtimeStatus = computed(() =>
  createdServer.value ? statusOf(createdServer.value) : "stopped",
);

const lastError = computed(
  () => createdServer.value?.runtime?.lastError || null,
);

const toolCount = computed(() => {
  if (discoveredTools.value.length) return discoveredTools.value.length;
  return createdServer.value?.toolCount ?? 0;
});

function applyItem(lib: LibraryItem) {
  const values = lib.preset;
  Object.assign(form, {
    packageVersion: "",
    ...values,
    id: values.id || lib.id,
    name: values.name || lib.name,
    env: values.env?.length
      ? values.env.map((e) => ({ ...e }))
      : [{ key: "", value: "" }],
    startNow: values.startNow !== false,
  });
}

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  statusPolling.value = false;
}

async function refreshTools(id: string) {
  try {
    discoveredTools.value = await servers.tools(id);
  } catch {
    discoveredTools.value = [];
  }
}

async function pollRuntime(id: string, startedAt: number) {
  const gen = pollGeneration;
  const maxMs = 45_000;
  statusPolling.value = true;
  statusTimedOut.value = false;

  const tick = async () => {
    if (gen !== pollGeneration) return;
    try {
      const server = await servers.getServer(id);
      if (gen !== pollGeneration) return;
      createdServer.value = server;
      const st = statusOf(server);
      if (st === "running") {
        await refreshTools(id);
        statusPolling.value = false;
        return;
      }
      if (st === "error" || st === "stopped") {
        statusPolling.value = false;
        return;
      }
    } catch {
      // Keep polling through transient API hiccups.
    }
    if (Date.now() - startedAt >= maxMs) {
      statusTimedOut.value = true;
      statusPolling.value = false;
      return;
    }
    pollTimer = setTimeout(() => void tick(), 1000);
  };

  await tick();
}

watch(
  () => ui.installOpen,
  (open) => {
    if (!open || !ui.installItem) return;
    stopPolling();
    step.value = 1;
    formError.value = "";
    createdId.value = null;
    createdServer.value = null;
    discoveredTools.value = [];
    statusTimedOut.value = false;
    submitting.value = false;
    applyItem(ui.installItem);
  },
);

onUnmounted(() => {
  stopPolling();
});

function close() {
  stopPolling();
  ui.closeInstall();
}

function next() {
  formError.value = "";
  if (step.value === 1) {
    if (!form.id.trim()) {
      formError.value = "Server ID is required.";
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(form.id.trim())) {
      formError.value = "ID may only contain letters, numbers, _ and -.";
      return;
    }
    step.value = 2;
    return;
  }
}

function back() {
  formError.value = "";
  if (step.value === 2) step.value = 1;
}

async function install() {
  formError.value = "";
  submitting.value = true;
  try {
    const body = buildCreatePayload(form);
    const server = await servers.create(body);
    createdId.value = server.id;
    createdServer.value = server;
    step.value = 3;
    message.success(`Installed ${server.id}`);
    if (form.startNow) {
      void pollRuntime(server.id, Date.now());
    }
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

async function copyUrl(url: string) {
  if (await copyText(url)) message.success("Copied");
  else message.error("Could not copy");
}

function openServer() {
  if (!createdId.value) return;
  close();
  void router.push(`/servers/${encodeURIComponent(createdId.value)}`);
}

function goConnect() {
  close();
  void router.push("/connect");
}

function installAnother() {
  close();
  void router.push("/library");
}

const doneAlertType = computed(() => {
  if (!form.startNow) return "success" as const;
  if (runtimeStatus.value === "running") return "success" as const;
  if (runtimeStatus.value === "error") return "error" as const;
  if (statusTimedOut.value) return "warning" as const;
  return "info" as const;
});

const doneAlertText = computed(() => {
  if (!createdId.value) return "";
  if (!form.startNow) {
    return `${createdId.value} is installed (not started yet).`;
  }
  if (runtimeStatus.value === "running") {
    return `${createdId.value} is running` +
      (toolCount.value ? ` with ${toolCount.value} tool${toolCount.value === 1 ? "" : "s"}.` : ".");
  }
  if (runtimeStatus.value === "error") {
    return `${createdId.value} was installed but failed to start.`;
  }
  if (statusTimedOut.value) {
    return `${createdId.value} is still starting — check logs if it doesn’t come up.`;
  }
  return `${createdId.value} is installed and starting…`;
});
</script>

<template>
  <NModal
    :show="ui.installOpen"
    preset="card"
    style="width: min(640px, 96vw)"
    :mask-closable="!submitting && step !== 3"
    :closable="step !== 3 || !submitting"
    @update:show="(v: boolean) => !v && !submitting && close()"
  >
    <template #header>
      <div class="wiz-head">
        <div>
          <div class="wiz-kicker">Install from Library</div>
          <div class="wiz-title">{{ item?.name || "Server" }}</div>
        </div>
        <NSpace :size="6">
          <NTag
            v-if="item && isSelfHostedLibraryItem(item.tags)"
            size="small"
            type="warning"
            :bordered="false"
          >
            self-hosted
          </NTag>
          <NTag
            v-if="item && isOfficialLibraryItem(item.tags)"
            size="small"
            type="success"
            :bordered="false"
          >
            official
          </NTag>
          <NTag v-if="categoryLabel" size="small" :bordered="false">
            {{ categoryLabel }}
          </NTag>
        </NSpace>
      </div>
    </template>

    <NSteps :current="step" size="small" style="margin-bottom: 1.25rem">
      <NStep title="Review" />
      <NStep title="Configure" />
      <NStep title="Done" />
    </NSteps>

    <!-- Step 1: Review -->
    <div v-if="step === 1 && item" class="panel">
      <p class="blurb">{{ item.blurb }}</p>
      <p v-if="docsUrl" class="docs">
        Docs / source:
        <a :href="docsUrl" target="_blank" rel="noopener">{{ item.source }}</a>
      </p>
      <div class="meta">
        <div>
          <NText depth="3">Source</NText>
          <div class="mono">{{ item.source }}</div>
        </div>
        <div>
          <NText depth="3">Launch command</NText>
          <div class="mono">{{ commandPreview }}</div>
        </div>
      </div>
      <NSpace :size="6" style="margin: 0.85rem 0 1rem">
        <NTag
          v-for="t in displayLibraryTags(item.tags)"
          :key="t"
          size="tiny"
          :bordered="false"
        >
          {{ t }}
        </NTag>
      </NSpace>

      <div class="grid-2">
        <NFormItem label="Server ID" required>
          <NInput
            v-model:value="form.id"
            placeholder="mealie"
            :allow-input="(v: string) => !v || /^[A-Za-z0-9_-]*$/.test(v)"
          />
        </NFormItem>
        <NFormItem label="Display name">
          <NInput v-model:value="form.name" placeholder="Mealie" />
        </NFormItem>
      </div>

      <NAlert
        v-if="requiredEnvKeys.length"
        type="info"
        :bordered="false"
        style="margin-bottom: 0.75rem"
      >
        Next you’ll set
        <strong>{{ requiredEnvKeys.join(", ") }}</strong>
        so this server can start cleanly.
        <template v-if="optionalEnvKeys.length">
          Optional:
          {{ optionalEnvKeys.join(", ") }}.
        </template>
      </NAlert>
      <NAlert
        v-else-if="hasEnv"
        type="info"
        :bordered="false"
        style="margin-bottom: 0.75rem"
      >
        Optional environment variables are available on the next step
        <template v-if="optionalEnvKeys.length">
          ({{ optionalEnvKeys.join(", ") }})
        </template>.
      </NAlert>
    </div>

    <!-- Step 2: Configure -->
    <div v-else-if="step === 2" class="panel">
      <NAlert
        v-if="requiredEnvKeys.length"
        type="warning"
        :bordered="false"
        style="margin-bottom: 0.85rem"
      >
        Fill in the highlighted env vars before starting. Placeholder values
        will be rejected.
      </NAlert>

      <NFormItem v-if="hasEnv" label="Environment">
        <EnvKeyValueEditor
          v-model="form.env"
          :highlight-keys="requiredEnvKeys"
        />
      </NFormItem>
      <NText v-else depth="3" style="display: block; margin-bottom: 0.75rem">
        This server doesn’t need environment variables.
      </NText>

      <NCheckbox v-model:checked="form.startNow" style="margin: 0.35rem 0 0.85rem">
        Start immediately after install
      </NCheckbox>

      <NCollapse>
        <NCollapseItem title="Advanced (git checkout)" name="git">
          <div class="grid-2">
            <NFormItem label="Git URL">
              <NInput
                v-model:value="form.git"
                placeholder="https://github.com/org/mcp-server.git"
              />
            </NFormItem>
            <NFormItem label="Git ref">
              <NInput v-model:value="form.ref" placeholder="main" />
            </NFormItem>
          </div>
        </NCollapseItem>
      </NCollapse>

      <div class="cmd-preview">
        <NText depth="3">Will run</NText>
        <code>{{ commandPreview }}</code>
      </div>
    </div>

    <!-- Step 3: Done -->
    <div v-else-if="step === 3" class="panel done">
      <NAlert :type="doneAlertType" :bordered="false" style="margin-bottom: 1rem">
        <div class="done-alert">
          <span>{{ doneAlertText }}</span>
          <StatusTag
            v-if="form.startNow"
            :status="runtimeStatus"
            :error="lastError"
          />
        </div>
        <div v-if="lastError && runtimeStatus === 'error'" class="crash">
          {{ lastError }}
        </div>
      </NAlert>

      <div v-if="form.startNow" class="status-panel">
        <NSpin :show="statusPolling" size="small">
          <div class="status-row">
            <NText depth="3">Runtime</NText>
            <div class="status-vals">
              <StatusTag :status="runtimeStatus" :error="lastError" />
              <NText v-if="toolCount" depth="3">
                {{ toolCount }} tool{{ toolCount === 1 ? "" : "s" }} discovered
              </NText>
              <NText v-else-if="runtimeStatus === 'running'" depth="3">
                No tools reported yet
              </NText>
            </div>
          </div>
        </NSpin>
        <NButton
          v-if="runtimeStatus === 'error' || statusTimedOut"
          size="small"
          style="margin-top: 0.65rem"
          @click="openServer"
        >
          Open server logs
        </NButton>
      </div>

      <div class="url-block">
        <NText depth="3">Dedicated MCP endpoint</NText>
        <div class="url-row">
          <code>{{ mcpUrl }}</code>
          <NButton size="tiny" @click="copyUrl(mcpUrl)">Copy</NButton>
        </div>
      </div>
      <div class="url-block">
        <NText depth="3">Unified gateway (namespaced as {{ createdId }}__*)</NText>
        <div class="url-row">
          <code>{{ unifiedUrl }}</code>
          <NButton size="tiny" @click="copyUrl(unifiedUrl)">Copy</NButton>
        </div>
      </div>
    </div>

    <NText v-if="formError" type="error" style="display: block; margin-top: 0.65rem">
      {{ formError }}
    </NText>

    <template #footer>
      <NSpace v-if="step === 1" justify="end">
        <NButton :disabled="submitting" @click="close">Cancel</NButton>
        <NButton type="primary" @click="next">Continue</NButton>
      </NSpace>
      <NSpace v-else-if="step === 2" justify="space-between">
        <NButton :disabled="submitting" @click="back">Back</NButton>
        <NSpace>
          <NButton :disabled="submitting" @click="close">Cancel</NButton>
          <NButton type="primary" :loading="submitting" @click="install">
            {{ form.startNow ? "Install & start" : "Install" }}
          </NButton>
        </NSpace>
      </NSpace>
      <NSpace v-else justify="end">
        <NButton @click="installAnother">Library</NButton>
        <NButton @click="goConnect">Connect client</NButton>
        <NButton type="primary" @click="openServer">Open server</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.wiz-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.wiz-kicker {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--app-text-muted);
  margin-bottom: 0.15rem;
}
.wiz-title {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.blurb {
  margin: 0 0 0.85rem;
  color: var(--app-text-soft);
  line-height: 1.45;
}
.docs {
  margin: -0.35rem 0 0.85rem;
  font-size: 0.85rem;
  color: var(--app-text-muted);
}
.docs a {
  color: var(--n-primary-color, #0b6e4f);
  text-decoration: underline;
}
.meta {
  display: grid;
  gap: 0.65rem;
}
.mono,
.cmd-preview code,
.url-row code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  word-break: break-all;
  color: var(--app-text);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.75rem;
}
.cmd-preview {
  margin-top: 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  display: grid;
  gap: 0.35rem;
}
.url-block {
  margin-bottom: 0.85rem;
}
.url-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.url-row code {
  flex: 1;
  min-width: 0;
}
.done-alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}
.crash {
  margin-top: 0.55rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.status-panel {
  margin-bottom: 1rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
}
.status-row {
  display: grid;
  gap: 0.35rem;
}
.status-vals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}
@media (max-width: 640px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import { CheckmarkOutline, CopyOutline } from "@vicons/ionicons5";
import { useLibraryStore } from "../stores/library";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import type { LibraryItem, ServerFormValues, ServerWithRuntime, ToolInfo } from "../types";
import {
  buildCreatePayload,
  copyText,
  isOfficialLibraryItem,
  libraryBaseId,
  libraryInstances,
  nextLibraryServerId,
  optionalEnvKeysFromPairs,
  requiredEnvKeysFromPairs,
  serverGatewayUrl,
  statusOf,
} from "../utils/serverForm";
import EnvKeyValueEditor from "./EnvKeyValueEditor.vue";
import LibraryNetworkBadge from "./LibraryNetworkBadge.vue";
import StatusTag from "./StatusTag.vue";

type Step = 1 | 2 | 3;

const { t } = useI18n();
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

const monogram = computed(() => {
  const name = item.value?.name?.trim() || "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

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

const hasEnv = computed(() =>
  (form.env || []).some((e) => e.key.trim()),
);

const existingInstanceCount = computed(() => {
  if (!item.value) return 0;
  return libraryInstances(item.value, servers.servers).length;
});

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

const steps = computed(() => [
  { n: 1 as Step, title: t("installWizard.stepReview") },
  { n: 2 as Step, title: t("installWizard.stepConfigure") },
  { n: 3 as Step, title: t("installWizard.stepDone") },
]);

function applyItem(lib: LibraryItem) {
  const values = lib.preset;
  const baseId = libraryBaseId(lib) || values.id || lib.id;
  const baseName = (values.name || lib.name || baseId).trim();
  const id = nextLibraryServerId(
    baseId,
    servers.servers.map((s) => s.id),
  );
  const isAnother = id !== baseId;
  Object.assign(form, {
    packageVersion: "",
    ...values,
    id,
    name: isAnother ? `${baseName} (${id})` : baseName,
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
  // Soft refresh only — Done is already shown; downloads may take minutes.
  const maxMs = 120_000;

  const tick = async () => {
    if (gen !== pollGeneration) return;
    try {
      const server = await servers.getServer(id);
      if (gen !== pollGeneration) return;
      createdServer.value = server;
      const st = statusOf(server);
      if (st === "running") {
        await refreshTools(id);
        return;
      }
      if (st === "error" || st === "stopped") {
        return;
      }
    } catch {
      // Keep polling through transient API hiccups.
    }
    if (Date.now() - startedAt >= maxMs) {
      return;
    }
    pollTimer = setTimeout(() => void tick(), 2000);
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
      formError.value = t("installWizard.idRequired");
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(form.id.trim())) {
      formError.value = t("installWizard.idInvalid");
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
    message.success(t("installWizard.installed", { id: server.id }));
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
  if (await copyText(url)) message.success(t("common.copied"));
  else message.error(t("installWizard.copyFailed"));
}

async function copyCommand() {
  if (!commandPreview.value) return;
  if (await copyText(commandPreview.value)) message.success(t("common.copied"));
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
  return "info" as const;
});

const doneAlertText = computed(() => {
  if (!createdId.value) return "";
  if (!form.startNow) {
    return t("installWizard.installedNotStarted", { id: createdId.value });
  }
  if (runtimeStatus.value === "running") {
    if (toolCount.value) {
      return t("installWizard.runningWithTools", {
        id: createdId.value,
        count: toolCount.value,
      }, toolCount.value);
    }
    return t("installWizard.running", { id: createdId.value });
  }
  if (runtimeStatus.value === "error") {
    return t("installWizard.failedToStart", { id: createdId.value });
  }
  return t("installWizard.installedStarting", { id: createdId.value });
});
</script>

<template>
  <NModal
    :show="ui.installOpen"
    preset="card"
    class="install-wiz-modal"
    style="width: min(600px, 96vw)"
    :bordered="false"
    :mask-closable="!submitting && step !== 3"
    :closable="step !== 3 || !submitting"
    @update:show="(v: boolean) => !v && !submitting && close()"
  >
    <template #header>
      <div class="wiz-hero">
        <div class="wiz-mark" aria-hidden="true">{{ monogram }}</div>
        <div class="wiz-hero-text">
          <div class="wiz-kicker">{{ t("installWizard.kicker") }}</div>
          <h2 class="wiz-title">
            {{ item?.name || t("installWizard.serverFallback") }}
          </h2>
          <div class="wiz-chips">
            <span v-if="categoryLabel" class="chip chip-cat">{{ categoryLabel }}</span>
            <LibraryNetworkBadge v-if="item" :tags="item.tags" labeled />
            <span
              v-if="item && isOfficialLibraryItem(item.tags)"
              class="chip chip-ok"
            >
              {{ t("installWizard.official") }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <nav class="wiz-steps" :aria-label="t('installWizard.kicker')">
      <div
        v-for="s in steps"
        :key="s.n"
        class="wiz-step"
        :class="{
          active: step === s.n,
          done: step > s.n,
        }"
      >
        <span class="wiz-step-index">
          <NIcon
            v-if="step > s.n"
            :component="CheckmarkOutline"
            :size="14"
          />
          <template v-else>{{ s.n }}</template>
        </span>
        <span class="wiz-step-title">{{ s.title }}</span>
      </div>
    </nav>

    <!-- Step 1: Review -->
    <div v-if="step === 1 && item" class="panel panel-in">
      <p class="blurb">{{ item.blurb }}</p>

      <section class="block">
        <div class="block-head">
          <h3 class="block-label">{{ t("installWizard.launchCommand") }}</h3>
          <NButton size="tiny" quaternary @click="copyCommand">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
        </div>
        <pre class="cmd-block"><code>{{ commandPreview }}</code></pre>
      </section>

      <section class="block">
        <h3 class="block-label">{{ t("installWizard.identity") }}</h3>
        <div class="grid-2">
          <NFormItem :label="t('installWizard.serverId')" required>
            <NInput
              v-model:value="form.id"
              placeholder="mealie"
              :allow-input="(v: string) => !v || /^[A-Za-z0-9_-]*$/.test(v)"
            />
          </NFormItem>
          <NFormItem :label="t('installWizard.displayName')">
            <NInput v-model:value="form.name" placeholder="Mealie" />
          </NFormItem>
        </div>
      </section>

      <div
        v-if="existingInstanceCount > 0"
        class="hint hint-info"
      >
        {{
          t("installWizard.anotherInstanceHint", {
            count: existingInstanceCount,
            id: form.id,
          }, existingInstanceCount)
        }}
      </div>

      <div v-if="requiredEnvKeys.length" class="hint hint-info">
        {{ t("installWizard.nextRequiredEnv", { keys: requiredEnvKeys.join(", ") }) }}
        <template v-if="optionalEnvKeys.length">
          {{ t("installWizard.optionalEnv", { keys: optionalEnvKeys.join(", ") }) }}
        </template>
      </div>
      <div v-else-if="hasEnv" class="hint hint-info">
        {{
          t("installWizard.optionalEnvNext", {
            keys: optionalEnvKeys.length
              ? t("installWizard.optionalEnvKeys", {
                  keys: optionalEnvKeys.join(", "),
                })
              : "",
          })
        }}
      </div>
    </div>

    <!-- Step 2: Configure -->
    <div v-else-if="step === 2" class="panel panel-in">
      <div v-if="requiredEnvKeys.length" class="hint hint-warn">
        {{ t("installWizard.fillRequiredEnv") }}
      </div>

      <section class="block">
        <h3 class="block-label">{{ t("installWizard.environment") }}</h3>
        <EnvKeyValueEditor
          v-if="hasEnv"
          v-model="form.env"
          :highlight-keys="requiredEnvKeys"
        />
        <p v-else class="muted">{{ t("installWizard.noEnvNeeded") }}</p>
      </section>

      <label class="start-row">
        <NCheckbox v-model:checked="form.startNow" />
        <span>{{ t("installWizard.startImmediately") }}</span>
      </label>

      <NCollapse class="advanced">
        <NCollapseItem :title="t('installWizard.advancedGit')" name="git">
          <div class="grid-2">
            <NFormItem :label="t('installWizard.gitUrl')">
              <NInput
                v-model:value="form.git"
                placeholder="https://github.com/org/mcp-server.git"
              />
            </NFormItem>
            <NFormItem :label="t('installWizard.gitRef')">
              <NInput v-model:value="form.ref" placeholder="main" />
            </NFormItem>
          </div>
        </NCollapseItem>
      </NCollapse>

      <section class="block">
        <h3 class="block-label">{{ t("installWizard.willRun") }}</h3>
        <pre class="cmd-block"><code>{{ commandPreview }}</code></pre>
      </section>
    </div>

    <!-- Step 3: Done -->
    <div v-else-if="step === 3" class="panel panel-in done">
      <NAlert :type="doneAlertType" :bordered="false" class="done-alert-wrap">
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
        <div class="status-row">
          <span class="block-label">{{ t("installWizard.runtime") }}</span>
          <div class="status-vals">
            <StatusTag :status="runtimeStatus" :error="lastError" />
            <NText v-if="toolCount" depth="3">
              {{ t("installWizard.toolsDiscovered", { count: toolCount }, toolCount) }}
            </NText>
            <NText v-else-if="runtimeStatus === 'running'" depth="3">
              {{ t("installWizard.noToolsYet") }}
            </NText>
          </div>
        </div>
        <p class="muted watch-hint">{{ t("installWizard.watchLogsHint") }}</p>
        <NButton
          size="small"
          style="margin-top: 0.65rem"
          @click="openServer"
        >
          {{ t("installWizard.openServerLogs") }}
        </NButton>
      </div>

      <div class="url-card">
        <div class="url-card-top">
          <span class="block-label">{{ t("installWizard.dedicatedEndpoint") }}</span>
          <NButton size="tiny" quaternary @click="copyUrl(mcpUrl)">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
        </div>
        <code>{{ mcpUrl }}</code>
      </div>
      <div class="url-card">
        <div class="url-card-top">
          <span class="block-label">
            {{ t("installWizard.unifiedGateway", { ns: `${createdId}__*` }) }}
          </span>
          <NButton size="tiny" quaternary @click="copyUrl(unifiedUrl)">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
        </div>
        <code>{{ unifiedUrl }}</code>
      </div>
    </div>

    <p v-if="formError" class="form-error">{{ formError }}</p>

    <template #footer>
      <div class="wiz-footer">
        <NSpace v-if="step === 1" justify="end" style="width: 100%">
          <NButton :disabled="submitting" @click="close">{{ t("common.cancel") }}</NButton>
          <NButton type="primary" @click="next">{{ t("installWizard.continue") }}</NButton>
        </NSpace>
        <template v-else-if="step === 2">
          <NButton :disabled="submitting" @click="back">{{ t("common.back") }}</NButton>
          <NSpace>
            <NButton :disabled="submitting" @click="close">{{ t("common.cancel") }}</NButton>
            <NButton type="primary" :loading="submitting" @click="install">
              {{ form.startNow ? t("installWizard.installAndStart") : t("common.install") }}
            </NButton>
          </NSpace>
        </template>
        <NSpace v-else justify="end" style="width: 100%">
          <NButton @click="installAnother">{{ t("installWizard.library") }}</NButton>
          <NButton @click="goConnect">{{ t("installWizard.connectClient") }}</NButton>
          <NButton type="primary" @click="openServer">{{ t("installWizard.openServer") }}</NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.wiz-hero {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding-right: 0.4rem;
}
.wiz-mark {
  flex: 0 0 auto;
  width: 3rem;
  height: 3rem;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  color: var(--app-brand-fg, #fff);
  background: linear-gradient(145deg, var(--app-accent-hover) 0%, var(--app-accent) 55%, var(--app-accent-pressed) 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--app-accent) 28%, transparent);
}
:global(html[data-theme="dark"]) .wiz-mark {
  box-shadow: 0 8px 22px color-mix(in srgb, var(--app-accent) 22%, transparent);
}
.wiz-hero-text {
  min-width: 0;
  flex: 1;
}
.wiz-kicker {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 0.2rem;
}
.wiz-title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--app-text);
}
.wiz-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
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
.chip-cat {
  background: color-mix(in srgb, #2f6fed 12%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: #2f6fed;
}
:global(html[data-theme="dark"]) .chip-cat {
  color: #6aa1ff;
  background: color-mix(in srgb, #6aa1ff 14%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 30%, transparent);
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
.chip-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.wiz-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.45rem;
  margin: 0.15rem 0 1.15rem;
  padding: 0.35rem;
  border-radius: 12px;
  background: var(--app-surface-raised);
  border: 1px solid var(--app-border);
}
.wiz-step {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.45rem 0.35rem;
  border-radius: 9px;
  color: var(--app-text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  transition: background 160ms ease, color 160ms ease;
}
.wiz-step.active {
  background: var(--app-surface);
  color: var(--app-chip-active-text);
  box-shadow: 0 1px 3px color-mix(in srgb, #000 8%, transparent);
}
.wiz-step.done {
  color: var(--app-chip-active-text);
}
.wiz-step-index {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  border: 1px solid currentColor;
  opacity: 0.85;
}
.wiz-step.active .wiz-step-index,
.wiz-step.done .wiz-step-index {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  opacity: 1;
}
.wiz-step-title {
  white-space: nowrap;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}
.panel-in {
  animation: panel-in 200ms ease-out;
}
@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.blurb {
  margin: 0;
  color: var(--app-text-soft);
  line-height: 1.55;
  font-size: 0.96rem;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.block-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}

.cmd-block {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: #14212b;
  color: #e8f5ef;
  overflow-x: auto;
}
:global(html[data-theme="dark"]) .cmd-block {
  background: #121920;
  color: #d7e6df;
}
.cmd-block code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.75rem;
}

.hint {
  padding: 0.75rem 0.9rem;
  border-radius: 11px;
  font-size: 0.86rem;
  line-height: 1.45;
  border: 1px solid var(--app-border);
}
.hint-info {
  background: color-mix(in srgb, #2f6fed 10%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: var(--app-text-soft);
}
:global(html[data-theme="dark"]) .hint-info {
  background: color-mix(in srgb, #6aa1ff 12%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 28%, transparent);
}
.hint-warn {
  background: color-mix(in srgb, #b8860b 12%, transparent);
  border-color: color-mix(in srgb, #b8860b 30%, transparent);
  color: var(--app-text-soft);
}
:global(html[data-theme="dark"]) .hint-warn {
  background: color-mix(in srgb, #e0b44a 12%, transparent);
  border-color: color-mix(in srgb, #e0b44a 28%, transparent);
}

.start-row {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  font-size: 0.92rem;
  color: var(--app-text);
}
.muted {
  margin: 0;
  color: var(--app-text-muted);
  font-size: 0.9rem;
}
.watch-hint {
  margin-top: 0.65rem;
  font-size: 0.84rem;
  line-height: 1.4;
}
.advanced {
  margin-top: -0.15rem;
}

.done-alert-wrap {
  border-radius: 12px;
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
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.status-row {
  display: grid;
  gap: 0.4rem;
}
.status-vals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.url-card {
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem 0.95rem;
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
.url-card code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  word-break: break-all;
  color: var(--app-text);
}

.form-error {
  margin: 0.75rem 0 0;
  color: #c23b3b;
  font-size: 0.88rem;
}
:global(html[data-theme="dark"]) .form-error {
  color: #f07178;
}

.wiz-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  width: 100%;
}

@media (max-width: 640px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
  .wiz-step-title {
    display: none;
  }
  .wiz-mark {
    width: 2.6rem;
    height: 2.6rem;
    font-size: 0.85rem;
  }
  .wiz-title {
    font-size: 1.15rem;
  }
}
</style>

<style>
.install-wiz-modal.n-card {
  border-radius: 16px !important;
  overflow: hidden;
}
.install-wiz-modal .n-card-header {
  padding: 1.15rem 1.25rem 0.75rem !important;
}
.install-wiz-modal .n-card__content {
  padding: 0.25rem 1.25rem 0.55rem !important;
}
.install-wiz-modal .n-card__footer {
  padding: 0.85rem 1.25rem 1.1rem !important;
  border-top: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-surface-raised) 65%, transparent);
}
</style>

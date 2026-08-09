<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NSkeleton,
  NSpace,
  NTag,
  NText,
  NThing,
  useMessage,
} from "naive-ui";
import OnboardingChecklist from "../components/OnboardingChecklist.vue";
import StatusTag from "../components/StatusTag.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import type { ServerWithRuntime } from "../types";
import { versionLabel } from "../utils/packageSpec";
import {
  copyText,
  isActiveStatus,
  isCrashedStatus,
  serverGatewayUrl,
  showCrashBanner,
  statusOf,
} from "../utils/serverForm";

const DISMISS_KEY = "mcp_hoster_onboarding_dismissed";

const servers = useServersStore();
const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const message = useMessage();

const keysCount = ref(0);
const dismissed = ref(
  typeof localStorage !== "undefined" &&
    localStorage.getItem(DISMISS_KEY) === "1",
);

const firstLoad = computed(
  () => servers.loading && servers.servers.length === 0,
);

const showOnboarding = computed(() => {
  if (dismissed.value) return false;
  if (firstLoad.value) return false;
  if (!servers.servers.length) return true;
  if (auth.required && keysCount.value === 0) return true;
  if (servers.servers.length && servers.runningCount === 0) return true;
  return false;
});

const onboardingCompact = computed(() => servers.servers.length > 0);

async function loadKeysCount() {
  if (!auth.required || !auth.isAuthenticated) {
    keysCount.value = 0;
    return;
  }
  try {
    const keys = await auth.listMyKeys();
    let n = keys.length;
    if (auth.can("keys:tenant")) {
      const tenant = await auth.listTenantKeys();
      n += tenant.length;
    }
    keysCount.value = n;
  } catch {
    /* ignore — checklist still works without key count */
  }
}

function dismissOnboarding() {
  dismissed.value = true;
  localStorage.setItem(DISMISS_KEY, "1");
}

onMounted(() => {
  loadKeysCount();
});

async function act(id: string, action: "start" | "stop" | "restart") {
  try {
    await servers.lifecycle(id, action);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

async function copy(url: string) {
  if (await copyText(url)) message.success("Copied");
}

function launcherOf(s: ServerWithRuntime): string {
  if (s.command === "npx") return "npx";
  if (s.command === "uvx") return "uvx";
  return s.command || "custom";
}

function envCount(s: ServerWithRuntime): number {
  return Object.keys(s.env || {}).length;
}

function disabledCount(s: ServerWithRuntime): number {
  return s.disabledTools?.length ?? 0;
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function openServer(id: string, tab?: string) {
  void router.push({
    path: `/servers/${encodeURIComponent(id)}`,
    query: tab ? { tab } : undefined,
  });
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Servers</h1>
        <p class="page-sub">
          {{ servers.servers.length }} configured ·
          {{ servers.runningCount }} running
          <span class="live" :class="{ on: servers.live }">
            {{ servers.live ? "· live" : "· reconnecting…" }}
          </span>
        </p>
      </div>
    </div>

    <NAlert
      v-if="servers.error"
      type="error"
      style="margin-bottom: 0.85rem"
      :bordered="false"
    >
      {{ servers.error }}
    </NAlert>

    <OnboardingChecklist
      v-if="showOnboarding"
      :servers-count="servers.servers.length"
      :running-count="servers.runningCount"
      :keys-count="keysCount"
      :auth-required="auth.required"
      :compact="onboardingCompact"
      @dismiss="dismissOnboarding"
    />

    <div v-if="firstLoad" class="cards">
      <NCard v-for="i in 3" :key="i" size="small">
        <NSkeleton text :repeat="4" />
      </NCard>
    </div>

    <div v-else-if="!servers.servers.length" class="empty-hint">
      <NText depth="3">
        No servers configured yet — use the checklist above, or jump straight
        in.
      </NText>
      <NSpace style="margin-top: 0.75rem">
        <NButton type="primary" @click="ui.openAdd()">Add server</NButton>
        <NButton @click="router.push('/library')">Browse library</NButton>
      </NSpace>
    </div>

    <div v-else class="cards">
      <NCard
        v-for="s in servers.servers"
        :key="s.id"
        size="small"
        hoverable
        class="server-card"
      >
        <NThing>
          <template #header>
            <RouterLink
              class="title"
              :to="`/servers/${encodeURIComponent(s.id)}`"
            >
              {{ s.name || s.id }}
            </RouterLink>
          </template>
          <template #header-extra>
            <StatusTag
              :status="statusOf(s)"
              :error="isCrashedStatus(statusOf(s)) ? s.runtime?.lastError : null"
            />
          </template>
          <template #description>
            <span class="sub">{{ s.id }}</span>
          </template>

          <div class="card-body">
            <div class="mcp-row">
              <code :title="serverGatewayUrl(servers.gatewayUrl, s.id)">
                {{ serverGatewayUrl(servers.gatewayUrl, s.id) }}
              </code>
              <NButton
                size="tiny"
                quaternary
                @click="copy(serverGatewayUrl(servers.gatewayUrl, s.id))"
              >
                Copy
              </NButton>
            </div>

            <NSpace :size="6" class="meta">
              <NTag size="small" :bordered="false">
                {{ launcherOf(s) }}
              </NTag>
              <NTag size="small" :bordered="false">
                {{ s.toolCount ?? 0 }} tools
              </NTag>
              <NTag
                v-if="disabledCount(s)"
                size="small"
                :bordered="false"
                type="warning"
              >
                {{ disabledCount(s) }} off
              </NTag>
              <NTag v-if="versionLabel(s)" size="small" :bordered="false">
                {{ versionLabel(s) }}
              </NTag>
              <NTag v-if="envCount(s)" size="small" :bordered="false">
                {{ envCount(s) }} env
              </NTag>
              <NTag v-if="s.enabled === false" size="small" type="warning" :bordered="false">
                disabled
              </NTag>
            </NSpace>

            <div class="details">
              <NText v-if="formatWhen(s.runtime?.lastStartedAt)" depth="3">
                Started {{ formatWhen(s.runtime?.lastStartedAt) }}
              </NText>
              <NText v-else depth="3">Never started</NText>
              <NText
                v-if="s.runtime?.pid"
                depth="3"
                class="detail-sep"
              >
                · pid {{ s.runtime.pid }}
              </NText>
              <NText
                v-if="(s.runtime?.restartCount ?? 0) > 0"
                depth="3"
                class="detail-sep"
              >
                · {{ s.runtime?.restartCount }} restarts
              </NText>
            </div>

            <div
              v-if="showCrashBanner(statusOf(s), s.runtime?.lastError)"
              class="crash-line"
            >
              <span :title="s.runtime?.lastError ?? undefined">
                {{ s.runtime?.lastError }}
              </span>
              <NButton
                size="tiny"
                type="error"
                secondary
                @click="openServer(s.id, 'logs')"
              >
                Logs
              </NButton>
            </div>
          </div>

          <template #action>
            <NSpace class="card-actions">
              <NButton size="small" @click="openServer(s.id)">
                Configure
              </NButton>
              <NButton
                v-if="isActiveStatus(statusOf(s))"
                size="small"
                :loading="servers.busyIds[s.id]"
                @click="act(s.id, 'stop')"
              >
                Stop
              </NButton>
              <NButton
                v-else
                size="small"
                type="primary"
                secondary
                :loading="servers.busyIds[s.id]"
                @click="act(s.id, 'start')"
              >
                Start
              </NButton>
              <NButton
                v-if="isActiveStatus(statusOf(s))"
                size="small"
                :loading="servers.busyIds[s.id]"
                @click="act(s.id, 'restart')"
              >
                Restart
              </NButton>
            </NSpace>
          </template>
        </NThing>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.server-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.server-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.server-card :deep(.n-thing) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.server-card :deep(.n-thing-main) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.server-card :deep(.n-thing-main__content) {
  flex: 1;
}
.server-card :deep(.n-thing-main__action) {
  margin-top: auto;
  padding-top: 0.85rem;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.15rem;
}
.title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--app-text);
}
.title:hover {
  color: var(--n-primary-color, #0b6e4f);
}
.sub {
  color: var(--app-text-muted);
  font-size: 0.82rem;
}
.mcp-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  min-width: 0;
}
.mcp-row code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.meta {
  margin: 0;
}
.details {
  font-size: 0.78rem;
  line-height: 1.35;
}
.detail-sep {
  margin-left: 0.15rem;
}
.card-actions {
  width: 100%;
}
.live {
  color: var(--app-text-muted);
}
.live.on {
  color: var(--app-chip-active-text, #3ecf9a);
}
.empty-hint {
  padding: 0.25rem 0 1rem;
}
.crash-line {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  background: color-mix(in srgb, #e34850 14%, transparent);
  color: #ff8b92;
  font-size: 0.8rem;
  line-height: 1.35;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.crash-line span {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-width: 0;
}
html[data-theme="light"] .crash-line {
  color: #a11c28;
  background: color-mix(in srgb, #e34850 10%, transparent);
}
</style>

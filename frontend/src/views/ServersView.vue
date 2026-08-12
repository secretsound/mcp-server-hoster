<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NSkeleton,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import OnboardingChecklist from "../components/OnboardingChecklist.vue";
import ServerCard from "../components/ServerCard.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";

const DISMISS_KEY = "mcp_hoster_onboarding_dismissed";

const { t } = useI18n();
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
        <h1>{{ t("servers.title") }}</h1>
        <p class="page-sub">
          {{
            t("servers.configuredRunning", {
              configured: servers.servers.length,
              running: servers.runningCount,
            })
          }}
          <span class="live" :class="{ on: servers.live }">
            {{ servers.live ? t("servers.live") : t("servers.reconnecting") }}
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
      <div v-for="i in 3" :key="i" class="skel-card">
        <NSkeleton text :repeat="4" />
      </div>
    </div>

    <div v-else-if="!servers.servers.length" class="empty-hint">
      <NText depth="3">
        {{ t("servers.empty") }}
      </NText>
      <NSpace style="margin-top: 0.75rem">
        <NButton type="primary" @click="ui.openAdd()">
          {{ t("servers.addServer") }}
        </NButton>
        <NButton @click="router.push('/library')">
          {{ t("servers.browseLibrary") }}
        </NButton>
      </NSpace>
    </div>

    <div v-else class="cards">
      <ServerCard
        v-for="s in servers.servers"
        :key="s.id"
        :server="s"
        :gateway-url="servers.gatewayUrl"
        :busy="!!servers.busyIds[s.id]"
        @configure="openServer(s.id)"
        @logs="openServer(s.id, 'logs')"
        @start="act(s.id, 'start')"
        @stop="act(s.id, 'stop')"
        @restart="act(s.id, 'restart')"
      />
    </div>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
  align-items: stretch;
}
.skel-card {
  padding: 1.05rem 1.1rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
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
</style>

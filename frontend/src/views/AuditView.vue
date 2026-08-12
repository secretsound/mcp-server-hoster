<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import {
  NButton,
  NCard,
  NEmpty,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import type { AuditEvent } from "../types";

const PAGE = 50;

const { t, te } = useI18n();
const auth = useAuthStore();
const message = useMessage();

const loading = ref(true);
const events = ref<AuditEvent[]>([]);
const total = ref(0);
const offset = ref(0);
const actionFilter = ref<string>("");
const resourceFilter = ref<string>("");
const openMetaId = ref<string | null>(null);

const ACTION_VALUES = [
  "auth.login",
  "auth.login_failed",
  "auth.session_revoke",
  "api_key.create",
  "api_key.revoke",
  "invite.create",
  "invite.accept",
  "invite.revoke",
  "server.create",
  "server.delete",
  "server.start",
  "server.stop",
  "server.restart",
  "server.upgrade",
  "server.crash",
  "database.backup",
  "database.restore",
  "settings.sandbox_mode",
] as const;

const actionOptions = computed(() => [
  { label: t("audit.allActions"), value: "" },
  ...ACTION_VALUES.map((value) => ({
    label: t(`audit.actions.${value}`),
    value,
  })),
]);

const resourceOptions = computed(() => [
  { label: t("audit.all"), value: "" },
  { label: t("audit.resourceServers"), value: "server" },
  { label: t("audit.resourceApiKeys"), value: "api_key" },
  { label: t("audit.resourceInvites"), value: "invite" },
  { label: t("audit.resourceUsers"), value: "user" },
  { label: t("audit.resourceSettings"), value: "settings" },
  { label: t("audit.resourceDatabase"), value: "database" },
]);

const pageLabel = computed(() => {
  if (!total.value) return t("audit.zeroEvents");
  const start = offset.value + 1;
  const end = Math.min(offset.value + PAGE, total.value);
  return t("audit.pageRange", { start, end, total: total.value });
});

function actionType(
  action: string,
): "success" | "warning" | "error" | "info" | "default" {
  if (
    action.endsWith(".crash") ||
    action.endsWith("_failed") ||
    action.includes("login_failed")
  ) {
    return "error";
  }
  if (
    action.endsWith(".create") ||
    action.endsWith(".start") ||
    action === "auth.login" ||
    action === "invite.accept"
  ) {
    return "success";
  }
  if (
    action.endsWith(".revoke") ||
    action.endsWith(".delete") ||
    action.endsWith(".stop")
  ) {
    return "warning";
  }
  if (
    action.endsWith(".restart") ||
    action.endsWith(".upgrade") ||
    action.endsWith(".backup") ||
    action.endsWith(".restore")
  ) {
    return "info";
  }
  return "default";
}

function actionLabel(action: string): string {
  const key = `audit.actions.${action}`;
  return te(key) ? t(key) : action;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return formatWhen(iso);
  const sec = Math.round(ms / 1000);
  if (sec < 45) return t("audit.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("audit.minutesAgo", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("audit.hoursAgo", { n: hr });
  const day = Math.round(hr / 24);
  if (day < 14) return t("audit.daysAgo", { n: day });
  return formatWhen(iso);
}

function resourceLink(ev: AuditEvent): string | null {
  if (!ev.resourceId) return null;
  if (ev.resourceType === "server") {
    return `/servers/${encodeURIComponent(ev.resourceId)}`;
  }
  if (ev.resourceType === "api_key") return "/keys";
  if (ev.resourceType === "invite") return "/invites";
  if (ev.resourceType === "user") return "/users";
  return null;
}

function hasMeta(ev: AuditEvent): boolean {
  return !!ev.metadata && Object.keys(ev.metadata).length > 0;
}

function metaEntries(ev: AuditEvent): Array<[string, string]> {
  if (!ev.metadata) return [];
  return Object.entries(ev.metadata).map(([k, v]) => [
    k,
    typeof v === "string" ? v : JSON.stringify(v),
  ]);
}

function toggleMeta(id: string) {
  openMetaId.value = openMetaId.value === id ? null : id;
}

async function refresh() {
  loading.value = true;
  try {
    const res = await auth.listAudit({
      limit: PAGE,
      offset: offset.value,
      action: actionFilter.value || null,
      resourceType: resourceFilter.value || null,
    });
    events.value = res.events;
    total.value = res.total;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

function prevPage() {
  offset.value = Math.max(0, offset.value - PAGE);
}

function nextPage() {
  if (offset.value + PAGE < total.value) offset.value += PAGE;
}

watch([actionFilter, resourceFilter], () => {
  offset.value = 0;
});

watch([offset, actionFilter, resourceFilter], () => {
  refresh();
}, { immediate: true });
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ t("audit.title") }}</h1>
        <p class="page-sub">
          {{ t("audit.subtitle") }}
          <template v-if="!loading">
            {{ t("audit.eventCount", total, { named: { count: total } }) }}
          </template>
        </p>
      </div>
      <NButton :loading="loading" @click="refresh">{{ t("audit.refresh") }}</NButton>
    </div>

    <div class="toolbar">
      <NSelect
        v-model:value="actionFilter"
        :options="actionOptions"
        style="width: min(220px, 100%)"
        clearable
        :placeholder="t('audit.action')"
      />
      <div class="filters">
        <button
          v-for="opt in resourceOptions"
          :key="opt.value || 'all'"
          type="button"
          class="chip"
          :class="{ active: resourceFilter === opt.value }"
          @click="resourceFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <NEmpty
      v-if="!loading && !events.length"
      :description="t('audit.noEvents')"
      style="margin-top: 1.5rem"
    >
      <template v-if="actionFilter || resourceFilter" #extra>
        <NButton
          @click="
            actionFilter = '';
            resourceFilter = '';
          "
        >
          {{ t("audit.clearFilters") }}
        </NButton>
      </template>
    </NEmpty>

    <div v-else class="timeline">
      <NCard
        v-for="ev in events"
        :key="ev.id"
        size="small"
        class="event"
        :class="[`tone-${actionType(ev.action)}`]"
        :bordered="false"
      >
        <div class="event-top">
          <NTag size="small" :type="actionType(ev.action)" :bordered="false">
            {{ actionLabel(ev.action) }}
          </NTag>
          <NText
            depth="3"
            class="when"
            :title="formatWhen(ev.createdAt)"
          >
            {{ relativeWhen(ev.createdAt) }}
          </NText>
        </div>
        <div class="summary">{{ ev.summary }}</div>
        <div class="meta">
          <span>{{ ev.actorEmail || t("audit.system") }}</span>
          <template v-if="ev.resourceType">
            ·
            <RouterLink
              v-if="resourceLink(ev)"
              class="resource-link"
              :to="resourceLink(ev)!"
            >
              {{ ev.resourceType }}
              <template v-if="ev.resourceId">
                <code>{{ ev.resourceId }}</code>
              </template>
            </RouterLink>
            <template v-else>
              {{ ev.resourceType }}
              <code v-if="ev.resourceId">{{ ev.resourceId }}</code>
            </template>
          </template>
          <button
            v-if="hasMeta(ev)"
            type="button"
            class="meta-toggle"
            @click="toggleMeta(ev.id)"
          >
            {{ openMetaId === ev.id ? t("audit.hideDetails") : t("audit.details") }}
          </button>
        </div>
        <div v-if="openMetaId === ev.id && hasMeta(ev)" class="meta-panel">
          <div
            v-for="[key, value] in metaEntries(ev)"
            :key="key"
            class="meta-row"
          >
            <span class="meta-key">{{ key }}</span>
            <code class="meta-val">{{ value }}</code>
          </div>
        </div>
      </NCard>
    </div>

    <NSpace
      v-if="total > PAGE"
      justify="space-between"
      align="center"
      style="margin-top: 1rem"
    >
      <NButton :disabled="offset === 0 || loading" @click="prevPage">
        {{ t("audit.previous") }}
      </NButton>
      <NText depth="3">{{ pageLabel }}</NText>
      <NButton
        :disabled="offset + PAGE >= total || loading"
        @click="nextPage"
      >
        {{ t("audit.next") }}
      </NButton>
    </NSpace>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.chip {
  border: 1px solid var(--app-border);
  background: var(--app-chip-bg);
  color: var(--app-text-soft);
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--app-chip-active-text);
  color: var(--app-text);
}
.chip.active {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.event {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}
.event.tone-error {
  border-color: color-mix(in srgb, #e34850 45%, var(--app-border));
}
.event-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}
.when {
  font-size: 0.8rem;
  white-space: nowrap;
}
.summary {
  font-weight: 560;
  font-size: 0.95rem;
  color: var(--app-text);
}
.meta {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: var(--app-text-muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.35rem;
}
.meta code {
  font-size: 0.78em;
}
.resource-link {
  color: var(--app-text-muted);
}
.resource-link:hover {
  color: var(--app-chip-active-text);
}
.meta-toggle {
  margin-left: 0.25rem;
  border: 0;
  background: transparent;
  color: var(--app-chip-active-text);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
}
.meta-toggle:hover {
  text-decoration: underline;
}
.meta-panel {
  margin-top: 0.55rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px dashed var(--app-border);
  background: var(--app-surface-raised);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.meta-row {
  display: grid;
  grid-template-columns: minmax(6rem, 8rem) 1fr;
  gap: 0.5rem;
  font-size: 0.78rem;
}
.meta-key {
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.7rem;
  padding-top: 0.15rem;
}
.meta-val {
  word-break: break-word;
  color: var(--app-text-soft);
}
</style>

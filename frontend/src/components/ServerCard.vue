<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NButton, NIcon, useMessage } from "naive-ui";
import { CopyOutline } from "@vicons/ionicons5";
import StatusTag from "./StatusTag.vue";
import type { ServerWithRuntime } from "../types";
import {
  copyText,
  isActiveStatus,
  isCrashedStatus,
  serverGatewayUrl,
  showCrashBanner,
  statusOf,
} from "../utils/serverForm";

const props = defineProps<{
  server: ServerWithRuntime;
  gatewayUrl: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  configure: [];
  logs: [];
  start: [];
  stop: [];
  restart: [];
}>();

const { t } = useI18n();
const message = useMessage();

const status = computed(() => statusOf(props.server));
const active = computed(() => isActiveStatus(status.value));
const mcpUrl = computed(() =>
  serverGatewayUrl(props.gatewayUrl, props.server.id),
);

const monogram = computed(() => {
  const name = (props.server.name || props.server.id).trim() || "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const launcher = computed(() => {
  if (props.server.command === "npx") return "npx";
  if (props.server.command === "uvx") return "uvx";
  return props.server.command || "custom";
});

const disabledTools = computed(() => props.server.disabledTools?.length ?? 0);

const startedLabel = computed(() => {
  const iso = props.server.runtime?.lastStartedAt;
  if (!iso) return t("servers.neverStarted");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("servers.neverStarted");
  return t("servers.startedAt", {
    when: d.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
});

async function copyUrl() {
  if (await copyText(mcpUrl.value)) message.success(t("common.copied"));
}
</script>

<template>
  <article
    class="srv-card"
    :class="{
      running: status === 'running',
      crashed: isCrashedStatus(status),
      disabled: server.enabled === false,
    }"
  >
    <header class="srv-head">
      <div class="srv-mark" aria-hidden="true">{{ monogram }}</div>
      <div class="srv-titles">
        <div class="srv-title-row">
          <button type="button" class="srv-name" @click="emit('configure')">
            {{ server.name || server.id }}
          </button>
          <StatusTag
            :status="status"
            :error="isCrashedStatus(status) ? server.runtime?.lastError : null"
          />
        </div>
        <div class="srv-sub">
          <span class="srv-id">{{ server.id }}</span>
        </div>
      </div>
    </header>

    <div class="url-row">
      <code :title="mcpUrl">{{ mcpUrl }}</code>
      <NButton
        size="tiny"
        quaternary
        :aria-label="t('common.copy')"
        @click="copyUrl"
      >
        <template #icon>
          <NIcon :component="CopyOutline" />
        </template>
      </NButton>
    </div>

    <div class="srv-meta">
      <span class="meta-chip">{{ launcher }}</span>
      <span class="meta-chip">
        {{ t("servers.toolsCount", { count: server.toolCount ?? 0 }) }}
      </span>
      <span v-if="disabledTools" class="meta-chip meta-warn">
        {{ t("servers.offCount", { count: disabledTools }) }}
      </span>
      <span v-if="server.enabled === false" class="meta-chip meta-warn">
        {{ t("servers.disabled") }}
      </span>
    </div>

    <div class="srv-details">
      <span>{{ startedLabel }}</span>
      <span v-if="server.runtime?.pid">
        {{ t("servers.pid", { pid: server.runtime.pid }) }}
      </span>
      <span v-if="(server.runtime?.restartCount ?? 0) > 0">
        {{ t("servers.restarts", { count: server.runtime?.restartCount }) }}
      </span>
    </div>

    <div
      v-if="showCrashBanner(status, server.runtime?.lastError)"
      class="crash-line"
    >
      <span :title="server.runtime?.lastError ?? undefined">
        {{ server.runtime?.lastError }}
      </span>
      <NButton size="tiny" type="error" secondary @click="emit('logs')">
        {{ t("servers.logs") }}
      </NButton>
    </div>

    <footer class="srv-foot">
      <NButton size="small" secondary @click="emit('configure')">
        {{ t("servers.configure") }}
      </NButton>
      <div class="srv-actions">
        <NButton
          v-if="active"
          size="small"
          :loading="busy"
          @click="emit('stop')"
        >
          {{ t("common.stop") }}
        </NButton>
        <NButton
          v-else
          size="small"
          type="primary"
          :loading="busy"
          @click="emit('start')"
        >
          {{ t("common.start") }}
        </NButton>
        <NButton
          v-if="active"
          size="small"
          :loading="busy"
          @click="emit('restart')"
        >
          {{ t("common.restart") }}
        </NButton>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.srv-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.05rem 1.1rem 0.95rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}
.srv-card:hover {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 45%, var(--app-border));
  transform: translateY(-1px);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 12%, transparent);
}
:global(html[data-theme="dark"]) .srv-card:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, #000 45%, transparent);
}
.srv-card.running {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 38%, var(--app-border));
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 10%, transparent),
      transparent 58%
    ),
    var(--app-surface);
}
.srv-card.crashed {
  border-color: color-mix(in srgb, #c23b3b 40%, var(--app-border));
}
.srv-card.disabled {
  opacity: 0.88;
}

.srv-head {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
}
.srv-mark {
  flex: 0 0 auto;
  width: 2.55rem;
  height: 2.55rem;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  color: var(--app-brand-fg, #fff);
  background: linear-gradient(145deg, var(--app-accent-hover) 0%, var(--app-accent) 55%, var(--app-accent-pressed) 100%);
}

.srv-titles {
  min-width: 0;
  flex: 1;
}
.srv-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}
.srv-name {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--app-text);
}
.srv-name:hover {
  color: var(--app-chip-active-text);
}
.srv-sub {
  margin-top: 0.15rem;
}
.srv-id {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  color: var(--app-text-muted);
}

.url-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.45rem 0.55rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.url-row code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--app-text-soft);
}

.srv-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.meta-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  background: var(--app-surface-raised);
  color: var(--app-text-soft);
  border: 1px solid var(--app-border);
}
.meta-warn {
  background: color-mix(in srgb, #b8860b 14%, transparent);
  border-color: color-mix(in srgb, #b8860b 32%, transparent);
  color: #9a7209;
}
:global(html[data-theme="dark"]) .meta-warn {
  color: #e0b44a;
  background: color-mix(in srgb, #e0b44a 14%, transparent);
  border-color: color-mix(in srgb, #e0b44a 30%, transparent);
}

.srv-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.35rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  line-height: 1.35;
  flex: 1;
}

.crash-line {
  margin: 0;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
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
:global(html[data-theme="light"]) .crash-line {
  color: #a11c28;
  background: color-mix(in srgb, #e34850 10%, transparent);
}

.srv-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.1rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--app-border);
}
.srv-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}
</style>

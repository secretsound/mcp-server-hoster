<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NButton, NIcon } from "naive-ui";
import { CopyOutline, KeyOutline } from "@vicons/ionicons5";
import type { ApiKey, ScopeGrant } from "../types";

const props = defineProps<{
  apiKey: ApiKey;
  tenant?: boolean;
}>();

const emit = defineEmits<{
  connect: [];
  copyPrefix: [];
  revoke: [];
}>();

const { t } = useI18n();

const revoked = computed(() => !!props.apiKey.revokedAt);

const monogram = computed(() => {
  const name = props.apiKey.name?.trim() || "K";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const scopeChips = computed(() => {
  const scopes = props.apiKey.scopes || [];
  if (!scopes.length) return [t("keys.noScopes")];
  if (scopes.some((g) => g.serverId === "*" && g.tools.includes("*"))) {
    return [t("keys.fullAccessTag")];
  }
  return scopes.map((g: ScopeGrant) =>
    `${g.serverId}:${g.tools.includes("*") ? "*" : t("keys.toolsCount", { count: g.tools.length })}`,
  );
});

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
</script>

<template>
  <article class="key-card" :class="{ revoked, tenant: !!tenant }">
    <header class="key-head">
      <div class="key-mark" aria-hidden="true">
        <span v-if="!tenant">{{ monogram }}</span>
        <NIcon v-else :component="KeyOutline" :size="18" />
      </div>
      <div class="key-titles">
        <div class="key-title-row">
          <h3 class="key-name">{{ apiKey.name }}</h3>
          <div class="status-row">
            <span v-if="tenant" class="status status-tenant">{{ t("keys.tenant") }}</span>
            <span
              class="status"
              :class="revoked ? 'status-revoked' : 'status-ok'"
            >
              {{ revoked ? t("keys.revoked") : t("keys.active") }}
            </span>
          </div>
        </div>
        <code class="key-prefix">{{ apiKey.keyPrefix }}…</code>
      </div>
    </header>

    <div class="key-meta">
      <span
        v-for="chip in scopeChips"
        :key="chip"
        class="meta-chip"
        :class="{ 'meta-ok': chip === t('keys.fullAccessTag') }"
      >
        {{ chip }}
      </span>
    </div>

    <div class="key-details">
      <span>{{ t("keys.created", { when: formatWhen(apiKey.createdAt) }) }}</span>
      <span v-if="apiKey.lastUsedAt">
        {{ t("keys.lastUsed", { when: formatWhen(apiKey.lastUsedAt) }) }}
      </span>
      <span v-else>{{ t("keys.neverUsed") }}</span>
      <span v-if="apiKey.expiresAt">
        {{ t("keys.expires", { when: formatWhen(apiKey.expiresAt) }) }}
      </span>
    </div>

    <footer class="key-foot">
      <NButton
        size="small"
        secondary
        :disabled="revoked"
        @click="emit('connect')"
      >
        {{ t("keys.connect") }}
      </NButton>
      <div class="key-actions">
        <NButton size="small" quaternary @click="emit('copyPrefix')">
          <template #icon>
            <NIcon :component="CopyOutline" />
          </template>
          {{ t("keys.copyPrefix") }}
        </NButton>
        <NButton
          size="small"
          type="error"
          secondary
          :disabled="revoked"
          @click="emit('revoke')"
        >
          {{ t("keys.revoke") }}
        </NButton>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.key-card {
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
.key-card:hover {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 45%, var(--app-border));
  transform: translateY(-1px);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 12%, transparent);
}
:global(html[data-theme="dark"]) .key-card:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, #000 45%, transparent);
}
.key-card:not(.revoked) {
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 8%, transparent),
      transparent 55%
    ),
    var(--app-surface);
}
.key-card.revoked {
  opacity: 0.78;
}

.key-head {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
}
.key-mark {
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

.key-card.tenant .key-mark {
  background: linear-gradient(145deg, #3d7aed 0%, #2f6fed 55%, #2458c4 100%);
  color: #fff;
}
:global(html[data-theme="dark"]) .key-card.tenant .key-mark {
  background: linear-gradient(145deg, #6aa1ff 0%, #4d8af5 55%, #3d7aed 100%);
  color: #0f161c;
}
.key-titles {
  min-width: 0;
  flex: 1;
}
.key-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}
.key-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--app-text);
}
.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  justify-content: flex-end;
}
.status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 650;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  white-space: nowrap;
}
.status-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.status-revoked {
  background: color-mix(in srgb, #c23b3b 14%, transparent);
  border-color: color-mix(in srgb, #c23b3b 32%, transparent);
  color: #c23b3b;
}
:global(html[data-theme="dark"]) .status-revoked {
  color: #f07178;
  background: color-mix(in srgb, #f07178 14%, transparent);
  border-color: color-mix(in srgb, #f07178 30%, transparent);
}
.status-tenant {
  background: color-mix(in srgb, #2f6fed 12%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: #2f6fed;
}
:global(html[data-theme="dark"]) .status-tenant {
  color: #6aa1ff;
  background: color-mix(in srgb, #6aa1ff 14%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 30%, transparent);
}
.key-prefix {
  display: block;
  margin-top: 0.2rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  color: var(--app-text-muted);
}

.key-meta {
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
  font-family: "IBM Plex Mono", ui-monospace, monospace;
}
.meta-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
  font-family: inherit;
}

.key-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.35rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  line-height: 1.35;
  flex: 1;
}

.key-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.1rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--app-border);
}
.key-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NButton } from "naive-ui";
import type { AuthUser } from "../types";

const props = defineProps<{
  user: AuthUser;
  roleLabel: string;
  isSelf?: boolean;
  isAdmin?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
}>();

const { t } = useI18n();

const disabled = computed(() => !!props.user.disabled);

const monogram = computed(() => {
  const name = (props.user.displayName || props.user.email || "?").trim();
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const grantChips = computed(() => {
  if (props.user.permissions?.includes("mcp:full")) {
    return [t("users.fullAccess")];
  }
  if (!props.user.grants.length) return [t("users.noGrants")];
  return props.user.grants.map((g) =>
    `${g.serverId}:${g.tools.includes("*") ? "*" : t("users.toolsCount", { count: g.tools.length })}`,
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
  <article class="user-card" :class="{ disabled, self: !!isSelf }">
    <header class="user-head">
      <div class="user-mark" aria-hidden="true">{{ monogram }}</div>
      <div class="user-titles">
        <div class="user-title-row">
          <h3 class="user-name">
            {{ user.displayName || user.email }}
          </h3>
          <div class="status-row">
            <span v-if="isSelf" class="status status-you">{{ t("users.you") }}</span>
            <span
              class="status"
              :class="disabled ? 'status-off' : 'status-ok'"
            >
              {{ disabled ? t("users.disabled") : t("users.active") }}
            </span>
          </div>
        </div>
        <div class="user-email">{{ user.email }}</div>
      </div>
    </header>

    <div class="user-meta">
      <span class="meta-chip" :class="{ 'meta-admin': isAdmin }">
        {{ roleLabel }}
      </span>
      <span
        v-for="chip in grantChips"
        :key="chip"
        class="meta-chip"
        :class="{
          'meta-ok': chip === t('users.fullAccess'),
          'meta-muted': chip === t('users.noGrants'),
        }"
      >
        {{ chip }}
      </span>
    </div>

    <div class="user-details">
      <span v-if="formatWhen(user.createdAt)">
        {{ t("users.created", { when: formatWhen(user.createdAt) }) }}
      </span>
      <span v-if="formatWhen(user.updatedAt)">
        {{ t("users.updated", { when: formatWhen(user.updatedAt) }) }}
      </span>
    </div>

    <footer class="user-foot">
      <NButton size="small" secondary @click="emit('edit')">
        {{ t("users.edit") }}
      </NButton>
      <NButton
        size="small"
        type="error"
        secondary
        :disabled="!!isSelf"
        @click="emit('delete')"
      >
        {{ t("users.delete") }}
      </NButton>
    </footer>
  </article>
</template>

<style scoped>
.user-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.05rem 1.1rem 0.95rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 8%, transparent),
      transparent 55%
    ),
    var(--app-surface);
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}
.user-card:hover {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 45%, var(--app-border));
  transform: translateY(-1px);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 12%, transparent);
}
:global(html[data-theme="dark"]) .user-card:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, #000 45%, transparent);
}
.user-card.disabled {
  opacity: 0.78;
  background: var(--app-surface);
}
.user-card.self {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 40%, var(--app-border));
}

.user-head {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
}
.user-mark {
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

.user-titles {
  min-width: 0;
  flex: 1;
}
.user-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}
.user-name {
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
.status-off {
  background: color-mix(in srgb, #c23b3b 14%, transparent);
  border-color: color-mix(in srgb, #c23b3b 32%, transparent);
  color: #c23b3b;
}
:global(html[data-theme="dark"]) .status-off {
  color: #f07178;
  background: color-mix(in srgb, #f07178 14%, transparent);
  border-color: color-mix(in srgb, #f07178 30%, transparent);
}
.status-you {
  background: color-mix(in srgb, #2f6fed 12%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: #2f6fed;
}
:global(html[data-theme="dark"]) .status-you {
  color: #6aa1ff;
  background: color-mix(in srgb, #6aa1ff 14%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 30%, transparent);
}
.user-email {
  margin-top: 0.2rem;
  font-size: 0.82rem;
  color: var(--app-text-muted);
  word-break: break-word;
}

.user-meta {
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
.meta-admin,
.meta-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.meta-muted {
  opacity: 0.85;
}

.user-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.35rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  line-height: 1.35;
  flex: 1;
}

.user-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.1rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--app-border);
}
</style>

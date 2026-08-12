<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NButton } from "naive-ui";
import type { RoleRecord } from "../types";

const props = defineProps<{
  role: RoleRecord;
  canWrite?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
}>();

const { t } = useI18n();

const PREVIEW_LIMIT = 5;

const monogram = computed(() => {
  const name = (props.role.name || props.role.slug || "?").trim();
  const parts = name.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const hasFullMcp = computed(() => props.role.permissions.includes("mcp:full"));

const previewPerms = computed(() => {
  const sorted = [...props.role.permissions].sort((a, b) => {
    const rank = (p: string) =>
      p === "mcp:full" ? 0 : p.endsWith(":write") ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return sorted.slice(0, PREVIEW_LIMIT);
});

const overflowCount = computed(() =>
  Math.max(0, props.role.permissions.length - PREVIEW_LIMIT),
);

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<template>
  <article class="role-card" :class="{ system: role.isSystem }">
    <header class="role-head">
      <div class="role-mark" aria-hidden="true">{{ monogram }}</div>
      <div class="role-titles">
        <div class="role-title-row">
          <h3 class="role-name">{{ role.name }}</h3>
          <span
            class="status"
            :class="role.isSystem ? 'status-system' : 'status-custom'"
          >
            {{ role.isSystem ? t("roles.system") : t("roles.custom") }}
          </span>
        </div>
        <code class="role-slug">{{ role.slug }}</code>
      </div>
    </header>

    <p class="role-desc">
      {{ role.description || t("roles.noDescription") }}
    </p>

    <div class="role-meta">
      <span class="meta-chip">
        {{ t("roles.permissionsCount", { count: role.permissions.length }) }}
      </span>
      <span v-if="hasFullMcp" class="meta-chip meta-ok">mcp:full</span>
    </div>

    <div class="role-perms">
      <span
        v-for="p in previewPerms"
        :key="p"
        class="perm-chip"
        :class="{ 'perm-ok': p === 'mcp:full' }"
      >
        {{ p }}
      </span>
      <span v-if="overflowCount" class="perm-chip perm-more">
        {{ t("roles.more", { count: overflowCount }) }}
      </span>
    </div>

    <div v-if="formatWhen(role.createdAt)" class="role-details">
      {{ t("roles.created", { when: formatWhen(role.createdAt) }) }}
    </div>

    <footer v-if="canWrite" class="role-foot">
      <NButton size="small" secondary @click="emit('edit')">
        {{ t("roles.edit") }}
      </NButton>
      <NButton
        v-if="!role.isSystem"
        size="small"
        type="error"
        secondary
        @click="emit('delete')"
      >
        {{ t("roles.delete") }}
      </NButton>
      <span v-else class="foot-spacer" />
    </footer>
  </article>
</template>

<style scoped>
.role-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
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
.role-card:hover {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 45%, var(--app-border));
  transform: translateY(-1px);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 12%, transparent);
}
:global(html[data-theme="dark"]) .role-card:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, #000 45%, transparent);
}
.role-card.system {
  border-color: color-mix(in srgb, #2f6fed 28%, var(--app-border));
}

.role-head {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
}
.role-mark {
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

.role-titles {
  min-width: 0;
  flex: 1;
}
.role-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}
.role-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--app-text);
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
.status-system {
  background: color-mix(in srgb, #2f6fed 12%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: #2f6fed;
}
:global(html[data-theme="dark"]) .status-system {
  color: #6aa1ff;
  background: color-mix(in srgb, #6aa1ff 14%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 30%, transparent);
}
.status-custom {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.role-slug {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: var(--app-text-muted);
  word-break: break-all;
}

.role-desc {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--app-text-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.role-meta {
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
.meta-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.role-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  flex: 1;
  align-content: flex-start;
}
.perm-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  padding: 0.12rem 0.45rem;
  font-size: 0.7rem;
  font-weight: 550;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: -0.01em;
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
}
.perm-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.perm-more {
  font-family: inherit;
  font-weight: 600;
}

.role-details {
  font-size: 0.78rem;
  color: var(--app-text-muted);
  line-height: 1.35;
}

.role-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.1rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--app-border);
}
.foot-spacer {
  flex: 1;
}
</style>

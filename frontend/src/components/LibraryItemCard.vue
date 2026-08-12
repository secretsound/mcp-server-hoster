<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NButton, NIcon } from "naive-ui";
import { InformationCircleOutline } from "@vicons/ionicons5";
import type { LibraryItem } from "../types";
import {
  isOfficialLibraryItem,
  requiredEnvKeysFromPairs,
} from "../utils/serverForm";
import LibraryNetworkBadge from "./LibraryNetworkBadge.vue";

const props = defineProps<{
  item: LibraryItem;
  categoryLabel?: string;
  featured?: boolean;
  installedBadge?: string | null;
  canInstall?: boolean;
  isInstalled?: boolean;
}>();

const emit = defineEmits<{
  info: [];
  install: [];
}>();

const { t } = useI18n();

const monogram = computed(() => {
  const name = props.item.name?.trim() || "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const launcher = computed(() => {
  const l = props.item.preset?.launcher;
  if (l === "npx" || l === "uvx") return l;
  if (l === "custom") return props.item.preset?.command?.trim() || "custom";
  return "custom";
});

const packageLabel = computed(() => {
  const pkg = props.item.preset?.package?.trim() || props.item.source?.trim();
  if (!pkg) return null;
  const ver = props.item.preset?.packageVersion?.trim();
  return ver ? `${pkg}@${ver}` : pkg;
});

const envCount = computed(() =>
  requiredEnvKeysFromPairs(props.item.preset?.env).length,
);
</script>

<template>
  <article class="lib-item" :class="{ featured: !!featured, installed: !!installedBadge }">
    <header class="lib-item-head">
      <div class="lib-mark" aria-hidden="true">{{ monogram }}</div>
      <div class="lib-item-titles">
        <div class="lib-item-title-row">
          <h3 class="lib-item-name">{{ item.name }}</h3>
          <div class="lib-item-badges">
            <LibraryNetworkBadge :tags="item.tags" />
            <span v-if="installedBadge" class="status status-ok">
              {{ installedBadge }}
            </span>
            <span v-else-if="featured" class="status status-feat">
              {{ t("library.featuredTag") }}
            </span>
          </div>
        </div>
        <div class="lib-item-sub">
          <span v-if="categoryLabel" class="sub-cat">{{ categoryLabel }}</span>
          <span v-if="categoryLabel && packageLabel" class="sub-dot">·</span>
          <span v-if="packageLabel" class="sub-pkg">{{ packageLabel }}</span>
        </div>
      </div>
    </header>

    <p class="lib-item-blurb">{{ item.blurb }}</p>

    <div class="lib-item-meta">
      <span class="meta-chip">{{ launcher }}</span>
      <span v-if="envCount" class="meta-chip">
        {{ t("library.envCount", { count: envCount }) }}
      </span>
      <span
        v-if="isOfficialLibraryItem(item.tags)"
        class="meta-chip meta-ok"
      >
        {{ t("library.official") }}
      </span>
    </div>

    <footer class="lib-item-foot">
      <NButton
        quaternary
        circle
        size="small"
        :aria-label="t('library.infoAria')"
        @click="emit('info')"
      >
        <template #icon>
          <NIcon :component="InformationCircleOutline" :size="18" />
        </template>
      </NButton>
      <NButton
        v-if="canInstall"
        type="primary"
        size="small"
        @click="emit('install')"
      >
        {{
          isInstalled
            ? t("library.installAnother")
            : t("common.install")
        }}
      </NButton>
    </footer>
  </article>
</template>

<style scoped>
.lib-item {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.05rem 1.1rem 0.95rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}
.lib-item:hover {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 45%, var(--app-border));
  transform: translateY(-1px);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 12%, transparent);
}
:global(html[data-theme="dark"]) .lib-item:hover {
  box-shadow: 0 14px 32px color-mix(in srgb, #000 45%, transparent);
}
.lib-item.featured {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 40%, var(--app-border));
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 12%, transparent),
      transparent 58%
    ),
    var(--app-surface);
}

.lib-item-head {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
}
.lib-mark {
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

.lib-item-titles {
  min-width: 0;
  flex: 1;
}
.lib-item-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}
.lib-item-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.3rem;
  flex: 0 1 auto;
  max-width: 55%;
}
.lib-item-name {
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
  letter-spacing: 0.01em;
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
.status-feat {
  background: color-mix(in srgb, var(--app-text-muted) 12%, transparent);
}

.lib-item-sub {
  margin-top: 0.2rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem;
  min-width: 0;
  color: var(--app-text-muted);
  font-size: 0.78rem;
}
.sub-pkg {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.sub-dot {
  opacity: 0.7;
}

.lib-item-blurb {
  margin: 0;
  color: var(--app-text-soft);
  font-size: 0.9rem;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.lib-item-meta {
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
.meta-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.lib-item-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.15rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--app-border);
}
</style>

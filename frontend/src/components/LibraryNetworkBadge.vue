<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NIcon, NTooltip } from "naive-ui";
import { CloudOutline, HomeOutline } from "@vicons/ionicons5";
import { libraryNetworkKind } from "../utils/serverForm";

const props = withDefaults(
  defineProps<{
    tags?: string[];
    /** Show text label beside the icon (info/wizard). Cards use icon-only. */
    labeled?: boolean;
  }>(),
  { labeled: false },
);

const { t } = useI18n();

const kind = computed(() => libraryNetworkKind(props.tags));

const iconSize = computed(() => (props.labeled ? 14 : 13));

const label = computed(() => {
  switch (kind.value) {
    case "online":
      return t("library.onlineRequired");
    case "hybrid":
      return t("library.hybridApp");
    default:
      return t("library.localApp");
  }
});

const tip = computed(() => {
  switch (kind.value) {
    case "online":
      return t("library.onlineRequiredTip");
    case "hybrid":
      return t("library.hybridAppTip");
    default:
      return t("library.localAppTip");
  }
});
</script>

<template>
  <NTooltip trigger="hover">
    <template #trigger>
      <span
        class="net-badge"
        :class="[`net-${kind}`, { labeled }]"
        :aria-label="tip"
      >
        <span v-if="kind === 'hybrid'" class="net-pair" aria-hidden="true">
          <NIcon :component="HomeOutline" :size="iconSize" />
          <NIcon :component="CloudOutline" :size="iconSize" />
        </span>
        <NIcon
          v-else-if="kind === 'online'"
          :component="CloudOutline"
          :size="labeled ? 14 : 15"
        />
        <NIcon
          v-else
          :component="HomeOutline"
          :size="labeled ? 14 : 15"
        />
        <span v-if="labeled" class="net-label">{{ label }}</span>
      </span>
    </template>
    {{ tip }}
  </NTooltip>
</template>

<style scoped>
.net-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0.22rem;
  min-width: 1.55rem;
  min-height: 1.55rem;
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
  line-height: 1;
  cursor: default;
}
.net-badge.labeled {
  padding: 0.12rem 0.5rem 0.12rem 0.35rem;
  min-width: 0;
}
.net-pair {
  display: inline-flex;
  align-items: center;
  gap: 0.08rem;
}
.net-label {
  white-space: nowrap;
}

.net-local {
  background: color-mix(in srgb, var(--app-chip-active-text) 12%, transparent);
  border-color: color-mix(in srgb, var(--app-chip-active-text) 28%, transparent);
  color: var(--app-chip-active-text);
}
.net-online {
  background: color-mix(in srgb, #b8860b 14%, transparent);
  border-color: color-mix(in srgb, #b8860b 32%, transparent);
  color: #9a7209;
}
:global(html[data-theme="dark"]) .net-online {
  color: #e0b44a;
  background: color-mix(in srgb, #e0b44a 14%, transparent);
  border-color: color-mix(in srgb, #e0b44a 30%, transparent);
}
.net-hybrid {
  background: color-mix(in srgb, #5b8def 14%, transparent);
  border-color: color-mix(in srgb, #5b8def 32%, transparent);
  color: #3d6fd4;
  padding-inline: 0.28rem;
}
:global(html[data-theme="dark"]) .net-hybrid {
  color: #8eb6ff;
  background: color-mix(in srgb, #8eb6ff 14%, transparent);
  border-color: color-mix(in srgb, #8eb6ff 30%, transparent);
}
</style>

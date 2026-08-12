<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NInput,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { RefreshOutline } from "@vicons/ionicons5";
import type { ToolInfo } from "../types";
import { copyText } from "../utils/serverForm";

const props = defineProps<{
  tools: ToolInfo[];
  loading?: boolean;
  /** When true, show per-tool enable switches. */
  canEdit?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  "set-enabled": [payload: { name: string; enabled: boolean }];
  "set-all-enabled": [enabled: boolean];
}>();

const { t } = useI18n();
const message = useMessage();
const query = ref("");
const openId = ref<string | null>(null);
const filter = ref<"all" | "enabled" | "disabled">("all");

type ArgInfo = { name: string; required: boolean; type: string };

function isEnabled(tool: ToolInfo): boolean {
  return tool.enabled !== false;
}

function argsFromSchema(schema: unknown): ArgInfo[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as {
    properties?: Record<string, { type?: string | string[] }>;
    required?: string[];
  };
  const propsMap = s.properties ?? {};
  const required = new Set(s.required ?? []);
  return Object.keys(propsMap).map((name) => {
    const typ = propsMap[name]?.type;
    const type = Array.isArray(typ) ? typ.join("|") : (typ || "any");
    return { name, required: required.has(name), type };
  });
}

const enabledCount = computed(
  () => props.tools.filter((tool) => isEnabled(tool)).length,
);
const disabledCount = computed(
  () => props.tools.length - enabledCount.value,
);

const titleLabel = computed(() => {
  if (disabledCount.value) {
    return t("tools.titlePartial", {
      enabled: enabledCount.value,
      disabled: disabledCount.value,
    });
  }
  return t("tools.titleCount", { count: props.tools.length });
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.tools.filter((tool) => {
    if (filter.value === "enabled" && !isEnabled(tool)) return false;
    if (filter.value === "disabled" && isEnabled(tool)) return false;
    if (!q) return true;
    const hay = `${tool.name} ${tool.namespacedName} ${tool.description || ""}`
      .toLowerCase();
    return hay.includes(q);
  });
});

function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}

async function copyName(name: string) {
  if (await copyText(name)) message.success(t("tools.copiedName"));
}

function onSwitch(tool: ToolInfo, enabled: boolean) {
  emit("set-enabled", { name: tool.name, enabled });
}
</script>

<template>
  <NCard size="small" :bordered="true">
    <template #header>
      <NSpace justify="space-between" align="center">
        <span>{{ titleLabel }}</span>
        <NButton size="tiny" quaternary :loading="loading" @click="emit('refresh')">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          {{ t("common.refresh") }}
        </NButton>
      </NSpace>
    </template>

    <NText
      v-if="canEdit && tools.length"
      depth="3"
      style="display: block; margin-bottom: 0.65rem; font-size: 0.85rem"
    >
      {{ t("tools.help") }}
    </NText>

    <div v-if="tools.length" class="toolbar">
      <NInput
        v-model:value="query"
        size="small"
        clearable
        :placeholder="t('tools.searchPlaceholder')"
        style="flex: 1; min-width: 10rem"
      />
      <NSpace :size="6">
        <NButton
          size="tiny"
          :type="filter === 'all' ? 'primary' : 'default'"
          secondary
          @click="filter = 'all'"
        >
          {{ t("common.all") }}
        </NButton>
        <NButton
          size="tiny"
          :type="filter === 'enabled' ? 'primary' : 'default'"
          secondary
          @click="filter = 'enabled'"
        >
          {{ t("tools.on") }}
        </NButton>
        <NButton
          size="tiny"
          :type="filter === 'disabled' ? 'primary' : 'default'"
          secondary
          @click="filter = 'disabled'"
        >
          {{ t("tools.off") }}
        </NButton>
      </NSpace>
      <NSpace v-if="canEdit" :size="6">
        <NButton
          size="tiny"
          quaternary
          :disabled="busy || enabledCount === tools.length"
          @click="emit('set-all-enabled', true)"
        >
          {{ t("tools.enableAll") }}
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :disabled="busy || disabledCount === tools.length"
          @click="emit('set-all-enabled', false)"
        >
          {{ t("tools.disableAll") }}
        </NButton>
      </NSpace>
    </div>

    <NEmpty
      v-if="!tools.length"
      :description="t('tools.emptyRunning')"
      size="small"
    />
    <NEmpty
      v-else-if="!filtered.length"
      :description="t('tools.noMatch')"
      size="small"
    />
    <div v-else class="list">
      <div
        v-for="tool in filtered"
        :key="tool.namespacedName"
        class="tool"
        :class="{ open: openId === tool.namespacedName, off: !isEnabled(tool) }"
      >
        <button type="button" class="tool-head" @click="toggle(tool.namespacedName)">
          <code class="name">{{ tool.name }}</code>
          <NText depth="3" class="ns">{{ tool.namespacedName }}</NText>
        </button>
        <NSpace :size="6" align="center" class="tool-actions">
          <NSwitch
            v-if="canEdit"
            size="small"
            :value="isEnabled(tool)"
            :disabled="busy"
            @update:value="(v: boolean) => onSwitch(tool, v)"
          />
          <NTag
            v-else-if="!isEnabled(tool)"
            size="tiny"
            :bordered="false"
            type="warning"
          >
            {{ t("tools.off") }}
          </NTag>
          <NButton size="tiny" quaternary @click="copyName(tool.name)">
            {{ t("common.copy") }}
          </NButton>
        </NSpace>
        <div v-if="openId === tool.namespacedName" class="tool-body">
          <p class="desc">{{ tool.description || t("tools.noDescription") }}</p>
          <div v-if="argsFromSchema(tool.inputSchema).length" class="args">
            <NText depth="3" class="args-label">{{ t("tools.arguments") }}</NText>
            <div class="arg-row">
              <NTag
                v-for="a in argsFromSchema(tool.inputSchema)"
                :key="a.name"
                size="small"
                :type="a.required ? 'warning' : 'default'"
                :bordered="false"
              >
                {{ a.name }}
                <span class="arg-meta">
                  {{
                    a.required
                      ? t("tools.argMetaRequired", { type: a.type })
                      : t("tools.argMetaOptional", { type: a.type })
                  }}
                </span>
              </NTag>
            </div>
          </div>
          <NText v-else depth="3" class="no-args">{{ t("tools.noArguments") }}</NText>
        </div>
      </div>
    </div>
  </NCard>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.75rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.tool {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.35rem 0.5rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.tool.off {
  opacity: 0.72;
}
.tool.open {
  border-color: color-mix(
    in srgb,
    var(--app-chip-active-text) 40%,
    var(--app-border)
  );
}
.tool-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 0.88rem;
}
.ns {
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.tool-actions {
  flex-shrink: 0;
}
.tool-body {
  grid-column: 1 / -1;
  padding-top: 0.35rem;
  border-top: 1px solid var(--app-border);
}
.desc {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: var(--app-text-soft);
  line-height: 1.4;
}
.args-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.3rem;
}
.arg-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.arg-meta {
  opacity: 0.8;
  font-weight: 400;
}
.no-args {
  font-size: 0.82rem;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NCheckbox,
  NSelect,
  NSpace,
  NTag,
  NText,
} from "naive-ui";
import { api } from "../api/client";
import type { ScopeGrant, ToolInfo } from "../types";

const props = withDefaults(
  defineProps<{
    modelValue: ScopeGrant[];
    serverOptions: Array<{ id: string; name: string }>;
    ceiling?: ScopeGrant[] | null;
    allowWildcard?: boolean;
    disabled?: boolean;
  }>(),
  {
    ceiling: null,
    allowWildcard: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: ScopeGrant[]];
}>();

const toolCache = ref<Record<string, string[]>>({});
const loadingTools = ref<Record<string, boolean>>({});

/** Canonical action buckets for quick-select (snake_case + CamelCase tools). */
const CATEGORY_ORDER = [
  "get",
  "create",
  "update",
  "delete",
  "import",
  "export",
  "auth",
  "other",
];

/** Map verb-like name segments → category. */
const VERB_TO_CATEGORY: Record<string, string> = {
  get: "get",
  list: "get",
  read: "get",
  inspect: "get",
  status: "get",
  fetch: "get",
  query: "get",
  search: "get",
  find: "get",
  view: "get",
  show: "get",
  create: "create",
  add: "create",
  insert: "create",
  post: "create",
  install: "create",
  new: "create",
  update: "update",
  patch: "update",
  set: "update",
  put: "update",
  edit: "update",
  modify: "update",
  delete: "delete",
  remove: "delete",
  destroy: "delete",
  drop: "delete",
  import: "import",
  upload: "import",
  export: "export",
  download: "export",
  authenticate: "auth",
  auth: "auth",
  login: "auth",
  logout: "auth",
};

const selectableServers = computed(() => {
  const opts = props.serverOptions.map((s) => ({
    label: `${s.name} (${s.id})`,
    value: s.id,
  }));
  if (props.allowWildcard) {
    opts.unshift({ label: "All servers (*)", value: "*" });
  }
  if (props.ceiling?.length) {
    if (props.ceiling.some((g) => g.serverId === "*")) return opts;
    const allowed = new Set(props.ceiling.map((g) => g.serverId));
    return opts.filter((o) => o.value === "*" || allowed.has(o.value));
  }
  return opts;
});

function ceilingTools(serverId: string): string[] | null {
  if (!props.ceiling?.length) return null;
  if (props.ceiling.some((g) => g.serverId === "*" && g.tools.includes("*"))) {
    return ["*"];
  }
  const exact = props.ceiling.find((g) => g.serverId === serverId);
  const star = props.ceiling.find((g) => g.serverId === "*");
  return (exact ?? star)?.tools ?? [];
}

function canUseAllTools(serverId: string): boolean {
  const ceiling = ceilingTools(serverId);
  if (ceiling == null) return true;
  return ceiling.includes("*");
}

async function ensureTools(serverId: string) {
  if (!serverId || serverId === "*" || toolCache.value[serverId]) return;
  loadingTools.value = { ...loadingTools.value, [serverId]: true };
  try {
    const { tools } = await api<{ tools: ToolInfo[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/tools`,
    );
    toolCache.value = {
      ...toolCache.value,
      [serverId]: tools.map((t) => t.name),
    };
  } catch {
    toolCache.value = { ...toolCache.value, [serverId]: [] };
  } finally {
    loadingTools.value = { ...loadingTools.value, [serverId]: false };
  }
}

watch(
  () => props.modelValue.map((g) => g.serverId).join(","),
  () => {
    for (const g of props.modelValue) void ensureTools(g.serverId);
  },
  { immediate: true },
);

function addRow() {
  const first = selectableServers.value[0]?.value;
  if (!first) return;
  const ceiling = ceilingTools(first);
  const tools =
    ceiling == null || ceiling.includes("*")
      ? ["*"]
      : ceiling.length
      ? [ceiling[0]!]
      : [];
  emit("update:modelValue", [...props.modelValue, { serverId: first, tools }]);
  void ensureTools(first);
}

function removeRow(idx: number) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, i) => i !== idx),
  );
}

function setServer(idx: number, serverId: string) {
  const ceiling = ceilingTools(serverId);
  const tools =
    ceiling == null || ceiling.includes("*")
      ? ["*"]
      : ceiling.length
      ? [ceiling[0]!]
      : [];
  emit(
    "update:modelValue",
    props.modelValue.map((g, i) =>
      i === idx ? { serverId, tools } : g,
    ),
  );
  void ensureTools(serverId);
}

function setAllTools(idx: number, all: boolean) {
  const grant = props.modelValue[idx];
  if (!grant) return;
  let tools: string[];
  if (all) {
    tools = ["*"];
  } else {
    const choices = toolChoices(grant.serverId);
    tools = choices.length ? [choices[0]!] : [];
  }
  emit(
    "update:modelValue",
    props.modelValue.map((g, i) => (i === idx ? { ...g, tools } : g)),
  );
}

function toggleTool(idx: number, tool: string, on: boolean) {
  const grant = props.modelValue[idx];
  if (!grant) return;
  let tools = grant.tools.includes("*") ? [] : [...grant.tools];
  if (on) {
    if (!tools.includes(tool)) tools.push(tool);
  } else {
    tools = tools.filter((t) => t !== tool);
  }
  emit(
    "update:modelValue",
    props.modelValue.map((g, i) => (i === idx ? { ...g, tools } : g)),
  );
}

function toolChoices(serverId: string): string[] {
  const discovered = toolCache.value[serverId] ?? [];
  const ceiling = ceilingTools(serverId);
  if (ceiling == null || ceiling.includes("*")) return discovered;
  const set = new Set(discovered);
  // Prefer discovered ∩ ceiling; fall back to ceiling if server isn't running.
  const intersection = ceiling.filter((t) => set.has(t));
  return intersection.length ? intersection : ceiling;
}

/** Split snake_case, kebab-case, or CamelCase/PascalCase tool names into words. */
function splitToolName(tool: string): string[] {
  if (/[_-]/.test(tool)) {
    return tool.split(/[_-]+/).filter(Boolean);
  }
  return tool
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s.]+/)
    .filter(Boolean);
}

/**
 * Categorize a tool for quick-select.
 * - mealie: get_recipes → get (leading verb)
 * - portainer: EndpointList / EndpointDelete → get / delete (trailing verb)
 */
function toolCategory(tool: string): string {
  const parts = splitToolName(tool).map((p) => p.toLowerCase());
  if (!parts.length) return "other";

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;

  // Trailing verb first (Portainer NounVerb), then leading (Mealie verb_noun).
  if (parts.length > 1 && VERB_TO_CATEGORY[last]) {
    return VERB_TO_CATEGORY[last]!;
  }
  if (VERB_TO_CATEGORY[first]) return VERB_TO_CATEGORY[first]!;
  if (parts.length === 1 && VERB_TO_CATEGORY[parts[0]!]) {
    return VERB_TO_CATEGORY[parts[0]!]!;
  }
  return "other";
}

function toolsByPrefix(
  serverId: string,
): Array<{ prefix: string; tools: string[] }> {
  const groups = new Map<string, string[]>();
  for (const tool of toolChoices(serverId)) {
    const prefix = toolCategory(tool);
    const list = groups.get(prefix) ?? [];
    list.push(tool);
    groups.set(prefix, list);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((prefix) => ({ prefix, tools: groups.get(prefix)! }));
}

function prefixState(
  grant: ScopeGrant,
  prefixTools: string[],
): { checked: boolean; indeterminate: boolean } {
  if (grant.tools.includes("*")) {
    return { checked: true, indeterminate: false };
  }
  const selected = prefixTools.filter((t) => grant.tools.includes(t)).length;
  if (selected === 0) return { checked: false, indeterminate: false };
  if (selected === prefixTools.length) {
    return { checked: true, indeterminate: false };
  }
  return { checked: false, indeterminate: true };
}

function setPrefix(idx: number, prefixTools: string[], on: boolean) {
  const grant = props.modelValue[idx];
  if (!grant) return;
  const prefixSet = new Set(prefixTools);
  let tools = grant.tools.includes("*")
    ? toolChoices(grant.serverId).filter((t) => !prefixSet.has(t))
    : grant.tools.filter((t) => !prefixSet.has(t));
  if (on) {
    for (const t of prefixTools) {
      if (!tools.includes(t)) tools.push(t);
    }
  }
  // If everything is selected, collapse to wildcard when allowed.
  const all = toolChoices(grant.serverId);
  if (
    on &&
    canUseAllTools(grant.serverId) &&
    all.length &&
    all.every((t) => tools.includes(t))
  ) {
    tools = ["*"];
  }
  emit(
    "update:modelValue",
    props.modelValue.map((g, i) => (i === idx ? { ...g, tools } : g)),
  );
}

function formatGrant(g: ScopeGrant): string {
  const tools = g.tools.includes("*") ? "all tools" : g.tools.join(", ") || "none";
  return `${g.serverId}: ${tools}`;
}
</script>

<template>
  <div class="scope-editor">
    <div v-if="!modelValue.length" class="empty">
      <NText depth="3">No server scopes yet — add one to grant access.</NText>
    </div>

    <div v-for="(grant, idx) in modelValue" :key="idx" class="row">
      <div class="row-head">
        <div class="row-title">
          <NText depth="3" class="row-label">Server</NText>
          <NSelect
            :value="grant.serverId"
            :options="selectableServers"
            :disabled="disabled"
            size="small"
            style="min-width: 200px; max-width: 100%"
            @update:value="(v: string) => setServer(idx, v)"
          />
        </div>
        <NButton
          size="small"
          secondary
          type="error"
          :disabled="disabled"
          @click="removeRow(idx)"
        >
          Remove
        </NButton>
      </div>

      <div class="row-body">
        <NCheckbox
          v-if="canUseAllTools(grant.serverId)"
          :checked="grant.tools.includes('*')"
          :disabled="disabled"
          @update:checked="(v: boolean) => setAllTools(idx, v)"
        >
          All tools on this server
        </NCheckbox>

        <div
          v-if="!grant.tools.includes('*') && grant.serverId !== '*'"
          class="tools"
        >
          <NText v-if="loadingTools[grant.serverId]" depth="3">
            Loading tools…
          </NText>
          <NText v-else-if="!toolChoices(grant.serverId).length" depth="3">
            No tools available for this server yet.
          </NText>
          <template v-else>
            <div
              v-if="toolsByPrefix(grant.serverId).length > 1"
              class="prefix-bar"
            >
              <NText depth="3" class="prefix-label">Quick select</NText>
              <NSpace :size="8" :wrap="true">
                <NCheckbox
                  v-for="group in toolsByPrefix(grant.serverId)"
                  :key="group.prefix"
                  :checked="prefixState(grant, group.tools).checked"
                  :indeterminate="prefixState(grant, group.tools).indeterminate"
                  :disabled="disabled"
                  @update:checked="(v: boolean) => setPrefix(idx, group.tools, v)"
                >
                  All {{ group.prefix }}
                  <NText depth="3">({{ group.tools.length }})</NText>
                </NCheckbox>
              </NSpace>
            </div>

            <div
              v-for="group in toolsByPrefix(grant.serverId)"
              :key="`grp-${group.prefix}`"
              class="tool-group"
            >
              <div class="group-head">{{ group.prefix }}</div>
              <NSpace :size="6" :wrap="true">
                <NCheckbox
                  v-for="tool in group.tools"
                  :key="tool"
                  :checked="grant.tools.includes(tool)"
                  :disabled="disabled"
                  @update:checked="(v: boolean) => toggleTool(idx, tool, v)"
                >
                  <code>{{ tool }}</code>
                </NCheckbox>
              </NSpace>
            </div>
          </template>
        </div>

        <NTag size="small" :bordered="false" class="grant-tag">
          {{ formatGrant(grant) }}
        </NTag>
      </div>
    </div>

    <NButton
      size="small"
      dashed
      :disabled="disabled || !selectableServers.length"
      @click="addRow"
    >
      Add server scope
    </NButton>
  </div>
</template>

<style scoped>
.scope-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--app-surface);
}
.row-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}
.row-title {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  flex: 1;
}
.row-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.row-body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.empty {
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px dashed var(--app-border);
  background: transparent;
}
.tools {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.prefix-bar {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px dashed var(--app-border);
  background: var(--app-surface-raised);
}
.prefix-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tool-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.group-head {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}
.grant-tag {
  align-self: flex-start;
}
code {
  font-size: 0.85em;
}
</style>

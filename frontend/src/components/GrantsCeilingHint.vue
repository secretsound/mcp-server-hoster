<script setup lang="ts">
import { computed } from "vue";
import { NText } from "naive-ui";
import type { ScopeGrant } from "../types";
import { scopesSummary } from "../utils/scopes";

const props = withDefaults(
  defineProps<{
    grants: ScopeGrant[];
    /** When true, treat as unrestricted (mcp:full / tenant key). */
    unrestricted?: boolean;
    label?: string;
    /** Quieter inline summary for dense forms/modals. */
    compact?: boolean;
  }>(),
  {
    unrestricted: false,
    compact: false,
  },
);

const text = computed(() => {
  if (props.unrestricted) return "Full access — no ceiling";
  if (!props.grants.length) {
    return "No grants — cannot reach any servers until you add scopes";
  }
  return scopesSummary(props.grants);
});

const detail = computed(() => {
  if (props.unrestricted || !props.grants.length) return "";
  return props.grants
    .map((g) =>
      `${g.serverId}:${g.tools.includes("*") ? "*" : g.tools.join("|")}`,
    )
    .join(" · ");
});
</script>

<template>
  <div class="ceiling" :class="{ compact }">
    <NText depth="3" class="label">
      {{ label || "Grant ceiling" }}
    </NText>
    <div class="value">{{ text }}</div>
    <div v-if="detail" class="detail" :title="detail">{{ detail }}</div>
  </div>
</template>

<style scoped>
.ceiling {
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.ceiling.compact {
  margin-bottom: 0;
  padding: 0.5rem 0.65rem;
  background: transparent;
  border-style: dashed;
}
.label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.2rem;
}
.value {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--app-text);
}
.compact .value {
  font-weight: 500;
  font-size: 0.86rem;
}
.detail {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

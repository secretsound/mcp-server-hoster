<script setup lang="ts">
import { computed } from "vue";
import { NTag, NTooltip } from "naive-ui";
import { statusLabel } from "../utils/serverForm";

const props = defineProps<{
  status: string;
  /** Shown in tooltip when present (typically lastError for crashed servers). */
  error?: string | null;
}>();

const type = computed(() => {
  switch (props.status) {
    case "running":
      return "success" as const;
    case "error":
      return "error" as const;
    case "starting":
    case "restarting":
      return "warning" as const;
    default:
      return "default" as const;
  }
});

const label = computed(() => statusLabel(props.status));
const tip = computed(() => props.error?.trim() || null);
</script>

<template>
  <NTooltip v-if="tip" trigger="hover">
    <template #trigger>
      <NTag size="small" :type="type" :bordered="false" round class="status-tag">
        {{ label }}
      </NTag>
    </template>
    {{ tip }}
  </NTooltip>
  <NTag v-else size="small" :type="type" :bordered="false" round class="status-tag">
    {{ label }}
  </NTag>
</template>

<style scoped>
.status-tag {
  text-transform: none;
  font-weight: 600;
}
</style>

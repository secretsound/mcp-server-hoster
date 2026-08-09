<script setup lang="ts">
import { NButton, NCard, NSpace, NText } from "naive-ui";
import { RefreshOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";

defineProps<{
  logs: string;
  loading?: boolean;
}>();

const emit = defineEmits<{ refresh: [] }>();
</script>

<template>
  <NCard size="small" :bordered="true">
    <template #header>
      <NSpace justify="space-between" align="center">
        <span>Logs</span>
        <NButton size="tiny" quaternary :loading="loading" @click="emit('refresh')">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          Refresh
        </NButton>
      </NSpace>
    </template>
    <pre class="log">{{ logs || "(empty)" }}</pre>
    <NText v-if="!logs" depth="3" style="display: none" />
  </NCard>
</template>

<style scoped>
.log {
  margin: 0;
  max-height: min(70vh, 640px);
  overflow: auto;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: #0f1a21;
  color: #d7e2ea;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

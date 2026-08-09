<script setup lang="ts">
import { NButton, NTooltip, useMessage } from "naive-ui";
import { CopyOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { useServersStore } from "../stores/servers";
import { copyText } from "../utils/serverForm";

const servers = useServersStore();
const message = useMessage();

async function copy() {
  const ok = await copyText(servers.gatewayUrl);
  if (ok) message.success("Gateway URL copied");
  else message.error("Could not copy");
}
</script>

<template>
  <div class="gateway-pill">
    <NTooltip>
      <template #trigger>
        <code class="url">{{ servers.gatewayUrl }}</code>
      </template>
      Unified MCP gateway
    </NTooltip>
    <NButton size="tiny" quaternary @click="copy">
      <template #icon>
        <NIcon :component="CopyOutline" />
      </template>
      Copy
    </NButton>
  </div>
</template>

<style scoped>
.gateway-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: min(420px, 100%);
  padding: 0.2rem 0.35rem 0.2rem 0.65rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--pill-bg);
}
.url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
}
</style>

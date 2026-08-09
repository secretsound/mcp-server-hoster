import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import { connectSse } from "../api/sse";
import type {
  CreateServerInput,
  HealthResponse,
  ServerWithRuntime,
  ToolInfo,
  UpdateServerInput,
  UpgradeServerInput,
} from "../types";
import { statusOf } from "../utils/serverForm";
import { useSettingsStore } from "./settings";

export const useServersStore = defineStore("servers", () => {
  const servers = ref<ServerWithRuntime[]>([]);
  const gatewayUrl = ref(`${window.location.origin}/mcp`);
  const loading = ref(false);
  const live = ref(false);
  const error = ref<string | null>(null);
  const busyIds = ref<Record<string, boolean>>({});
  let streamUsers = 0;
  let stopStream: (() => void) | null = null;

  const runningCount = computed(
    () => servers.value.filter((s) => statusOf(s) === "running").length,
  );

  async function refreshHealth() {
    try {
      const health = await api<HealthResponse>("/health");
      if (health.gateway) gatewayUrl.value = health.gateway;
    } catch {
      /* keep previous */
    }
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      const [{ servers: list }] = await Promise.all([
        api<{ servers: ServerWithRuntime[] }>("/api/servers"),
        refreshHealth(),
      ]);
      servers.value = list;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function applyServers(list: ServerWithRuntime[]) {
    servers.value = list;
    error.value = null;
  }

  function startPolling() {
    streamUsers += 1;
    if (stopStream) return;

    void refresh().catch(() => {
      /* surfaced via error */
    });

    stopStream = connectSse("/api/events", {
      onOpen: () => {
        live.value = true;
      },
      onEvent: (event, data) => {
        if (event === "servers" && data && typeof data === "object") {
          const list = (data as { servers?: ServerWithRuntime[] }).servers;
          if (Array.isArray(list)) applyServers(list);
        }
      },
      onError: () => {
        live.value = false;
      },
    });
  }

  function stopPolling() {
    streamUsers = Math.max(0, streamUsers - 1);
    if (streamUsers === 0 && stopStream) {
      stopStream();
      stopStream = null;
      live.value = false;
    }
  }

  function setBusy(id: string, busy: boolean) {
    busyIds.value = { ...busyIds.value, [id]: busy };
  }

  async function getServer(id: string) {
    const { server } = await api<{ server: ServerWithRuntime }>(
      `/api/servers/${encodeURIComponent(id)}`,
    );
    const idx = servers.value.findIndex((s) => s.id === id);
    if (idx >= 0) {
      const next = [...servers.value];
      next[idx] = server;
      servers.value = next;
    } else {
      servers.value = [...servers.value, server];
    }
    return server;
  }

  async function create(input: CreateServerInput) {
    const { server } = await api<{ server: ServerWithRuntime }>("/api/servers", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await refresh();
    return server;
  }

  async function update(id: string, input: UpdateServerInput) {
    const { server } = await api<{ server: ServerWithRuntime }>(
      `/api/servers/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    await refresh();
    return server;
  }

  async function remove(id: string) {
    setBusy(id, true);
    try {
      await api(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(id, false);
    }
  }

  async function lifecycle(
    id: string,
    act: "start" | "stop" | "restart",
  ) {
    setBusy(id, true);
    try {
      await api(`/api/servers/${encodeURIComponent(id)}/${act}`, {
        method: "POST",
      });
      // Status will also arrive via SSE; refresh keeps tools/pid in sync immediately.
      await refresh();
    } finally {
      setBusy(id, false);
    }
  }

  async function upgrade(id: string, input: UpgradeServerInput = {}) {
    setBusy(id, true);
    try {
      const result = await api<{
        server: ServerWithRuntime;
        upgrade: {
          kind: string;
          name: string | null;
          version: string | null;
          previousVersion: string | null;
          label: string;
          clearedCache?: boolean;
        };
      }>(`/api/servers/${encodeURIComponent(id)}/upgrade`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return result;
    } finally {
      setBusy(id, false);
    }
  }

  async function logs(id: string, tail?: number) {
    const n = tail ?? useSettingsStore().defaultLogTail;
    const { logs: text } = await api<{ logs: string }>(
      `/api/servers/${encodeURIComponent(id)}/logs?tail=${n}`,
    );
    return text;
  }

  function streamLogs(
    id: string,
    handlers: {
      onReset?: (text: string) => void;
      onChunk?: (chunk: string) => void;
      onError?: (err: unknown) => void;
    },
    tail?: number,
  ): () => void {
    const n = tail ?? useSettingsStore().defaultLogTail;
    return connectSse(
      `/api/servers/${encodeURIComponent(id)}/logs/stream?tail=${n}`,
      {
        onEvent: (event, data) => {
          if (!data || typeof data !== "object") return;
          if (event === "reset") {
            handlers.onReset?.(
              String((data as { logs?: string }).logs ?? ""),
            );
          } else if (event === "log") {
            handlers.onChunk?.(
              String((data as { chunk?: string }).chunk ?? ""),
            );
          }
        },
        onError: handlers.onError,
      },
    );
  }

  async function tools(id: string) {
    const { tools: list } = await api<{ tools: ToolInfo[] }>(
      `/api/servers/${encodeURIComponent(id)}/tools`,
    );
    return list;
  }

  return {
    servers,
    gatewayUrl,
    loading,
    live,
    error,
    busyIds,
    runningCount,
    refresh,
    refreshHealth,
    startPolling,
    stopPolling,
    getServer,
    create,
    update,
    remove,
    lifecycle,
    upgrade,
    logs,
    streamLogs,
    tools,
  };
});

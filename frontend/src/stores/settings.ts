import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";

export const useSettingsStore = defineStore("settings", () => {
  const displayName = ref("MCP Hoster");
  const defaultLogTail = ref(200);
  const loaded = ref(false);

  async function load() {
    try {
      const res = await api<{ settings: Record<string, string> }>("/api/settings");
      const s = res.settings || {};
      displayName.value = s["host.display_name"] || "MCP Hoster";
      const tail = Number(s["ui.default_log_tail"] || "200");
      defaultLogTail.value = Number.isFinite(tail) ? tail : 200;
      loaded.value = true;
    } catch {
      /* keep defaults when unauthenticated / no permission */
    }
  }

  function applyLocal(patch: {
    displayName?: string;
    defaultLogTail?: number;
  }) {
    if (patch.displayName != null) displayName.value = patch.displayName;
    if (patch.defaultLogTail != null) defaultLogTail.value = patch.defaultLogTail;
  }

  return { displayName, defaultLogTail, loaded, load, applyLocal };
});

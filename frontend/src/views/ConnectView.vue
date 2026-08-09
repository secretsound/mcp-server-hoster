<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import GatewayPill from "../components/GatewayPill.vue";
import { getSessionToken } from "../api/client";
import { connectPlatforms } from "../data/templates";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type { ApiKey } from "../types";
import {
  preferredMcpUrl,
  scopesSummary,
  serversFromScopes,
} from "../utils/scopes";
import { copyText } from "../utils/serverForm";

const servers = useServersStore();
const auth = useAuthStore();
const message = useMessage();
const route = useRoute();
const router = useRouter();

const keysLoading = ref(false);
const myKeys = ref<ApiKey[]>([]);
const tenantKeys = ref<ApiKey[]>([]);
/** null = generic placeholder; "oauth" = URL-only; else key id */
const selection = ref<string | null>(null);
const pastedSecret = ref("");
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);

const allKeys = computed(() => [
  ...myKeys.value.map((k) => ({ ...k, _kind: "user" as const })),
  ...tenantKeys.value.map((k) => ({ ...k, _kind: "tenant" as const })),
]);

const selectedKey = computed(() =>
  allKeys.value.find((k) => k.id === selection.value) ?? null,
);

const selectOptions = computed(() => {
  type Opt =
    | { label: string; value: string }
    | {
      type: "group";
      label: string;
      key: string;
      children: { label: string; value: string }[];
    };
  const opts: Opt[] = [
    {
      label: "Generic placeholder (mch_YOUR_API_KEY)",
      value: "__placeholder__",
    },
  ];
  if (auth.required) {
    opts.push({
      label: "OAuth / browser sign-in (no static key)",
      value: "__oauth__",
    });
  }
  if (myKeys.value.length) {
    opts.push({
      type: "group",
      label: "Your keys",
      key: "g-user",
      children: myKeys.value.map((k) => ({
        label: `${k.name} · ${k.keyPrefix}… · ${scopesSummary(k.scopes)}`,
        value: k.id,
      })),
    });
  }
  if (tenantKeys.value.length) {
    opts.push({
      type: "group",
      label: "Tenant keys",
      key: "g-tenant",
      children: tenantKeys.value.map((k) => ({
        label: `${k.name} · ${k.keyPrefix}… · ${scopesSummary(k.scopes)}`,
        value: k.id,
      })),
    });
  }
  return opts;
});

const selectValue = computed({
  get() {
    if (selection.value === null) return "__placeholder__";
    return selection.value;
  },
  set(v: string) {
    if (v === "__placeholder__") selection.value = null;
    else selection.value = v;
    pastedSecret.value = "";
  },
});

const mcpTarget = computed(() => {
  if (selection.value === "__oauth__") {
    return preferredMcpUrl(
      servers.gatewayUrl,
      auth.user?.grants?.length
        ? auth.user.grants
        : [{ serverId: "*", tools: ["*"] }],
    );
  }
  if (selectedKey.value) {
    return preferredMcpUrl(servers.gatewayUrl, selectedKey.value.scopes);
  }
  return preferredMcpUrl(servers.gatewayUrl, [{ serverId: "*", tools: ["*"] }]);
});

const reachable = computed(() => {
  if (selection.value === "__oauth__") {
    return serversFromScopes(
      auth.user?.grants ?? [],
      servers.servers.map((s) => ({ id: s.id, name: s.name })),
    );
  }
  if (!selectedKey.value) return [];
  return serversFromScopes(
    selectedKey.value.scopes,
    servers.servers.map((s) => ({ id: s.id, name: s.name })),
  );
});

const bearerForSnippets = computed(() => {
  if (!auth.required || selection.value === "__oauth__") return undefined;
  if (pastedSecret.value.trim()) return pastedSecret.value.trim();
  if (selectedKey.value) {
    return `${selectedKey.value.keyPrefix}…PASTE_FULL_SECRET`;
  }
  return undefined;
});

const platforms = computed(() =>
  connectPlatforms(mcpTarget.value.url, {
    authRequired: auth.required,
    bearerToken: bearerForSnippets.value,
  }),
);

const serverName = (id: string) => {
  if (id === "*") return "All servers";
  return servers.servers.find((s) => s.id === id)?.name || id;
};

const reachableToolHint = computed(() => {
  const rows = reachable.value;
  if (!rows.length) return "";
  let tools = 0;
  let running = 0;
  for (const r of rows) {
    if (r.id === "*") {
      for (const s of servers.servers) {
        tools += s.toolCount ?? 0;
        if (s.runtime?.lastStatus === "running") running++;
      }
      return `${running} running · ${tools} tools visible on host`;
    }
    const s = servers.servers.find((x) => x.id === r.id);
    if (!s) continue;
    tools += s.toolCount ?? 0;
    if (s.runtime?.lastStatus === "running") running++;
  }
  return `${running}/${rows.length} running · ${tools} tools discovered`;
});

async function testConnection() {
  testResult.value = null;
  testing.value = true;
  try {
    let bearer: string | null = null;
    if (selection.value === "__oauth__" || !auth.required) {
      bearer = getSessionToken();
    } else if (pastedSecret.value.trim()) {
      bearer = pastedSecret.value.trim();
    } else if (selectedKey.value) {
      testResult.value = {
        ok: false,
        message: "Paste the full API key secret to test (prefix alone is not enough).",
      };
      return;
    } else {
      testResult.value = {
        ok: false,
        message: "Select a key and paste its secret, or choose OAuth / session.",
      };
      return;
    }
    if (auth.required && !bearer) {
      testResult.value = {
        ok: false,
        message: "No credentials available for the test call.",
      };
      return;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(mcpTarget.value.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const text = await res.text();
    let toolCount = 0;
    try {
      const json = JSON.parse(text) as {
        result?: { tools?: unknown[] };
        error?: { message?: string };
      };
      if (json.error?.message) throw new Error(json.error.message);
      toolCount = json.result?.tools?.length ?? 0;
    } catch (err) {
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
      throw err;
    }
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
    testResult.value = {
      ok: true,
      message: `Connected — tools/list returned ${toolCount} tool${
        toolCount === 1 ? "" : "s"
      }.`,
    };
  } catch (err) {
    testResult.value = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    testing.value = false;
  }
}

async function loadKeys() {
  if (!auth.required || !auth.isAuthenticated) return;
  keysLoading.value = true;
  try {
    myKeys.value = await auth.listMyKeys();
    if (auth.can("keys:tenant")) {
      tenantKeys.value = await auth.listTenantKeys();
    }
    const q = typeof route.query.key === "string" ? route.query.key : null;
    if (q && allKeys.value.some((k) => k.id === q)) {
      selection.value = q;
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    keysLoading.value = false;
  }
}

watch(selection, (id) => {
  const next = id && id !== "__oauth__" ? id : undefined;
  const cur = typeof route.query.key === "string" ? route.query.key : undefined;
  if (next === cur || (!next && !cur)) return;
  const query = { ...route.query };
  if (next) query.key = next;
  else delete query.key;
  router.replace({ query });
});

onMounted(async () => {
  await servers.refresh().catch(() => {});
  await loadKeys();
});

async function copy(code: string) {
  if (await copyText(code)) message.success("Copied");
}

async function copyUrl() {
  if (await copyText(mcpTarget.value.url)) message.success("URL copied");
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Connect</h1>
        <p class="page-sub">
          Point MCP clients at this host’s unified gateway.
        </p>
      </div>
      <GatewayPill />
    </div>

    <NCard size="small" class="key-picker" :bordered="false">
      <div class="picker-grid">
        <div>
          <NText depth="3" class="label">API key for snippets</NText>
          <NSelect
            v-model:value="selectValue"
            :options="selectOptions"
            :loading="keysLoading"
            :disabled="!auth.required"
            placeholder="Select a key"
            filterable
          />
          <NText v-if="!auth.required" depth="3" class="hint">
            Auth is disabled — snippets omit Bearer headers.
          </NText>
          <NText
            v-else-if="!allKeys.length && !keysLoading"
            depth="3"
            class="hint"
          >
            No keys yet —
            <a href="#" @click.prevent="router.push('/keys')">create one</a>
            to scope which servers clients can reach.
          </NText>
        </div>
        <div v-if="selectedKey" class="secret-box">
          <NText depth="3" class="label">
            Paste full secret (optional, only stored in this tab)
          </NText>
          <NInput
            v-model:value="pastedSecret"
            type="password"
            show-password-on="click"
            autocomplete="off"
            :placeholder="`${selectedKey.keyPrefix}…`"
            :input-props="{ spellcheck: false }"
          />
          <NText depth="3" class="hint">
            Secrets are shown once at creation. Without a paste, snippets use
            <code>{{ selectedKey.keyPrefix }}…PASTE_FULL_SECRET</code>.
          </NText>
        </div>
      </div>

      <div class="url-row">
        <div>
          <NText depth="3" class="label">MCP URL in snippets</NText>
          <code class="url">{{ mcpTarget.url }}</code>
          <NTag
            size="tiny"
            :bordered="false"
            style="margin-left: 0.4rem"
          >
            {{ mcpTarget.mode === "per-server" ? "per-server" : "unified" }}
          </NTag>
        </div>
        <NButton size="tiny" @click="copyUrl">Copy URL</NButton>
      </div>

      <div v-if="auth.required" class="reach">
        <NText depth="3" class="label">
          {{
            selection === "__oauth__"
              ? "Your account can reach"
              : selectedKey
              ? "This key can reach"
              : "Pick a key to see reachable servers"
          }}
        </NText>
        <NSpace v-if="reachable.length" :size="6" style="margin-top: 0.35rem">
          <NTag
            v-for="r in reachable"
            :key="r.id"
            size="small"
            :bordered="false"
            type="success"
          >
            {{ serverName(r.id) }}
            <template v-if="r.id !== '*'">
              · {{ r.allTools ? "all tools" : `${r.tools.length} tools` }}
              <template v-if="servers.servers.find((s) => s.id === r.id)">
                · {{ servers.servers.find((s) => s.id === r.id)?.toolCount ?? 0 }} live
              </template>
            </template>
            <template v-else>
              · {{ r.allTools ? "all tools" : "limited tools" }}
            </template>
          </NTag>
        </NSpace>
        <NText v-if="reachableToolHint" depth="3" class="hint">
          {{ reachableToolHint }}
        </NText>
        <NText v-else-if="selectedKey || selection === '__oauth__'" depth="3">
          No server scopes configured.
        </NText>
      </div>

      <NSpace style="margin-top: 0.85rem" align="center">
        <NButton
          type="primary"
          secondary
          :loading="testing"
          @click="testConnection"
        >
          Test connection
        </NButton>
        <NText depth="3" class="hint" style="margin: 0">
          Runs <code>tools/list</code> against the MCP URL above.
        </NText>
      </NSpace>
      <NAlert
        v-if="testResult"
        :type="testResult.ok ? 'success' : 'error'"
        :bordered="false"
        style="margin-top: 0.65rem"
      >
        {{ testResult.message }}
      </NAlert>
    </NCard>

    <aside class="notes">
      <p>
        Transport: <strong>Streamable HTTP</strong>
      </p>
      <ul>
        <li>
          <strong>Unified</strong>
          <code>{{ servers.gatewayUrl }}</code>
          — all running servers; tools named <code>serverId__tool</code>
        </li>
        <li>
          <strong>Per-server</strong>
          <code>{{ servers.gatewayUrl }}/&lt;serverId&gt;</code>
          — one backend, original tool names
        </li>
        <li v-if="auth.required">
          <strong>Auth</strong>
          — OAuth when the client supports it, or
          <code>Bearer mch_…</code> from API keys.
          Session tokens (<code>mcs_…</code>) are UI-only.
        </li>
        <li v-else>
          <strong>Auth</strong>
          — disabled on this host (<code>AUTH_DISABLED</code>); no Bearer needed
        </li>
      </ul>
    </aside>

    <NCollapse>
      <NCollapseItem
        v-for="p in platforms"
        :key="p.id"
        :name="p.id"
        :title="p.name"
      >
        <NCard size="small" :bordered="false" content-style="padding: 0">
          <NText depth="3" class="blurb">{{ p.blurb }}</NText>
          <ol>
            <li v-for="(step, i) in p.steps" :key="i">{{ step }}</li>
          </ol>
          <div v-for="(snip, i) in p.snippets" :key="i" class="snip">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{ snip.label }}</NText>
              <NButton size="tiny" @click="copy(snip.code)">Copy</NButton>
            </NSpace>
            <pre class="code">{{ snip.code }}</pre>
          </div>
          <p v-if="p.docs" class="docs">
            Docs:
            <a :href="p.docs" target="_blank" rel="noopener">{{ p.docs }}</a>
          </p>
        </NCard>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.key-picker {
  --n-color: color-mix(
    in srgb,
    var(--app-chip-active-text) 10%,
    var(--app-surface)
  );
  --n-border-color: color-mix(
    in srgb,
    var(--app-chip-active-text) 28%,
    var(--app-border)
  );
  background: var(--n-color);
  border: 1px solid var(--n-border-color);
}
.picker-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}
@media (min-width: 720px) {
  .picker-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.label {
  display: block;
  font-size: 0.78rem;
  margin-bottom: 0.3rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hint {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.8rem;
}
.hint a {
  color: var(--n-primary-color, #0b6e4f);
  text-decoration: underline;
}
.url-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.9rem;
  padding-top: 0.85rem;
  border-top: 1px solid
    color-mix(in srgb, var(--n-primary-color, #0b6e4f) 15%, transparent);
}
.url {
  font-size: 0.85rem;
  word-break: break-all;
}
.reach {
  margin-top: 0.85rem;
}
.notes {
  margin: 1rem 0 1.15rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-text) 4%, transparent);
  color: var(--app-text-soft);
  font-size: 0.88rem;
  line-height: 1.45;
}
.notes p {
  margin: 0 0 0.45rem;
}
.notes ul {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.notes li code {
  font-size: 0.82em;
  word-break: break-all;
}
.blurb {
  display: block;
  margin-bottom: 0.75rem;
}
ol {
  margin: 0 0 1rem;
  padding-left: 1.2rem;
  color: var(--app-text-soft);
  line-height: 1.5;
}
.snip {
  margin-bottom: 0.85rem;
}
.code {
  margin: 0.4rem 0 0;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: #0f1a21;
  color: #d7e2ea;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.docs {
  margin: 0;
  font-size: 0.85rem;
  color: var(--app-text-muted);
}
.docs a {
  color: var(--n-primary-color, #0b6e4f);
  text-decoration: underline;
}
</style>

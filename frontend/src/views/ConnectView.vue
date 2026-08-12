<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import { CopyOutline, LinkOutline, OpenOutline } from "@vicons/ionicons5";
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

const { t, locale } = useI18n();
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
const openPlatforms = ref<string[]>([]);

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
      label: t("connect.placeholderOption"),
      value: "__placeholder__",
    },
  ];
  if (auth.required) {
    opts.push({
      label: t("connect.oauthOption"),
      value: "__oauth__",
    });
  }
  if (myKeys.value.length) {
    opts.push({
      type: "group",
      label: t("connect.yourKeys"),
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
      label: t("connect.tenantKeys"),
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

const platforms = computed(() => {
  void locale.value;
  return connectPlatforms(mcpTarget.value.url, {
    authRequired: auth.required,
    bearerToken: bearerForSnippets.value,
  });
});

const serverName = (id: string) => {
  if (id === "*") return t("connect.allServers");
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
      return t("connect.reachableHintAll", { running, tools });
    }
    const s = servers.servers.find((x) => x.id === r.id);
    if (!s) continue;
    tools += s.toolCount ?? 0;
    if (s.runtime?.lastStatus === "running") running++;
  }
  return t("connect.reachableHintPartial", {
    running,
    total: rows.length,
    tools,
  });
});

function platformMonogram(name: string): string {
  const parts = name.replace(/[()]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

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
        message: t("connect.pasteSecretToTest"),
      };
      return;
    } else {
      testResult.value = {
        ok: false,
        message: t("connect.selectKeyOrOauth"),
      };
      return;
    }
    if (auth.required && !bearer) {
      testResult.value = {
        ok: false,
        message: t("connect.noCredentials"),
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
      message: t("connect.connectedTools", { count: toolCount }, toolCount),
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
  if (await copyText(code)) message.success(t("common.copied"));
}

async function copyUrl() {
  if (await copyText(mcpTarget.value.url)) message.success(t("connect.urlCopied"));
}
</script>

<template>
  <div class="connect-page">
    <div class="page-head">
      <div>
        <h1>{{ t("connect.title") }}</h1>
        <p class="page-sub">{{ t("connect.subtitle") }}</p>
      </div>
    </div>

    <section class="setup-panel">
      <header class="setup-hero">
        <div class="setup-mark" aria-hidden="true">
          <NIcon :component="LinkOutline" :size="20" />
        </div>
        <div>
          <div class="setup-kicker">{{ t("connect.setupKicker") }}</div>
          <h2 class="setup-title">{{ t("connect.setupTitle") }}</h2>
        </div>
      </header>

      <div class="picker-grid">
        <div class="field">
          <label class="field-label">{{ t("connect.apiKeyForSnippets") }}</label>
          <NSelect
            v-model:value="selectValue"
            :options="selectOptions"
            :loading="keysLoading"
            :disabled="!auth.required"
            :placeholder="t('connect.selectKey')"
            filterable
          />
          <p v-if="!auth.required" class="field-hint">
            {{ t("connect.authDisabledHint") }}
          </p>
          <p
            v-else-if="!allKeys.length && !keysLoading"
            class="field-hint"
          >
            {{ t("connect.noKeysYet") }}
            <a href="#" @click.prevent="router.push('/keys')">{{ t("connect.createOne") }}</a>
            {{ t("connect.toScopeServers") }}
          </p>
        </div>

        <div v-if="selectedKey" class="field">
          <label class="field-label">{{ t("connect.pasteSecret") }}</label>
          <NInput
            v-model:value="pastedSecret"
            type="password"
            show-password-on="click"
            autocomplete="off"
            :placeholder="`${selectedKey.keyPrefix}…`"
            :input-props="{ spellcheck: false }"
          />
          <p class="field-hint">
            {{
              t("connect.secretHint", {
                placeholder: `${selectedKey.keyPrefix}…PASTE_FULL_SECRET`,
              })
            }}
          </p>
        </div>
      </div>

      <div class="url-card">
        <div class="url-card-top">
          <div>
            <span class="field-label">{{ t("connect.mcpUrlInSnippets") }}</span>
            <span
              class="mode-chip"
              :class="mcpTarget.mode === 'per-server' ? 'mode-per' : 'mode-uni'"
            >
              {{
                mcpTarget.mode === "per-server"
                  ? t("connect.perServer")
                  : t("connect.unified")
              }}
            </span>
          </div>
          <NButton size="tiny" quaternary @click="copyUrl">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("connect.copyUrl") }}
          </NButton>
        </div>
        <code class="url-value">{{ mcpTarget.url }}</code>
      </div>

      <div v-if="auth.required" class="reach-block">
        <span class="field-label">
          {{
            selection === "__oauth__"
              ? t("connect.accountCanReach")
              : selectedKey
              ? t("connect.keyCanReach")
              : t("connect.pickKeyToSee")
          }}
        </span>
        <div v-if="reachable.length" class="reach-chips">
          <span
            v-for="r in reachable"
            :key="r.id"
            class="reach-chip"
          >
            {{ serverName(r.id) }}
            <template v-if="r.id !== '*'">
              · {{ r.allTools ? t("connect.allTools") : t("connect.toolsCount", { count: r.tools.length }) }}
            </template>
            <template v-else>
              · {{ r.allTools ? t("connect.allTools") : t("connect.limitedTools") }}
            </template>
          </span>
        </div>
        <p v-if="reachableToolHint" class="field-hint">{{ reachableToolHint }}</p>
        <p v-else-if="selectedKey || selection === '__oauth__'" class="field-hint">
          {{ t("connect.noServerScopes") }}
        </p>
      </div>

      <div class="test-row">
        <NButton type="primary" :loading="testing" @click="testConnection">
          {{ t("connect.testConnection") }}
        </NButton>
        <span class="field-hint test-hint">{{ t("connect.testHint") }}</span>
      </div>

      <div
        v-if="testResult"
        class="test-result"
        :class="testResult.ok ? 'ok' : 'err'"
      >
        {{ testResult.message }}
      </div>
    </section>

    <section class="tips-grid">
      <article class="tip-card">
        <h3>{{ t("connect.transport") }}</h3>
        <p><strong>{{ t("connect.streamableHttp") }}</strong></p>
      </article>
      <article class="tip-card">
        <h3>{{ t("connect.unifiedLabel") }}</h3>
        <p>
          <code>{{ servers.gatewayUrl }}</code>
          {{ t("connect.unifiedDesc", { pattern: "serverId__tool" }) }}
        </p>
      </article>
      <article class="tip-card">
        <h3>{{ t("connect.perServerLabel") }}</h3>
        <p>
          <code>{{ servers.gatewayUrl }}/&lt;serverId&gt;</code>
          {{ t("connect.perServerDesc") }}
        </p>
      </article>
      <article class="tip-card">
        <h3>{{ t("connect.authLabel") }}</h3>
        <p v-if="auth.required">
          {{
            t("connect.authEnabledDesc", {
              bearer: "Bearer mch_…",
              session: "mcs_…",
            })
          }}
        </p>
        <p v-else>
          {{ t("connect.authDisabledDesc", { flag: "AUTH_DISABLED" }) }}
        </p>
      </article>
    </section>

    <section class="clients">
      <div class="section-head">
        <h2>{{ t("connect.clientsTitle") }}</h2>
        <NText depth="3">{{ t("connect.clientsSub") }}</NText>
      </div>

      <NCollapse v-model:expanded-names="openPlatforms" class="client-list">
        <NCollapseItem
          v-for="p in platforms"
          :key="p.id"
          :name="p.id"
        >
          <template #header>
            <div class="client-head">
              <span class="client-mark">{{ platformMonogram(p.name) }}</span>
              <div class="client-titles">
                <span class="client-name">{{ p.name }}</span>
                <span class="client-blurb">{{ p.blurb }}</span>
              </div>
            </div>
          </template>

          <div class="client-body">
            <ol class="client-steps">
              <li v-for="(step, i) in p.steps" :key="i">{{ step }}</li>
            </ol>

            <div v-for="(snip, i) in p.snippets" :key="i" class="snip">
              <div class="snip-top">
                <span class="field-label">{{ snip.label }}</span>
                <NButton size="tiny" quaternary @click="copy(snip.code)">
                  <template #icon>
                    <NIcon :component="CopyOutline" />
                  </template>
                  {{ t("common.copy") }}
                </NButton>
              </div>
              <pre class="cmd-block"><code>{{ snip.code }}</code></pre>
            </div>

            <a
              v-if="p.docs"
              class="docs-link"
              :href="p.docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{{ t("connect.docs") }} {{ p.docs }}</span>
              <NIcon :component="OpenOutline" :size="16" />
            </a>
          </div>
        </NCollapseItem>
      </NCollapse>
    </section>
  </div>
</template>

<style scoped>
.connect-page {
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
}

.setup-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.15rem 1.2rem 1.2rem;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--app-chip-active-text) 35%, var(--app-border));
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 12%, transparent),
      transparent 55%
    ),
    var(--app-surface);
}

.setup-hero {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}
.setup-mark {
  width: 2.7rem;
  height: 2.7rem;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, #0d8660 0%, #0b6e4f 55%, #095a41 100%);
  box-shadow: 0 8px 18px color-mix(in srgb, #0b6e4f 26%, transparent);
}
:global(html[data-theme="dark"]) .setup-mark {
  color: #0f161c;
  background: linear-gradient(145deg, #56d9a8 0%, #3ecf9a 55%, #2bb884 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, #3ecf9a 20%, transparent);
}
.setup-kicker {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.setup-title {
  margin: 0.1rem 0 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}

.picker-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.9rem;
}
@media (min-width: 720px) {
  .picker-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.field-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.field-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--app-text-muted);
}
.field-hint a {
  color: var(--app-chip-active-text);
  text-decoration: none;
  font-weight: 600;
}
.field-hint a:hover {
  text-decoration: underline;
}

.url-card {
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.url-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.url-card-top > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.mode-chip {
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 650;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
}
.mode-uni {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.url-value {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82rem;
  word-break: break-all;
  color: var(--app-text);
}

.reach-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.reach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.reach-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
  background: var(--app-chip-active-bg);
  border: 1px solid var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.test-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 0.85rem;
}
.test-hint {
  margin: 0 !important;
}
.test-result {
  padding: 0.75rem 0.9rem;
  border-radius: 11px;
  font-size: 0.88rem;
  line-height: 1.45;
  border: 1px solid var(--app-border);
}
.test-result.ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.test-result.err {
  background: color-mix(in srgb, #c23b3b 12%, transparent);
  border-color: color-mix(in srgb, #c23b3b 32%, transparent);
  color: #c23b3b;
}
:global(html[data-theme="dark"]) .test-result.err {
  color: #f07178;
  background: color-mix(in srgb, #f07178 12%, transparent);
  border-color: color-mix(in srgb, #f07178 30%, transparent);
}

.tips-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}
.tip-card {
  padding: 0.9rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.tip-card h3 {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.tip-card p {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.45;
  color: var(--app-text-soft);
}
.tip-card code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  word-break: break-all;
  color: var(--app-text);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.45rem 0.75rem;
  margin-bottom: 0.75rem;
}
.section-head h2 {
  margin: 0;
  font-size: 1.1rem;
  letter-spacing: -0.02em;
  color: var(--app-text);
}

.client-list :deep(.n-collapse-item) {
  margin-bottom: 0.65rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  overflow: hidden;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.client-list :deep(.n-collapse-item:hover) {
  border-color: color-mix(in srgb, var(--app-chip-active-text) 40%, var(--app-border));
}
.client-list :deep(.n-collapse-item__header) {
  padding: 0.85rem 1rem !important;
}
.client-list :deep(.n-collapse-item__content-inner) {
  padding: 0 1rem 1rem !important;
}
.client-list :deep(.n-collapse-item__header-main) {
  flex: 1;
  min-width: 0;
}

.client-head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  min-width: 0;
  width: 100%;
  padding-right: 0.35rem;
}
.client-mark {
  flex: 0 0 auto;
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  color: #fff;
  background: linear-gradient(145deg, #0d8660 0%, #0b6e4f 55%, #095a41 100%);
}
:global(html[data-theme="dark"]) .client-mark {
  color: #0f161c;
  background: linear-gradient(145deg, #56d9a8 0%, #3ecf9a 55%, #2bb884 100%);
}
.client-titles {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.client-name {
  font-weight: 700;
  font-size: 0.98rem;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.client-blurb {
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--app-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.client-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-top: 0.15rem;
  border-top: 1px solid var(--app-border);
  margin-top: 0.15rem;
  padding-top: 0.85rem;
}
.client-steps {
  margin: 0;
  padding-left: 1.15rem;
  color: var(--app-text-soft);
  font-size: 0.9rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.snip {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.snip-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.cmd-block {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: #14212b;
  color: #e8f5ef;
  overflow-x: auto;
}
:global(html[data-theme="dark"]) .cmd-block {
  background: #121920;
  color: #d7e6df;
}
.cmd-block code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.docs-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--app-chip-active-text);
  text-decoration: none;
  word-break: break-all;
}
.docs-link:hover {
  text-decoration: underline;
}
</style>

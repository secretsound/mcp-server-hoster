<script setup lang="ts">
import { computed, h, ref } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from "naive-ui";
import { CopyOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { rawFetch } from "../api/client";
import { ENDPOINTS, type ApiEndpointExample } from "../data/templates";
import { copyText } from "../utils/serverForm";

const message = useMessage();

const apiBaseUrl = computed(() => `${window.location.origin}/api`);

const selectedKey = ref("GET /health");
const method = ref("GET");
const path = ref("/health");
const body = ref("");
const exampleResponse = ref(
  pretty(ENDPOINTS.find((e) => e.path === "/health")?.sampleResponse) ||
    "(select an endpoint)",
);
const labError = ref("");
const labStatus = ref("");
const labOut = ref("(send a request to replace this with a live response)");
const sending = ref(false);
const showingExample = ref(true);

const methodOptions = ["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => ({
  label: m,
  value: m,
}));

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function endpointKey(ep: ApiEndpointExample): string {
  return `${ep.method} ${ep.path}`;
}

function selectEndpoint(ep: ApiEndpointExample) {
  selectedKey.value = endpointKey(ep);
  method.value = ep.method;
  path.value = ep.samplePath || ep.path;
  if (ep.method === "GET" || ep.method === "DELETE") {
    body.value = "";
  } else {
    body.value = pretty(ep.sampleBody ?? {});
  }
  exampleResponse.value = pretty(ep.sampleResponse) || "(no example)";
  labOut.value = exampleResponse.value;
  labStatus.value = "— example";
  labError.value = "";
  showingExample.value = true;
}

const columns: DataTableColumns<ApiEndpointExample> = [
  {
    title: "Method",
    key: "method",
    width: 88,
    render: (row) =>
      h(
        NTag,
        {
          size: "small",
          bordered: false,
          type: row.method === "GET"
            ? "info"
            : row.method === "DELETE"
            ? "error"
            : row.method === "POST"
            ? "success"
            : "warning",
        },
        { default: () => row.method },
      ),
  },
  {
    title: "Path",
    key: "path",
    render: (row) => h("code", { class: "ep-path" }, row.path),
  },
  {
    title: "Description",
    key: "desc",
    ellipsis: { tooltip: true },
  },
];

const rowProps = (row: ApiEndpointExample) => ({
  style: "cursor: pointer",
  class: endpointKey(row) === selectedKey.value ? "ep-row selected" : "ep-row",
  onClick: () => selectEndpoint(row),
});

async function copyApiUrl() {
  if (await copyText(apiBaseUrl.value)) message.success("API URL copied");
  else message.error("Could not copy");
}

async function runLab(m: string, p: string, bodyText: string) {
  labError.value = "";
  labStatus.value = "";
  labOut.value = "…";
  sending.value = true;
  showingExample.value = false;
  try {
    const opts: RequestInit = { method: m, headers: {} as Record<string, string> };
    const headers = opts.headers as Record<string, string>;
    if (m !== "GET" && m !== "DELETE") {
      headers["content-type"] = "application/json";
      opts.body = bodyText || "{}";
    }
    if (p === "/mcp" || p.startsWith("/mcp")) {
      headers.accept = "application/json, text/event-stream";
    }
    const res = await rawFetch(p, opts);
    labStatus.value = `— ${res.status} ${res.statusText}`;
    try {
      labOut.value = JSON.stringify(JSON.parse(res.body), null, 2);
    } catch {
      labOut.value = res.body || "(empty)";
    }
  } catch (err) {
    labError.value = err instanceof Error ? err.message : String(err);
    labOut.value = "";
  } finally {
    sending.value = false;
  }
}

function onSubmit() {
  void runLab(method.value, path.value, body.value);
}

function showExampleAgain() {
  const ep = ENDPOINTS.find((e) => endpointKey(e) === selectedKey.value);
  if (!ep) return;
  labOut.value = pretty(ep.sampleResponse) || "(no example)";
  labStatus.value = "— example";
  labError.value = "";
  showingExample.value = true;
}

// Seed first endpoint selection
selectEndpoint(ENDPOINTS[0]!);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>API</h1>
        <p class="page-sub">
          Admin REST under <code>/api</code> · MCP gateway at <code>/mcp</code>
        </p>
      </div>
      <div class="api-pill">
        <NTooltip>
          <template #trigger>
            <code class="url">{{ apiBaseUrl }}</code>
          </template>
          Admin REST API base
        </NTooltip>
        <NButton size="tiny" quaternary @click="copyApiUrl">
          <template #icon>
            <NIcon :component="CopyOutline" />
          </template>
          Copy
        </NButton>
      </div>
    </div>

    <div class="split-2">
      <NCard size="small" title="Endpoints">
        <NText depth="3" class="hint">
          Click a row to load an example request and response in the lab.
        </NText>
        <NDataTable
          class="ep-table"
          :columns="columns"
          :data="ENDPOINTS"
          :bordered="false"
          size="small"
          :pagination="false"
          :row-props="rowProps"
        />
      </NCard>

      <NCard size="small" title="Request lab">
        <NText depth="3" style="display: block; margin-bottom: 0.75rem">
          Prefills from the selected endpoint. Send runs a live request with
          your session.
        </NText>
        <NForm label-placement="top">
          <div class="grid-2">
            <NFormItem label="Method">
              <NSelect v-model:value="method" :options="methodOptions" />
            </NFormItem>
            <NFormItem label="Path">
              <NInput v-model:value="path" />
            </NFormItem>
          </div>
          <NFormItem
            v-if="method !== 'GET' && method !== 'DELETE'"
            label="Body"
          >
            <NInput
              v-model:value="body"
              type="textarea"
              :autosize="{ minRows: 8, maxRows: 16 }"
            />
          </NFormItem>
          <NFormItem v-else label="Body">
            <NText depth="3">No body for {{ method }}</NText>
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="sending" @click="onSubmit">
              Send
            </NButton>
            <NButton
              v-if="!showingExample"
              :disabled="sending"
              @click="showExampleAgain"
            >
              Show example
            </NButton>
          </NSpace>
        </NForm>
        <NText v-if="labError" type="error" style="display: block; margin-top: 0.55rem">
          {{ labError }}
        </NText>
        <div style="margin-top: 0.85rem">
          <NText depth="3">
            {{ showingExample ? "Example response" : "Live response" }}
            {{ labStatus }}
          </NText>
          <pre class="code">{{ labOut }}</pre>
        </div>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.api-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: min(420px, 100%);
  padding: 0.2rem 0.35rem 0.2rem 0.65rem;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: var(--app-surface);
}
.url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
}
.hint {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
.grid-2 {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0 0.75rem;
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
  max-height: 360px;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--app-border);
}
.ep-table :deep(.ep-row:hover td) {
  background: color-mix(in srgb, var(--app-chip-active-text) 8%, transparent) !important;
}
.ep-table :deep(.ep-row.selected td) {
  background: color-mix(
    in srgb,
    var(--app-chip-active-text) 14%,
    transparent
  ) !important;
}
.ep-path {
  font-size: 0.8rem;
}
@media (max-width: 640px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
html[data-theme="light"] .code {
  background: #f4f7fa;
  color: #1a2730;
}
</style>

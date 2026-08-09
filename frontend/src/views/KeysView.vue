<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NModal,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NThing,
  useDialog,
  useMessage,
} from "naive-ui";
import GrantsCeilingHint from "../components/GrantsCeilingHint.vue";
import ScopeEditor from "../components/ScopeEditor.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type { ApiKey, ScopeGrant } from "../types";
import { copyText } from "../utils/serverForm";

const auth = useAuthStore();
const servers = useServersStore();
const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const loading = ref(true);
const myKeys = ref<ApiKey[]>([]);
const tenantKeys = ref<ApiKey[]>([]);
const tab = ref<"mine" | "tenant">("mine");
/** Default: hide revoked keys so the list stays actionable. */
const statusFilter = ref<"active" | "revoked" | "all">("active");

const createOpen = ref(false);
const createMode = ref<"user" | "tenant">("user");
const creating = ref(false);
const revealedSecret = ref<string | null>(null);
const revealedKeyId = ref<string | null>(null);

const form = reactive({
  name: "",
  scopes: [] as ScopeGrant[],
});

const serverOptions = computed(() =>
  servers.servers.map((s) => ({ id: s.id, name: s.name })),
);

const ceiling = computed(() => auth.user?.grants ?? []);

const activeMyKeys = computed(
  () => myKeys.value.filter((k) => !k.revokedAt).length,
);
const activeTenantKeys = computed(
  () => tenantKeys.value.filter((k) => !k.revokedAt).length,
);
const revokedMyKeys = computed(
  () => myKeys.value.filter((k) => !!k.revokedAt).length,
);
const revokedTenantKeys = computed(
  () => tenantKeys.value.filter((k) => !!k.revokedAt).length,
);

function matchesStatus(key: ApiKey): boolean {
  if (statusFilter.value === "all") return true;
  if (statusFilter.value === "revoked") return !!key.revokedAt;
  return !key.revokedAt;
}

const visibleMyKeys = computed(() => myKeys.value.filter(matchesStatus));
const visibleTenantKeys = computed(() =>
  tenantKeys.value.filter(matchesStatus)
);

function tabCount(kind: "mine" | "tenant"): string {
  const active = kind === "mine" ? activeMyKeys.value : activeTenantKeys.value;
  const revoked = kind === "mine"
    ? revokedMyKeys.value
    : revokedTenantKeys.value;
  const total = active + revoked;
  if (statusFilter.value === "active") return String(active);
  if (statusFilter.value === "revoked") return String(revoked);
  return revoked ? `${active}/${total}` : String(total);
}

async function refresh() {
  loading.value = true;
  try {
    myKeys.value = await auth.listMyKeys();
    if (auth.can("keys:tenant")) {
      tenantKeys.value = await auth.listTenantKeys();
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await servers.refresh().catch(() => {});
  await refresh();
});

function openCreate(mode: "user" | "tenant") {
  createMode.value = mode;
  form.name = "";
  form.scopes =
    mode === "tenant"
      ? [{ serverId: "*", tools: ["*"] }]
      : ceiling.value.length
      ? ceiling.value.map((g) => ({ ...g, tools: [...g.tools] }))
      : [];
  revealedSecret.value = null;
  revealedKeyId.value = null;
  createOpen.value = true;
  tab.value = mode === "tenant" ? "tenant" : "mine";
}

async function submitCreate() {
  if (!form.name.trim()) {
    message.warning("Name is required");
    return;
  }
  if (!form.scopes.length) {
    message.warning("Add at least one scope");
    return;
  }
  creating.value = true;
  try {
    const result =
      createMode.value === "tenant"
        ? await auth.createTenantKey({
          name: form.name.trim(),
          scopes: form.scopes,
        })
        : await auth.createMyKey({
          name: form.name.trim(),
          scopes: form.scopes,
        });
    revealedSecret.value = result.secret;
    revealedKeyId.value = result.key.id;
    message.success("API key created");
    await refresh();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    creating.value = false;
  }
}

function revoke(key: ApiKey, kind: "user" | "tenant") {
  dialog.warning({
    title: "Revoke API key?",
    content: `Revoke “${key.name}” (${key.keyPrefix}…)? Clients using it will lose access.`,
    positiveText: "Revoke",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        if (kind === "tenant") await auth.revokeTenantKey(key.id);
        else await auth.revokeMyKey(key.id);
        message.success("Revoked");
        await refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

async function copySecret() {
  if (!revealedSecret.value) return;
  if (await copyText(revealedSecret.value)) message.success("Copied");
}

async function copyPrefix(key: ApiKey) {
  if (await copyText(key.keyPrefix)) message.success("Prefix copied");
}

function scopesLabel(scopes: ScopeGrant[]): string {
  if (!scopes.length) return "No scopes";
  if (scopes.some((g) => g.serverId === "*" && g.tools.includes("*"))) {
    return "Full access";
  }
  return scopes
    .map((g) =>
      `${g.serverId}:${g.tools.includes("*") ? "*" : g.tools.join("|")}`,
    )
    .join(", ");
}

function scopeTags(scopes: ScopeGrant[]): string[] {
  if (!scopes.length) return [];
  if (scopes.some((g) => g.serverId === "*" && g.tools.includes("*"))) {
    return ["full access"];
  }
  return scopes.map((g) =>
    `${g.serverId}:${g.tools.includes("*") ? "*" : g.tools.length + " tools"}`,
  );
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function goConnect(key: ApiKey) {
  router.push({ path: "/connect", query: { key: key.id } });
}

function onCreateClick() {
  if (tab.value === "tenant" && auth.can("keys:tenant")) {
    openCreate("tenant");
  } else {
    openCreate("user");
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>API keys</h1>
        <p class="page-sub">
          Keys authenticate MCP clients. Scope them down for each task.
        </p>
      </div>
      <NSpace>
        <NButton type="primary" @click="onCreateClick">
          {{ tab === "tenant" ? "Create tenant key" : "Create key" }}
        </NButton>
        <NButton
          v-if="auth.can('keys:tenant') && tab === 'mine'"
          @click="openCreate('tenant')"
        >
          Create tenant key
        </NButton>
      </NSpace>
    </div>

    <NAlert type="info" :bordered="false" style="margin-bottom: 1rem">
      Use
      <code>Authorization: Bearer mch_…</code>
      against
      <code>{{ servers.gatewayUrl }}</code>.
      Personal keys cannot exceed your grant ceiling
      <template v-if="auth.can('keys:tenant')">
        ; tenant keys can cover the whole host.
      </template>
      .
    </NAlert>

    <GrantsCeilingHint
      :grants="ceiling"
      :unrestricted="auth.can('mcp:full')"
      label="Your grant ceiling"
      style="margin-bottom: 1rem"
    />

    <div class="filters">
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'active' }"
        @click="statusFilter = 'active'"
      >
        Active
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'revoked' }"
        @click="statusFilter = 'revoked'"
      >
        Revoked
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'all' }"
        @click="statusFilter = 'all'"
      >
        All
      </button>
    </div>

    <NTabs v-model:value="tab" type="line" animated>
      <NTabPane name="mine" :tab="`My keys (${tabCount('mine')})`">
        <NEmpty
          v-if="!loading && !myKeys.length"
          description="No personal keys yet"
          style="margin-top: 1.5rem"
        >
          <template #extra>
            <NButton type="primary" @click="openCreate('user')">
              Create key
            </NButton>
          </template>
        </NEmpty>
        <NEmpty
          v-else-if="!loading && !visibleMyKeys.length"
          :description="
            statusFilter === 'revoked'
              ? 'No revoked personal keys'
              : 'No active personal keys'
          "
          style="margin-top: 1.5rem"
        >
          <template v-if="statusFilter !== 'all'" #extra>
            <NButton @click="statusFilter = 'all'">Show all</NButton>
          </template>
        </NEmpty>
        <div v-else class="cards">
          <NCard
            v-for="key in visibleMyKeys"
            :key="key.id"
            size="small"
            hoverable
            class="key-card"
            :class="{ revoked: !!key.revokedAt }"
          >
            <NThing>
              <template #header>
                <span class="title">{{ key.name }}</span>
              </template>
              <template #header-extra>
                <NTag
                  v-if="key.revokedAt"
                  size="small"
                  type="error"
                  :bordered="false"
                >
                  Revoked
                </NTag>
                <NTag v-else size="small" type="success" :bordered="false">
                  Active
                </NTag>
              </template>
              <template #description>
                <code class="prefix">{{ key.keyPrefix }}…</code>
              </template>

              <div class="card-body">
                <NSpace :size="6" class="meta">
                  <NTag
                    v-for="label in scopeTags(key.scopes)"
                    :key="label"
                    size="tiny"
                    :bordered="false"
                  >
                    {{ label }}
                  </NTag>
                </NSpace>
                <NText depth="3" class="scopes-line">
                  {{ scopesLabel(key.scopes) }}
                </NText>
                <div class="dates">
                  <NText depth="3">
                    Created {{ formatWhen(key.createdAt) }}
                  </NText>
                  <NText v-if="key.lastUsedAt" depth="3" class="detail-sep">
                    · Last used {{ formatWhen(key.lastUsedAt) }}
                  </NText>
                  <NText v-else depth="3" class="detail-sep">
                    · Never used
                  </NText>
                  <NText
                    v-if="key.expiresAt"
                    depth="3"
                    class="detail-sep"
                  >
                    · Expires {{ formatWhen(key.expiresAt) }}
                  </NText>
                </div>
              </div>

              <template #action>
                <NSpace class="card-actions">
                  <NButton
                    size="small"
                    :disabled="!!key.revokedAt"
                    @click="goConnect(key)"
                  >
                    Connect
                  </NButton>
                  <NButton size="small" quaternary @click="copyPrefix(key)">
                    Copy prefix
                  </NButton>
                  <NButton
                    size="small"
                    type="error"
                    secondary
                    :disabled="!!key.revokedAt"
                    @click="revoke(key, 'user')"
                  >
                    Revoke
                  </NButton>
                </NSpace>
              </template>
            </NThing>
          </NCard>
        </div>
      </NTabPane>

      <NTabPane
        v-if="auth.can('keys:tenant')"
        name="tenant"
        :tab="`Tenant keys (${tabCount('tenant')})`"
      >
        <NEmpty
          v-if="!loading && !tenantKeys.length"
          description="No tenant keys yet"
          style="margin-top: 1.5rem"
        >
          <template #extra>
            <NButton type="primary" @click="openCreate('tenant')">
              Create tenant key
            </NButton>
          </template>
        </NEmpty>
        <NEmpty
          v-else-if="!loading && !visibleTenantKeys.length"
          :description="
            statusFilter === 'revoked'
              ? 'No revoked tenant keys'
              : 'No active tenant keys'
          "
          style="margin-top: 1.5rem"
        >
          <template v-if="statusFilter !== 'all'" #extra>
            <NButton @click="statusFilter = 'all'">Show all</NButton>
          </template>
        </NEmpty>
        <div v-else class="cards">
          <NCard
            v-for="key in visibleTenantKeys"
            :key="key.id"
            size="small"
            hoverable
            class="key-card"
            :class="{ revoked: !!key.revokedAt }"
          >
            <NThing>
              <template #header>
                <span class="title">{{ key.name }}</span>
              </template>
              <template #header-extra>
                <NSpace :size="6">
                  <NTag size="small" type="warning" :bordered="false">
                    Tenant
                  </NTag>
                  <NTag
                    v-if="key.revokedAt"
                    size="small"
                    type="error"
                    :bordered="false"
                  >
                    Revoked
                  </NTag>
                  <NTag v-else size="small" type="success" :bordered="false">
                    Active
                  </NTag>
                </NSpace>
              </template>
              <template #description>
                <code class="prefix">{{ key.keyPrefix }}…</code>
              </template>

              <div class="card-body">
                <NSpace :size="6" class="meta">
                  <NTag
                    v-for="label in scopeTags(key.scopes)"
                    :key="label"
                    size="tiny"
                    :bordered="false"
                  >
                    {{ label }}
                  </NTag>
                </NSpace>
                <NText depth="3" class="scopes-line">
                  {{ scopesLabel(key.scopes) }}
                </NText>
                <div class="dates">
                  <NText depth="3">
                    Created {{ formatWhen(key.createdAt) }}
                  </NText>
                  <NText v-if="key.lastUsedAt" depth="3" class="detail-sep">
                    · Last used {{ formatWhen(key.lastUsedAt) }}
                  </NText>
                  <NText v-else depth="3" class="detail-sep">
                    · Never used
                  </NText>
                  <NText
                    v-if="key.expiresAt"
                    depth="3"
                    class="detail-sep"
                  >
                    · Expires {{ formatWhen(key.expiresAt) }}
                  </NText>
                </div>
              </div>

              <template #action>
                <NSpace class="card-actions">
                  <NButton
                    size="small"
                    :disabled="!!key.revokedAt"
                    @click="goConnect(key)"
                  >
                    Connect
                  </NButton>
                  <NButton size="small" quaternary @click="copyPrefix(key)">
                    Copy prefix
                  </NButton>
                  <NButton
                    size="small"
                    type="error"
                    secondary
                    :disabled="!!key.revokedAt"
                    @click="revoke(key, 'tenant')"
                  >
                    Revoke
                  </NButton>
                </NSpace>
              </template>
            </NThing>
          </NCard>
        </div>
      </NTabPane>
    </NTabs>

    <NModal
      v-model:show="createOpen"
      preset="card"
      :title="createMode === 'tenant' ? 'Create tenant API key' : 'Create API key'"
      style="width: min(560px, 96vw)"
      :mask-closable="!revealedSecret"
    >
      <div v-if="revealedSecret" class="reveal">
        <NAlert type="warning" :bordered="false">
          Copy this secret now — it will not be shown again.
        </NAlert>
        <NInput
          class="secret"
          type="textarea"
          :value="revealedSecret"
          readonly
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <NSpace justify="end">
          <NButton @click="copySecret">Copy</NButton>
          <NButton
            v-if="revealedKeyId"
            @click="
              createOpen = false;
              router.push({
                path: '/connect',
                query: { key: revealedKeyId },
              });
            "
          >
            Use in Connect
          </NButton>
          <NButton type="primary" @click="createOpen = false">Done</NButton>
        </NSpace>
      </div>
      <div v-else>
        <label class="field">
          <span>Name</span>
          <NInput v-model:value="form.name" placeholder="Cursor laptop" />
        </label>
        <div class="field">
          <span>Scopes</span>
          <GrantsCeilingHint
            v-if="createMode === 'user'"
            :grants="ceiling"
            :unrestricted="auth.can('mcp:full')"
            label="You can grant up to"
          />
          <GrantsCeilingHint
            v-else
            :grants="[]"
            unrestricted
            label="Tenant key ceiling"
          />
          <ScopeEditor
            v-model="form.scopes"
            :server-options="serverOptions"
            :ceiling="createMode === 'user' ? ceiling : null"
            :allow-wildcard="createMode === 'tenant' || auth.can('mcp:full')"
          />
        </div>
        <NSpace justify="end" style="margin-top: 1rem">
          <NButton @click="createOpen = false">Cancel</NButton>
          <NButton type="primary" :loading="creating" @click="submitCreate">
            Create
          </NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
}
.chip {
  border: 1px solid var(--app-border);
  background: var(--app-chip-bg);
  color: var(--app-text-soft);
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--app-chip-active-text);
  color: var(--app-text);
}
.chip.active {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.key-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.key-card.revoked {
  opacity: 0.78;
}
.key-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.key-card :deep(.n-thing) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.key-card :deep(.n-thing-main) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.key-card :deep(.n-thing-main__content) {
  flex: 1;
}
.key-card :deep(.n-thing-main__action) {
  margin-top: auto;
  padding-top: 0.85rem;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.15rem;
}
.title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--app-text);
}
.prefix {
  font-size: 0.82rem;
  color: var(--app-text-muted);
}
.meta {
  margin: 0;
}
.scopes-line {
  font-size: 0.85rem;
  word-break: break-word;
  line-height: 1.4;
}
.dates {
  font-size: 0.78rem;
  line-height: 1.35;
}
.detail-sep {
  margin-left: 0.15rem;
}
.card-actions {
  width: 100%;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.9rem;
}
.field > span {
  font-size: 0.88rem;
  opacity: 0.8;
}
.reveal {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.secret {
  font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
</style>

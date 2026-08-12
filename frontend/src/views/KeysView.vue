<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NTabPane,
  NTabs,
  useDialog,
  useMessage,
} from "naive-ui";
import { CopyOutline, KeyOutline } from "@vicons/ionicons5";
import ApiKeyCard from "../components/ApiKeyCard.vue";
import GrantsCeilingHint from "../components/GrantsCeilingHint.vue";
import ScopeEditor from "../components/ScopeEditor.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type { ApiKey, ScopeGrant } from "../types";
import { copyText } from "../utils/serverForm";

const { t } = useI18n();
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
    message.warning(t("keys.nameRequired"));
    return;
  }
  if (!form.scopes.length) {
    message.warning(t("keys.scopeRequired"));
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
    message.success(t("keys.createdToast"));
    await refresh();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    creating.value = false;
  }
}

function revoke(key: ApiKey, kind: "user" | "tenant") {
  dialog.warning({
    title: t("keys.revokeTitle"),
    content: t("keys.revokeContent", { name: key.name, prefix: key.keyPrefix }),
    positiveText: t("keys.revoke"),
    negativeText: t("common.cancel"),
    onPositiveClick: async () => {
      try {
        if (kind === "tenant") await auth.revokeTenantKey(key.id);
        else await auth.revokeMyKey(key.id);
        message.success(t("keys.revokedToast"));
        await refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

async function copySecret() {
  if (!revealedSecret.value) return;
  if (await copyText(revealedSecret.value)) message.success(t("keys.copied"));
}

async function copyPrefix(key: ApiKey) {
  if (await copyText(key.keyPrefix)) message.success(t("keys.prefixCopied"));
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
  <div class="keys-page">
    <div class="page-head">
      <div>
        <h1>{{ t("keys.title") }}</h1>
        <p class="page-sub">{{ t("keys.subtitle") }}</p>
      </div>
      <NSpace>
        <NButton type="primary" @click="onCreateClick">
          {{ tab === "tenant" ? t("keys.createTenantKey") : t("keys.createKey") }}
        </NButton>
        <NButton
          v-if="auth.can('keys:tenant') && tab === 'mine'"
          secondary
          @click="openCreate('tenant')"
        >
          {{ t("keys.createTenantKey") }}
        </NButton>
      </NSpace>
    </div>

    <section class="info-panel">
      <div class="info-hero">
        <div class="info-mark" aria-hidden="true">
          <NIcon :component="KeyOutline" :size="20" />
        </div>
        <div>
          <div class="info-kicker">{{ t("keys.usageKicker") }}</div>
          <p class="info-blurb">
            {{ t("keys.bearerLead") }}
            <code>Authorization: Bearer mch_…</code>
            {{ t("keys.bearerAgainst") }}
            <code>{{ servers.gatewayUrl }}</code>.
            {{ t("keys.bearerCeiling") }}
            <template v-if="auth.can('keys:tenant')">
              {{ t("keys.tenantSuffix") }}
            </template>.
          </p>
        </div>
      </div>
      <GrantsCeilingHint
        :grants="ceiling"
        :unrestricted="auth.can('mcp:full')"
        :label="t('keys.grantCeiling')"
        class="ceiling-slot"
      />
    </section>

    <div class="filters">
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'active' }"
        @click="statusFilter = 'active'"
      >
        {{ t("keys.filterActive") }}
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'revoked' }"
        @click="statusFilter = 'revoked'"
      >
        {{ t("keys.filterRevoked") }}
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'all' }"
        @click="statusFilter = 'all'"
      >
        {{ t("keys.filterAll") }}
      </button>
    </div>

    <NTabs v-model:value="tab" type="line" animated class="keys-tabs">
      <NTabPane name="mine" :tab="t('keys.myKeys', { count: tabCount('mine') })">
        <NEmpty
          v-if="!loading && !myKeys.length"
          :description="t('keys.noPersonalKeys')"
          style="margin-top: 1.5rem"
        >
          <template #extra>
            <NButton type="primary" @click="openCreate('user')">
              {{ t("keys.createKey") }}
            </NButton>
          </template>
        </NEmpty>
        <NEmpty
          v-else-if="!loading && !visibleMyKeys.length"
          :description="
            statusFilter === 'revoked'
              ? t('keys.noRevokedPersonal')
              : t('keys.noActivePersonal')
          "
          style="margin-top: 1.5rem"
        >
          <template v-if="statusFilter !== 'all'" #extra>
            <NButton @click="statusFilter = 'all'">{{ t("keys.showAll") }}</NButton>
          </template>
        </NEmpty>
        <div v-else class="cards">
          <ApiKeyCard
            v-for="key in visibleMyKeys"
            :key="key.id"
            :api-key="key"
            @connect="goConnect(key)"
            @copy-prefix="copyPrefix(key)"
            @revoke="revoke(key, 'user')"
          />
        </div>
      </NTabPane>

      <NTabPane
        v-if="auth.can('keys:tenant')"
        name="tenant"
        :tab="t('keys.tenantKeys', { count: tabCount('tenant') })"
      >
        <NEmpty
          v-if="!loading && !tenantKeys.length"
          :description="t('keys.noTenantKeys')"
          style="margin-top: 1.5rem"
        >
          <template #extra>
            <NButton type="primary" @click="openCreate('tenant')">
              {{ t("keys.createTenantKey") }}
            </NButton>
          </template>
        </NEmpty>
        <NEmpty
          v-else-if="!loading && !visibleTenantKeys.length"
          :description="
            statusFilter === 'revoked'
              ? t('keys.noRevokedTenant')
              : t('keys.noActiveTenant')
          "
          style="margin-top: 1.5rem"
        >
          <template v-if="statusFilter !== 'all'" #extra>
            <NButton @click="statusFilter = 'all'">{{ t("keys.showAll") }}</NButton>
          </template>
        </NEmpty>
        <div v-else class="cards">
          <ApiKeyCard
            v-for="key in visibleTenantKeys"
            :key="key.id"
            :api-key="key"
            tenant
            @connect="goConnect(key)"
            @copy-prefix="copyPrefix(key)"
            @revoke="revoke(key, 'tenant')"
          />
        </div>
      </NTabPane>
    </NTabs>

    <NModal
      v-model:show="createOpen"
      preset="card"
      class="key-create-modal"
      :title="createMode === 'tenant' ? t('keys.createTenantApiKey') : t('keys.createApiKey')"
      style="width: min(560px, 96vw)"
      :bordered="false"
      :mask-closable="!revealedSecret"
    >
      <div v-if="revealedSecret" class="reveal">
        <div class="banner banner-warn">
          {{ t("keys.secretWarning") }}
        </div>
        <pre class="secret-block"><code>{{ revealedSecret }}</code></pre>
        <NSpace justify="end">
          <NButton @click="copySecret">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
          <NButton
            v-if="revealedKeyId"
            secondary
            @click="
              createOpen = false;
              router.push({
                path: '/connect',
                query: { key: revealedKeyId },
              });
            "
          >
            {{ t("keys.useInConnect") }}
          </NButton>
          <NButton type="primary" @click="createOpen = false">{{ t("keys.done") }}</NButton>
        </NSpace>
      </div>
      <div v-else class="create-form">
        <label class="field">
          <span class="field-label">{{ t("keys.name") }}</span>
          <NInput v-model:value="form.name" :placeholder="t('keys.namePlaceholder')" />
        </label>
        <div class="field">
          <span class="field-label">{{ t("keys.scopes") }}</span>
          <GrantsCeilingHint
            v-if="createMode === 'user'"
            :grants="ceiling"
            :unrestricted="auth.can('mcp:full')"
            :label="t('keys.grantUpTo')"
          />
          <GrantsCeilingHint
            v-else
            :grants="[]"
            unrestricted
            :label="t('keys.tenantCeiling')"
          />
          <ScopeEditor
            v-model="form.scopes"
            :server-options="serverOptions"
            :ceiling="createMode === 'user' ? ceiling : null"
            :allow-wildcard="createMode === 'tenant' || auth.can('mcp:full')"
          />
        </div>
        <NSpace justify="end" style="margin-top: 1rem">
          <NButton @click="createOpen = false">{{ t("common.cancel") }}</NButton>
          <NButton type="primary" :loading="creating" @click="submitCreate">
            {{ t("common.create") }}
          </NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.keys-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.1rem 1.15rem;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--app-chip-active-text) 32%, var(--app-border));
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-chip-active-text) 12%, transparent),
      transparent 55%
    ),
    var(--app-surface);
}
.info-hero {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
}
.info-mark {
  flex: 0 0 auto;
  width: 2.7rem;
  height: 2.7rem;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, #0d8660 0%, #0b6e4f 55%, #095a41 100%);
  box-shadow: 0 8px 18px color-mix(in srgb, #0b6e4f 26%, transparent);
}
:global(html[data-theme="dark"]) .info-mark {
  color: #0f161c;
  background: linear-gradient(145deg, #56d9a8 0%, #3ecf9a 55%, #2bb884 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, #3ecf9a 20%, transparent);
}
.info-kicker {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 0.25rem;
}
.info-blurb {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--app-text-soft);
}
.info-blurb code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82em;
  word-break: break-all;
  color: var(--app-text);
}
.ceiling-slot {
  margin-bottom: 0 !important;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
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

.keys-tabs :deep(.n-tabs-nav) {
  margin-bottom: 0.85rem;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
  align-items: stretch;
}

.reveal {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.banner {
  padding: 0.75rem 0.9rem;
  border-radius: 11px;
  font-size: 0.88rem;
  line-height: 1.45;
  border: 1px solid var(--app-border);
}
.banner-warn {
  background: color-mix(in srgb, #b8860b 12%, transparent);
  border-color: color-mix(in srgb, #b8860b 30%, transparent);
  color: var(--app-text-soft);
}
:global(html[data-theme="dark"]) .banner-warn {
  background: color-mix(in srgb, #e0b44a 12%, transparent);
  border-color: color-mix(in srgb, #e0b44a 28%, transparent);
}
.secret-block {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: #14212b;
  color: #e8f5ef;
  overflow-x: auto;
}
:global(html[data-theme="dark"]) .secret-block {
  background: #121920;
  color: #d7e6df;
}
.secret-block code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82rem;
  word-break: break-all;
  white-space: pre-wrap;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
</style>

<style>
.key-create-modal.n-card {
  border-radius: 16px !important;
  overflow: hidden;
}
.key-create-modal .n-card-header {
  padding: 1.1rem 1.25rem 0.75rem !important;
}
.key-create-modal .n-card__content {
  padding: 0.35rem 1.25rem 1.15rem !important;
}
</style>

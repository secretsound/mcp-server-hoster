<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
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
import type { AuthUser, RoleRecord, ScopeGrant, UserRole } from "../types";
import { scopesSummary } from "../utils/scopes";

const { t } = useI18n();
const auth = useAuthStore();
const servers = useServersStore();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();

const loading = ref(true);
const users = ref<AuthUser[]>([]);
const roles = ref<RoleRecord[]>([]);
const modalOpen = ref(false);
const editing = ref<AuthUser | null>(null);
const saving = ref(false);
/** Default: hide disabled accounts. */
const statusFilter = ref<"active" | "disabled" | "all">("active");

const form = reactive({
  email: "",
  password: "",
  displayName: "",
  role: "user" as UserRole,
  disabled: false,
  grants: [] as ScopeGrant[],
});

const serverOptions = computed(() =>
  servers.servers.map((s) => ({ id: s.id, name: s.name })),
);

const roleOptions = computed(() =>
  roles.value.map((r) => ({ label: `${r.name} (${r.slug})`, value: r.slug })),
);

const selectedRoleHasFullMcp = computed(() => {
  const role = roles.value.find((r) => r.slug === form.role);
  return !!role?.permissions.includes("mcp:full");
});

const activeCount = computed(
  () => users.value.filter((u) => !u.disabled).length,
);
const disabledCount = computed(
  () => users.value.filter((u) => u.disabled).length,
);

const visibleUsers = computed(() => {
  if (statusFilter.value === "all") return users.value;
  if (statusFilter.value === "disabled") {
    return users.value.filter((u) => u.disabled);
  }
  return users.value.filter((u) => !u.disabled);
});

async function refresh() {
  loading.value = true;
  try {
    [users.value, roles.value] = await Promise.all([
      auth.listUsers(),
      auth.listRoles(),
    ]);
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

function openCreate() {
  editing.value = null;
  form.email = "";
  form.password = "";
  form.displayName = "";
  form.role = "user";
  form.disabled = false;
  form.grants = [];
  modalOpen.value = true;
}

function openEdit(user: AuthUser) {
  editing.value = user;
  form.email = user.email;
  form.password = "";
  form.displayName = user.displayName ?? "";
  form.role = user.role;
  form.disabled = user.disabled;
  form.grants = user.grants.map((g) => ({
    serverId: g.serverId,
    tools: [...g.tools],
  }));
  modalOpen.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editing.value) {
      await auth.updateUser(editing.value.id, {
        role: form.role,
        displayName: form.displayName.trim() || null,
        disabled: form.disabled,
        grants: selectedRoleHasFullMcp.value ? undefined : form.grants,
        password: form.password || undefined,
      });
      message.success(t("users.updatedToast"));
    } else {
      if (!form.email.trim() || !form.password) {
        message.warning(t("users.emailPasswordRequired"));
        return;
      }
      await auth.createUser({
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        displayName: form.displayName.trim() || null,
        grants: selectedRoleHasFullMcp.value ? undefined : form.grants,
      });
      message.success(t("users.createdToast"));
    }
    modalOpen.value = false;
    await refresh();
    await auth.hydrate();
    if (auth.needsLogin) {
      message.info(t("users.authNowRequired"));
      await router.push({ name: "login" });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

function remove(user: AuthUser) {
  dialog.warning({
    title: t("users.deleteTitle"),
    content: t("users.deleteContent", { email: user.email }),
    positiveText: t("users.delete"),
    negativeText: t("common.cancel"),
    onPositiveClick: async () => {
      try {
        await auth.deleteUser(user.id);
        message.success(t("users.deletedToast"));
        await refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

function roleName(slug: string): string {
  return roles.value.find((r) => r.slug === slug)?.name || slug;
}

function grantTags(user: AuthUser): string[] {
  if (user.permissions?.includes("mcp:full")) return [t("users.fullAccess")];
  if (!user.grants.length) return [t("users.noGrants")];
  return user.grants.map((g) =>
    `${g.serverId}:${g.tools.includes("*") ? "*" : t("users.toolsCount", { count: g.tools.length })}`,
  );
}

function grantsLabel(user: AuthUser): string {
  if (user.permissions?.includes("mcp:full")) return t("users.fullMcpAccess");
  if (!user.grants.length) return t("users.noToolGrants");
  return `${scopesSummary(user.grants)} — ${
    user.grants
      .map((g) =>
        `${g.serverId}:${g.tools.includes("*") ? "*" : g.tools.join("|")}`,
      )
      .join(" · ")
  }`;
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

function isSelf(user: AuthUser): boolean {
  return user.id === auth.user?.id;
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ t("users.title") }}</h1>
        <p class="page-sub">
          {{ t("users.subtitle") }}
          <template v-if="!loading">
            {{ t("users.counts", { active: activeCount }) }}
            <template v-if="disabledCount">
              {{ t("users.countsDisabled", { disabled: disabledCount }) }}
            </template>
          </template>
        </p>
      </div>
      <NButton type="primary" @click="openCreate">{{ t("users.addUser") }}</NButton>
    </div>

    <div class="filters">
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'active' }"
        @click="statusFilter = 'active'"
      >
        {{ t("users.filterActive") }}
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'disabled' }"
        @click="statusFilter = 'disabled'"
      >
        {{ t("users.filterDisabled") }}
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: statusFilter === 'all' }"
        @click="statusFilter = 'all'"
      >
        {{ t("users.filterAll") }}
      </button>
    </div>

    <NEmpty v-if="!loading && !users.length" :description="t('users.noUsers')" />
    <NEmpty
      v-else-if="!loading && !visibleUsers.length"
      :description="
        statusFilter === 'disabled'
          ? t('users.noDisabledUsers')
          : t('users.noActiveUsers')
      "
      style="margin-top: 1rem"
    >
      <template v-if="statusFilter !== 'all'" #extra>
        <NButton @click="statusFilter = 'all'">{{ t("users.showAll") }}</NButton>
      </template>
    </NEmpty>

    <div v-else class="cards">
      <NCard
        v-for="u in visibleUsers"
        :key="u.id"
        size="small"
        hoverable
        class="user-card"
        :class="{ disabled: u.disabled }"
      >
        <NThing>
          <template #header>
            <span class="title">
              {{ u.displayName || u.email }}
              <NTag
                v-if="isSelf(u)"
                size="tiny"
                :bordered="false"
                style="margin-left: 0.4rem; vertical-align: middle"
              >
                {{ t("users.you") }}
              </NTag>
            </span>
          </template>
          <template #header-extra>
            <NTag
              v-if="u.disabled"
              size="small"
              type="error"
              :bordered="false"
            >
              {{ t("users.disabled") }}
            </NTag>
            <NTag v-else size="small" type="success" :bordered="false">
              {{ t("users.active") }}
            </NTag>
          </template>
          <template #description>
            <span class="sub">{{ u.email }}</span>
          </template>

          <div class="card-body">
            <NSpace :size="6" class="meta">
              <NTag
                size="small"
                :type="
                  u.permissions?.includes('users:write') ? 'success' : 'default'
                "
                :bordered="false"
              >
                {{ roleName(u.role) }}
              </NTag>
              <NTag
                v-for="label in grantTags(u)"
                :key="label"
                size="tiny"
                :bordered="false"
              >
                {{ label }}
              </NTag>
            </NSpace>
            <NText depth="3" class="grants">{{ grantsLabel(u) }}</NText>
            <div class="dates">
              <NText v-if="formatWhen(u.createdAt)" depth="3">
                {{ t("users.created", { when: formatWhen(u.createdAt) }) }}
              </NText>
              <NText
                v-if="formatWhen(u.updatedAt)"
                depth="3"
                class="detail-sep"
              >
                {{ t("users.updated", { when: formatWhen(u.updatedAt) }) }}
              </NText>
            </div>
          </div>

          <template #action>
            <NSpace class="card-actions">
              <NButton size="small" @click="openEdit(u)">{{ t("users.edit") }}</NButton>
              <NButton
                size="small"
                type="error"
                secondary
                :disabled="isSelf(u)"
                @click="remove(u)"
              >
                {{ t("users.delete") }}
              </NButton>
            </NSpace>
          </template>
        </NThing>
      </NCard>
    </div>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="editing ? t('users.editUser') : t('users.addUser')"
      class="user-modal"
      style="width: min(640px, 96vw)"
    >
      <NForm
        label-placement="top"
        require-mark-placement="right-hanging"
        class="user-form"
      >
        <section class="form-section">
          <h3 class="section-title">{{ t("users.account") }}</h3>
          <NFormItem v-if="editing" :label="t('users.email')">
            <NInput :value="form.email" readonly disabled />
          </NFormItem>
          <NFormItem v-else :label="t('users.email')" required>
            <NInput
              v-model:value="form.email"
              :placeholder="t('users.emailPlaceholder')"
              autocomplete="off"
            />
          </NFormItem>

          <div class="grid-2">
            <NFormItem :label="t('users.displayName')">
              <NInput
                v-model:value="form.displayName"
                :placeholder="t('users.optional')"
              />
            </NFormItem>
            <NFormItem :label="t('users.role')" required>
              <NSelect v-model:value="form.role" :options="roleOptions" />
            </NFormItem>
          </div>

          <NFormItem :label="editing ? t('users.newPassword') : t('users.password')" :required="!editing">
            <NInput
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              :placeholder="editing ? t('users.passwordKeep') : t('users.passwordRequired')"
              autocomplete="new-password"
            />
          </NFormItem>

          <div v-if="editing" class="disabled-row">
            <div>
              <div class="disabled-label">{{ t("users.disabledLabel") }}</div>
              <NText depth="3" class="disabled-hint">
                {{ t("users.disabledHint") }}
              </NText>
            </div>
            <NSwitch v-model:value="form.disabled" />
          </div>
        </section>

        <section class="form-section">
          <h3 class="section-title">{{ t("users.access") }}</h3>
          <template v-if="!selectedRoleHasFullMcp">
            <NText depth="3" class="section-hint">
              {{ t("users.grantsHint") }}
            </NText>
            <ScopeEditor
              v-model="form.grants"
              :server-options="serverOptions"
              :allow-wildcard="true"
            />
            <GrantsCeilingHint
              compact
              :grants="form.grants"
              :label="t('users.userWillReach')"
              style="margin-top: 0.75rem"
            />
          </template>
          <NAlert v-else type="info" :bordered="false">
            {{ t("users.fullMcpAlert") }}
          </NAlert>
        </section>
      </NForm>

      <div class="modal-footer">
        <NButton @click="modalOpen = false">{{ t("common.cancel") }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">
          {{ editing ? t("users.saveChanges") : t("users.createUser") }}
        </NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 1rem;
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
.user-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.user-card.disabled {
  opacity: 0.78;
}
.user-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.user-card :deep(.n-thing) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.user-card :deep(.n-thing-main) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.user-card :deep(.n-thing-main__content) {
  flex: 1;
}
.user-card :deep(.n-thing-main__action) {
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
.sub {
  color: var(--app-text-muted);
  font-size: 0.82rem;
  word-break: break-word;
}
.meta {
  margin: 0;
}
.grants {
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
.user-form {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.section-title {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.section-hint {
  display: block;
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  line-height: 1.4;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.75rem;
}
@media (max-width: 560px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
.disabled-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.35rem 0 0.15rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.disabled-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--app-text);
}
.disabled-hint {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.8rem;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--app-border);
}
</style>

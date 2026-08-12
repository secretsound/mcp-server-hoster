<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NButton,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSwitch,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import GrantsCeilingHint from "../components/GrantsCeilingHint.vue";
import ScopeEditor from "../components/ScopeEditor.vue";
import UserCard from "../components/UserCard.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type { AuthUser, RoleRecord, ScopeGrant, UserRole } from "../types";

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

function isSelf(user: AuthUser): boolean {
  return user.id === auth.user?.id;
}

function isAdmin(user: AuthUser): boolean {
  return !!user.permissions?.includes("users:write");
}
</script>

<template>
  <div class="users-page">
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
      <UserCard
        v-for="u in visibleUsers"
        :key="u.id"
        :user="u"
        :role-label="roleName(u.role)"
        :is-self="isSelf(u)"
        :is-admin="isAdmin(u)"
        @edit="openEdit(u)"
        @delete="remove(u)"
      />
    </div>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="editing ? t('users.editUser') : t('users.addUser')"
      class="user-modal"
      style="width: min(640px, 96vw)"
      :bordered="false"
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
            <p class="section-hint">{{ t("users.grantsHint") }}</p>
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
          <div v-else class="banner banner-info">
            {{ t("users.fullMcpAlert") }}
          </div>
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
.users-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
  align-items: stretch;
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
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.section-hint {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--app-text-muted);
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
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
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
.banner {
  padding: 0.75rem 0.9rem;
  border-radius: 11px;
  font-size: 0.88rem;
  line-height: 1.45;
  border: 1px solid var(--app-border);
}
.banner-info {
  background: color-mix(in srgb, #2f6fed 10%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: var(--app-text-soft);
}
:global(html[data-theme="dark"]) .banner-info {
  background: color-mix(in srgb, #6aa1ff 12%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 28%, transparent);
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

<style>
.user-modal.n-card {
  border-radius: 16px !important;
  overflow: hidden;
}
.user-modal .n-card-header {
  padding: 1.1rem 1.25rem 0.75rem !important;
}
.user-modal .n-card__content {
  padding: 0.35rem 1.25rem 1.15rem !important;
}
</style>

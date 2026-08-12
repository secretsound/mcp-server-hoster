<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import ScopeEditor from "../components/ScopeEditor.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import type { InviteRecord, RoleRecord, ScopeGrant } from "../types";
import { copyText } from "../utils/serverForm";

const { t } = useI18n();
const auth = useAuthStore();
const servers = useServersStore();
const message = useMessage();
const dialog = useDialog();

const invites = ref<InviteRecord[]>([]);
const roles = ref<RoleRecord[]>([]);
const loading = ref(true);
const modalOpen = ref(false);
const creating = ref(false);
const revealed = ref<InviteRecord | null>(null);

const form = reactive({
  email: "",
  role: "user",
  expiresInDays: 7,
  grants: [] as ScopeGrant[],
});

const roleOptions = computed(() =>
  roles.value.map((r) => ({ label: `${r.name} (${r.slug})`, value: r.slug })),
);

const serverOptions = computed(() =>
  servers.servers.map((s) => ({ id: s.id, name: s.name })),
);

async function refresh() {
  loading.value = true;
  try {
    [invites.value, roles.value] = await Promise.all([
      auth.listInvites(),
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
  form.email = "";
  form.role = "user";
  form.expiresInDays = 7;
  form.grants = [];
  revealed.value = null;
  modalOpen.value = true;
}

async function create() {
  creating.value = true;
  try {
    const invite = await auth.createInvite({
      email: form.email.trim(),
      role: form.role,
      grants: form.grants,
      expiresInDays: form.expiresInDays,
    });
    revealed.value = invite;
    message.success(t("invites.createdToast"));
    await refresh();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    creating.value = false;
  }
}

function inviteUrl(token: string) {
  return `${window.location.origin}/ui/invite/${encodeURIComponent(token)}`;
}

function inviteEmailBody(token: string): string {
  const url = inviteUrl(token);
  const role = revealed.value?.role || form.role;
  const email = revealed.value?.email || form.email;
  return [
    t("invites.emailSubject"),
    ``,
    t("invites.emailAccept"),
    url,
    ``,
    t("invites.emailAccount", { email }),
    t("invites.emailRole", { role }),
    ``,
    t("invites.emailFooter"),
  ].join("\n");
}

async function copyLink() {
  if (!revealed.value?.token) return;
  if (await copyText(inviteUrl(revealed.value.token))) {
    message.success(t("invites.linkCopied"));
  }
}

async function copyEmail() {
  if (!revealed.value?.token) return;
  if (await copyText(inviteEmailBody(revealed.value.token))) {
    message.success(t("invites.emailCopied"));
  }
}

function revoke(inv: InviteRecord) {
  dialog.warning({
    title: t("invites.revokeTitle"),
    content: t("invites.revokeContent", { email: inv.email }),
    positiveText: t("invites.revoke"),
    negativeText: t("common.cancel"),
    onPositiveClick: async () => {
      try {
        await auth.revokeInvite(inv.id);
        message.success(t("invites.revokedToast"));
        await refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

function statusOf(inv: InviteRecord) {
  if (inv.acceptedAt) return { type: "success" as const, label: t("invites.statusAccepted") };
  if (inv.revokedAt) return { type: "error" as const, label: t("invites.statusRevoked") };
  if (inv.expiresAt < new Date().toISOString()) {
    return { type: "warning" as const, label: t("invites.statusExpired") };
  }
  return { type: "info" as const, label: t("invites.statusPending") };
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ t("invites.title") }}</h1>
        <p class="page-sub">
          {{ t("invites.subtitle") }}
        </p>
      </div>
      <NButton type="primary" @click="openCreate">{{ t("invites.inviteUser") }}</NButton>
    </div>

    <NEmpty v-if="!loading && !invites.length" :description="t('invites.noInvites')" />
    <div v-else class="cards">
      <NCard v-for="inv in invites" :key="inv.id" size="small">
        <div class="top">
          <div>
            <strong>{{ inv.email }}</strong>
            <div class="meta">
              <NTag size="small" :bordered="false">{{ inv.role }}</NTag>
              <NTag
                size="small"
                :type="statusOf(inv).type"
                :bordered="false"
              >
                {{ statusOf(inv).label }}
              </NTag>
            </div>
          </div>
          <NButton
            size="small"
            type="error"
            secondary
            :disabled="!!inv.acceptedAt || !!inv.revokedAt"
            @click="revoke(inv)"
          >
            {{ t("invites.revoke") }}
          </NButton>
        </div>
        <NText depth="3" class="dates">
          {{ t("invites.expires", { when: new Date(inv.expiresAt).toLocaleString() }) }}
        </NText>
      </NCard>
    </div>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="t('invites.inviteUser')"
      style="width: min(560px, 96vw)"
      :mask-closable="!revealed"
    >
      <div v-if="revealed?.token">
        <NAlert type="warning" :bordered="false">
          {{ t("invites.secretWarning") }}
        </NAlert>
        <NText depth="3" class="preview-label">{{ t("invites.inviteLink") }}</NText>
        <NInput
          class="link"
          type="textarea"
          :value="inviteUrl(revealed.token)"
          readonly
          :autosize="{ minRows: 2, maxRows: 4 }"
          style="margin: 0.35rem 0 0.85rem"
        />
        <NText depth="3" class="preview-label">{{ t("invites.emailPreview") }}</NText>
        <pre class="email-preview">{{ inviteEmailBody(revealed.token) }}</pre>
        <NSpace justify="end">
          <NButton @click="copyEmail">{{ t("invites.copyEmailText") }}</NButton>
          <NButton @click="copyLink">{{ t("invites.copyLink") }}</NButton>
          <NButton type="primary" @click="modalOpen = false">{{ t("invites.done") }}</NButton>
        </NSpace>
      </div>
      <div v-else>
        <NFormItem :label="t('invites.email')">
          <NInput v-model:value="form.email" />
        </NFormItem>
        <NFormItem :label="t('invites.role')">
          <NSelect v-model:value="form.role" :options="roleOptions" />
        </NFormItem>
        <NFormItem :label="t('invites.expiresInDays')">
          <NInputNumber v-model:value="form.expiresInDays" :min="1" :max="90" />
        </NFormItem>
        <NFormItem v-if="form.role !== 'admin'" :label="t('invites.toolGrants')">
          <ScopeEditor
            v-model="form.grants"
            :server-options="serverOptions"
            :allow-wildcard="true"
          />
        </NFormItem>
        <NSpace justify="end">
          <NButton @click="modalOpen = false">{{ t("common.cancel") }}</NButton>
          <NButton
            type="primary"
            :loading="creating"
            :disabled="!form.email.includes('@')"
            @click="create"
          >
            {{ t("invites.createInvite") }}
          </NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.preview-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.email-preview {
  margin: 0.35rem 0 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text-soft);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
.meta {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.3rem;
}
.dates {
  display: block;
  margin-top: 0.55rem;
  font-size: 0.82rem;
}
.link {
  font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
</style>

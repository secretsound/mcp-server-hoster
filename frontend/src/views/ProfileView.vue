<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NButton,
  NCard,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";

const { t } = useI18n();
const auth = useAuthStore();
const message = useMessage();

const sessions = ref<
  Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>
>([]);
const sessionsLoading = ref(false);
const revokingSessions = ref(false);

async function loadSessions() {
  if (!auth.isAuthenticated) return;
  sessionsLoading.value = true;
  try {
    const res = await auth.listSessions();
    sessions.value = res.sessions ?? [];
  } catch {
    sessions.value = [];
  } finally {
    sessionsLoading.value = false;
  }
}

async function revokeOtherSessions() {
  revokingSessions.value = true;
  try {
    await auth.revokeOtherSessions();
    message.success(t("profile.otherRevoked"));
    await loadSessions();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    revokingSessions.value = false;
  }
}

async function revokeOneSession(id: string) {
  try {
    await auth.revokeSession(id);
    message.success(t("profile.sessionRevoked"));
    await loadSessions();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

onMounted(() => {
  void loadSessions();
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ t("profile.title") }}</h1>
        <NText depth="3">{{ t("profile.subtitle") }}</NText>
      </div>
    </header>

    <div class="stack">
      <NCard size="small" :title="t('profile.account')">
        <table class="runtime">
          <tbody>
            <tr>
              <th>{{ t("profile.name") }}</th>
              <td>{{ auth.user?.displayName || "—" }}</td>
            </tr>
            <tr>
              <th>{{ t("profile.email") }}</th>
              <td>{{ auth.user?.email || "—" }}</td>
            </tr>
            <tr>
              <th>{{ t("profile.role") }}</th>
              <td>
                <NTag size="small" :bordered="false">
                  {{ auth.user?.role || "—" }}
                </NTag>
              </td>
            </tr>
          </tbody>
        </table>
      </NCard>

      <NCard size="small" :title="t('profile.sessions')">
        <NSpace style="margin-bottom: 0.75rem">
          <NButton size="small" :loading="sessionsLoading" @click="loadSessions">
            {{ t("profile.refresh") }}
          </NButton>
          <NButton
            size="small"
            type="warning"
            secondary
            :loading="revokingSessions"
            @click="revokeOtherSessions"
          >
            {{ t("profile.revokeOther") }}
          </NButton>
        </NSpace>
        <table class="runtime">
          <tbody>
            <tr v-for="s in sessions" :key="s.id">
              <th>
                <code>{{ s.id.slice(0, 12) }}…</code>
                <NTag
                  v-if="s.current"
                  size="tiny"
                  type="success"
                  :bordered="false"
                  style="margin-left: 0.35rem"
                >
                  {{ t("profile.thisDevice") }}
                </NTag>
              </th>
              <td>
                {{
                  t("profile.createdExpires", {
                    created: new Date(s.createdAt).toLocaleString(),
                    expires: new Date(s.expiresAt).toLocaleString(),
                  })
                }}
                <NButton
                  v-if="!s.current"
                  size="tiny"
                  quaternary
                  type="error"
                  style="margin-left: 0.5rem"
                  @click="revokeOneSession(s.id)"
                >
                  {{ t("profile.revoke") }}
                </NButton>
              </td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="2">{{ t("profile.noSessions") }}</td>
            </tr>
          </tbody>
        </table>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
}
.page-head {
  margin-bottom: 1.25rem;
}
.page-head h1 {
  margin: 0 0 0.25rem;
  font-size: 1.45rem;
  font-weight: 650;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.runtime {
  width: 100%;
  border-collapse: collapse;
}
.runtime th,
.runtime td {
  text-align: left;
  padding: 0.55rem 0.35rem;
  border-bottom: 1px solid var(--n-divider-color, #e2e8ee);
  vertical-align: top;
  font-size: 0.92rem;
}
.runtime th {
  width: 7rem;
  color: var(--app-text-muted);
  font-weight: 500;
}
</style>

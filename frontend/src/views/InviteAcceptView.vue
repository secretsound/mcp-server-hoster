<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";
import type { OAuthProvider, ScopeGrant } from "../types";

const { t } = useI18n();
const auth = useAuthStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();

const token = ref(String(route.params.token ?? ""));
const loading = ref(true);
const email = ref("");
const role = ref("");
const grants = ref<ScopeGrant[]>([]);
const providers = ref<OAuthProvider[]>([]);
const password = ref("");
const displayName = ref("");
const submitting = ref(false);
const errorMsg = ref("");

onMounted(async () => {
  try {
    const res = await auth.previewInvite(token.value);
    email.value = res.invite.email;
    role.value = res.invite.role;
    grants.value = res.invite.grants;
    providers.value = res.oauthProviders;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

async function accept() {
  submitting.value = true;
  try {
    await auth.acceptInvite({
      token: token.value,
      password: password.value,
      displayName: displayName.value.trim() || null,
    });
    message.success(t("invite.welcome"));
    await router.replace("/connect");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="shell" :class="{ dark: theme.isDark }">
    <NCard class="card" size="large">
      <h1>{{ t("invite.title") }}</h1>
      <NSpin v-if="loading" />
      <NAlert v-else-if="errorMsg" type="error" :bordered="false">
        {{ errorMsg }}
      </NAlert>
      <template v-else>
        <NText depth="3">
          {{ t("invite.invitedAs", { role }) }}
          <code>{{ email }}</code>
        </NText>

        <NSpace
          v-if="providers.length"
          vertical
          :size="8"
          style="margin: 1rem 0"
        >
          <NButton
            v-for="p in providers"
            :key="p.id"
            block
            secondary
            tag="a"
            :href="
              auth.oauthStartUrl(p.id, {
                invite: token,
                redirect: '/ui/connect',
              })
            "
          >
            {{ t("invite.joinWith", { provider: p.label }) }}
          </NButton>
          <NDivider style="margin: 0.25rem 0">{{ t("invite.orPassword") }}</NDivider>
        </NSpace>

        <NForm style="margin-top: 1rem" @submit.prevent="accept">
          <NFormItem :label="t('invite.displayName')">
            <NInput v-model:value="displayName" />
          </NFormItem>
          <NFormItem :label="t('invite.password')">
            <NInput
              v-model:value="password"
              type="password"
              show-password-on="click"
              autocomplete="new-password"
            />
          </NFormItem>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="submitting"
            :disabled="password.length < 8"
            block
          >
            {{ t("invite.createAccount") }}
          </NButton>
        </NForm>
      </template>
    </NCard>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background:
    radial-gradient(1000px 420px at 8% -8%, #d7efe4 0%, transparent 55%),
    linear-gradient(180deg, #f5f8fb 0%, #eef2f5 45%);
}
.shell.dark {
  background:
    radial-gradient(900px 380px at 10% -10%, #16352c 0%, transparent 55%),
    linear-gradient(180deg, #121920 0%, #0f161c 50%);
}
.card {
  width: min(440px, 100%);
  border-radius: 16px;
}
h1 {
  margin: 0 0 0.75rem;
  font-size: 1.35rem;
}
</style>

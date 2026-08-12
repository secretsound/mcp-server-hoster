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
  NText,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";

const { t } = useI18n();
const auth = useAuthStore();
const theme = useThemeStore();
const router = useRouter();
const route = useRoute();
const message = useMessage();

const email = ref("");
const password = ref("");
const submitting = ref(false);
const errorMsg = ref("");

onMounted(() => {
  if (typeof route.query.error === "string") {
    errorMsg.value = route.query.error;
  }
});

async function submit() {
  submitting.value = true;
  errorMsg.value = "";
  try {
    await auth.login(email.value.trim(), password.value);
    message.success(t("login.signedIn"));
    const redirect = typeof route.query.redirect === "string"
      ? route.query.redirect
      : "/";
    await router.replace(redirect || "/");
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-shell" :class="{ dark: theme.isDark }">
    <NCard class="login-card" size="large">
      <div class="brand">
        <span class="brand-mark">MH</span>
        <div>
          <h1>MCP Hoster</h1>
          <NText depth="3">{{ t("login.subtitle") }}</NText>
        </div>
      </div>

      <NAlert
        v-if="errorMsg"
        type="error"
        :bordered="false"
        style="margin-bottom: 1rem"
      >
        {{ errorMsg }}
      </NAlert>

      <NSpace
        v-if="auth.oauthProviders.length"
        vertical
        :size="8"
        style="margin-bottom: 0.5rem"
      >
        <NButton
          v-for="p in auth.oauthProviders"
          :key="p.id"
          block
          secondary
          tag="a"
          :href="auth.oauthStartUrl(p.id, {
            redirect: typeof route.query.redirect === 'string'
              ? route.query.redirect
              : '/ui/',
          })"
        >
          {{ t("login.continueWith", { provider: p.label }) }}
        </NButton>
        <NDivider style="margin: 0.4rem 0">{{ t("login.orEmail") }}</NDivider>
      </NSpace>

      <NForm @submit.prevent="submit">
        <NFormItem :label="t('login.email')" path="email">
          <NInput
            v-model:value="email"
            type="text"
            autocomplete="username"
            :placeholder="t('login.emailPlaceholder')"
            @keydown.enter="submit"
          />
        </NFormItem>
        <NFormItem :label="t('login.password')" path="password">
          <NInput
            v-model:value="password"
            type="password"
            show-password-on="click"
            autocomplete="current-password"
            placeholder="••••••••"
            @keydown.enter="submit"
          />
        </NFormItem>
        <NSpace justify="end">
          <NButton
            type="primary"
            attr-type="submit"
            :loading="submitting"
            :disabled="!email.trim() || !password"
          >
            {{ t("login.signIn") }}
          </NButton>
        </NSpace>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.login-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background:
    radial-gradient(1000px 420px at 8% -8%, #d7efe4 0%, transparent 55%),
    radial-gradient(800px 360px at 100% 0%, #dce7f2 0%, transparent 50%),
    linear-gradient(180deg, #f5f8fb 0%, #eef2f5 45%);
}
.login-shell.dark {
  background:
    radial-gradient(900px 380px at 10% -10%, #16352c 0%, transparent 55%),
    radial-gradient(700px 320px at 100% 0%, #1a2736 0%, transparent 50%),
    linear-gradient(180deg, #121920 0%, #0f161c 50%);
}
.login-card {
  width: min(420px, 100%);
  border-radius: 16px;
}
.brand {
  display: flex;
  gap: 0.9rem;
  align-items: center;
  margin-bottom: 1.25rem;
}
.brand h1 {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.03em;
}
.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: #0b6e4f;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
}
.login-shell.dark .brand-mark {
  background: #3ecf9a;
  color: #0f161c;
}
</style>

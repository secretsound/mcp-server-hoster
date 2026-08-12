<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
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

const form = reactive({
  email: "",
  password: "",
});
const submitting = ref(false);
const errorMsg = ref("");

onMounted(() => {
  if (typeof route.query.error === "string") {
    errorMsg.value = route.query.error;
  }
});

async function submit() {
  const email = form.email.trim();
  const password = form.password;
  if (!email || !password) {
    errorMsg.value = t("login.emailPasswordRequired");
    return;
  }

  submitting.value = true;
  errorMsg.value = "";
  try {
    await auth.login(email, password);
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

      <form class="login-form" @submit.prevent="submit">
        <!--
          Plain labels (not NFormItem): some password managers hide the
          username NFormItem wrapper entirely, leaving only Password visible.
        -->
        <label class="login-field" for="login-email">
          <span class="login-field-label">{{ t("login.email") }}</span>
          <NInput
            id="login-email"
            v-model:value="form.email"
            type="text"
            name="username"
            autocomplete="username"
            inputmode="email"
            autofocus
            :placeholder="t('login.emailPlaceholder')"
          />
        </label>
        <label class="login-field" for="login-password">
          <span class="login-field-label">{{ t("login.password") }}</span>
          <NInput
            id="login-password"
            v-model:value="form.password"
            type="password"
            name="password"
            show-password-on="click"
            autocomplete="current-password"
            placeholder="••••••••"
          />
        </label>
        <NSpace justify="end">
          <NButton
            type="primary"
            attr-type="submit"
            :loading="submitting"
            :disabled="!form.email.trim() || !form.password"
          >
            {{ t("login.signIn") }}
          </NButton>
        </NSpace>
      </form>
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

.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.login-field {
  display: flex !important;
  flex-direction: column;
  gap: 0.35rem;
  visibility: visible !important;
  opacity: 1 !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  position: relative !important;
  clip: auto !important;
  transform: none !important;
}
.login-field-label {
  font-size: 0.9rem;
  color: var(--app-text-soft);
}
:deep(#login-email),
:deep(#login-password),
:deep(#login-email .n-input),
:deep(#login-password .n-input),
:deep(#login-email .n-input-wrapper),
:deep(#login-password .n-input-wrapper) {
  display: flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  min-height: 34px;
  width: 100%;
}
</style>

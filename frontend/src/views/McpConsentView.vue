<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NSpace,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";

type ConsentRequest = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string;
  resource: string | null;
  state: string | null;
  expiresAt: string;
};

const { t } = useI18n();
const auth = useAuthStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(true);
const deciding = ref(false);
const errorMsg = ref("");
const request = ref<ConsentRequest | null>(null);

const requestId = computed(() =>
  typeof route.query.request === "string" ? route.query.request : ""
);

const returnPath = computed(() =>
  `/oauth/consent?request=${encodeURIComponent(requestId.value)}`
);

onMounted(async () => {
  if (!requestId.value) {
    errorMsg.value = t("consent.missingRequest");
    loading.value = false;
    return;
  }
  try {
    if (!auth.ready) await auth.hydrate();
    const res = await api<{
      request: ConsentRequest;
      authenticated: boolean;
    }>(`/oauth/authorize/request/${encodeURIComponent(requestId.value)}`);
    request.value = res.request;
    if (!auth.user) {
      await router.replace({
        name: "login",
        query: { redirect: returnPath.value },
      });
      return;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

async function decide(approve: boolean) {
  if (!request.value) return;
  deciding.value = true;
  errorMsg.value = "";
  try {
    const res = await api<{ redirectTo: string }>("/oauth/authorize/decide", {
      method: "POST",
      body: JSON.stringify({
        requestId: request.value.id,
        approve,
      }),
    });
    if (approve) message.success(t("consent.authorized"));
    window.location.href = res.redirectTo;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await router.replace({
        name: "login",
        query: { redirect: returnPath.value },
      });
      return;
    }
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    deciding.value = false;
  }
}
</script>

<template>
  <div class="consent-shell" :class="{ dark: theme.isDark }">
    <NCard class="consent-card" size="large">
      <div class="brand">
        <span class="brand-mark">MH</span>
        <div>
          <h1>{{ t("consent.title") }}</h1>
          <NText depth="3">
            {{ t("consent.subtitle") }}
          </NText>
        </div>
      </div>

      <div v-if="loading" class="center">
        <NSpin size="large" />
      </div>

      <template v-else-if="request && auth.user">
        <NAlert type="info" :bordered="false" style="margin-bottom: 1rem">
          {{
            t("consent.wantsAccess", {
              clientName: request.clientName,
              user: auth.user.displayName || auth.user.email,
            })
          }}
        </NAlert>

        <dl class="meta">
          <div>
            <dt>{{ t("consent.client") }}</dt>
            <dd>{{ request.clientName }}</dd>
          </div>
          <div>
            <dt>{{ t("consent.scope") }}</dt>
            <dd><code>{{ request.scope }}</code></dd>
          </div>
          <div v-if="request.resource">
            <dt>{{ t("consent.resource") }}</dt>
            <dd><code class="wrap">{{ request.resource }}</code></dd>
          </div>
          <div>
            <dt>{{ t("consent.redirect") }}</dt>
            <dd><code class="wrap">{{ request.redirectUri }}</code></dd>
          </div>
        </dl>

        <NAlert
          v-if="errorMsg"
          type="error"
          :bordered="false"
          style="margin-bottom: 1rem"
        >
          {{ errorMsg }}
        </NAlert>

        <NSpace justify="end">
          <NButton :disabled="deciding" @click="decide(false)">
            {{ t("consent.deny") }}
          </NButton>
          <NButton
            type="primary"
            :loading="deciding"
            @click="decide(true)"
          >
            {{ t("consent.allow") }}
          </NButton>
        </NSpace>
      </template>

      <NAlert v-else-if="errorMsg" type="error" :bordered="false">
        {{ errorMsg }}
      </NAlert>
    </NCard>
  </div>
</template>

<style scoped>
.consent-shell {
  min-height: 100vh;
  display: grid;
  place-content: center;
  padding: 1.5rem;
  background:
    radial-gradient(ellipse at 20% 0%, #d8efe6 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, #e8f0f4 0%, transparent 45%),
    #f4f7f6;
}
.consent-shell.dark {
  background:
    radial-gradient(ellipse at 20% 0%, #14352c 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, #1a2430 0%, transparent 45%),
    #0f1419;
}
.consent-card {
  width: min(440px, 100%);
  border-radius: 14px;
}
.brand {
  display: flex;
  gap: 0.85rem;
  align-items: center;
  margin-bottom: 1.25rem;
}
.brand h1 {
  margin: 0;
  font-size: 1.25rem;
  font-family: "Fraunces", Georgia, serif;
}
.brand-mark {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 10px;
  display: grid;
  place-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  color: #fff;
  background: #0b6e4f;
}
.center {
  display: grid;
  place-content: center;
  min-height: 8rem;
}
.meta {
  margin: 0 0 1.25rem;
  display: grid;
  gap: 0.65rem;
}
.meta div {
  display: grid;
  gap: 0.15rem;
}
.meta dt {
  font-size: 0.75rem;
  color: var(--app-text-muted, #6b7c85);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.meta dd {
  margin: 0;
  font-size: 0.9rem;
}
.wrap {
  word-break: break-all;
}
code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
}
</style>

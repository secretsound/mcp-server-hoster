<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { NSpin, NText } from "naive-ui";
import { useAuthStore } from "../stores/auth";

const { t } = useI18n();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const error = ref("");

onMounted(async () => {
  const token = typeof route.query.token === "string" ? route.query.token : "";
  let redirect =
    typeof route.query.redirect === "string" ? route.query.redirect : "/";
  // History base is /ui/ — strip that prefix when present.
  if (redirect.startsWith("/ui/")) redirect = redirect.slice(3) || "/";
  else if (redirect === "/ui") redirect = "/";
  if (!token) {
    error.value = t("oauth.missingToken");
    return;
  }
  auth.acceptSessionToken(token);
  try {
    await auth.hydrate();
    await router.replace(redirect.startsWith("/") ? redirect : "/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <div class="wrap">
    <NSpin v-if="!error" size="large" />
    <NText v-else type="error">{{ error }}</NText>
    <NText depth="3">{{ t("oauth.completing") }}</NText>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 0.75rem;
  justify-items: center;
}
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import {
  NButton,
  NColorPicker,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NTabPane,
  NTabs,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import type { AppLocale } from "../i18n";
import { useLocaleStore } from "../stores/locale";
import { useThemeStore, type ThemePreference } from "../stores/theme";
import { ACCENTS, type AccentId } from "../theme";

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const theme = useThemeStore();
const localeStore = useLocaleStore();
const message = useMessage();

type ProfileTab = "account" | "preferences" | "security" | "sessions";

function tabFromQuery(raw: unknown): ProfileTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "account" ||
    v === "preferences" ||
    v === "security" ||
    v === "sessions"
  ) {
    return v;
  }
  return "account";
}

const activeTab = ref<ProfileTab>(tabFromQuery(route.query.tab));

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tabFromQuery(tab);
  },
);

const sessions = ref<
  Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>
>([]);
const sessionsLoading = ref(false);
const revokingSessions = ref(false);
const savingProfile = ref(false);
const savingPassword = ref(false);

const profileForm = reactive({
  displayName: "",
  email: "",
  currentPassword: "",
});

const passwordForm = reactive({
  currentPassword: "",
  password: "",
  confirm: "",
});

const monogram = computed(() => {
  const name = (auth.user?.displayName || auth.user?.email || "?").trim();
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const hasPassword = computed(() => auth.user?.hasPassword !== false);

const grantsLabel = computed(() => {
  const u = auth.user;
  if (!u) return "—";
  if (u.permissions?.includes("mcp:full")) return t("profile.fullAccess");
  if (!u.grants?.length) return t("profile.noGrants");
  return t("profile.grantsCount", { count: u.grants.length });
});

const themeOptions = computed(() => [
  { label: t("profile.themeSystem"), value: "system" },
  { label: t("profile.themeLight"), value: "light" },
  { label: t("profile.themeDark"), value: "dark" },
]);

const accentOptions = computed(() =>
  ACCENTS.map((a) => ({
    id: a.id,
    label: t(a.labelKey),
    swatch: a.dark.primary,
  })),
);

const presetSwatches = computed(() =>
  ACCENTS.flatMap((a) => [a.light.primary, a.dark.primary]),
);

function onCustomAccent(value: string | null) {
  if (!value) return;
  theme.setCustomAccent(value);
}

function syncProfileForm() {
  profileForm.displayName = auth.user?.displayName ?? "";
  profileForm.email = auth.user?.email ?? "";
  profileForm.currentPassword = "";
}

watch(
  () => auth.user,
  () => syncProfileForm(),
  { immediate: true },
);

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

async function saveProfile() {
  if (!auth.user) return;
  const email = profileForm.email.trim().toLowerCase();
  const displayName = profileForm.displayName.trim() || null;
  const emailChanged = email !== auth.user.email;

  if (!email || !email.includes("@")) {
    message.warning(t("profile.emailRequired"));
    return;
  }
  if (emailChanged && hasPassword.value && !profileForm.currentPassword) {
    message.warning(t("profile.currentPassword"));
    return;
  }

  savingProfile.value = true;
  try {
    await auth.updateMyProfile({
      displayName,
      email,
      currentPassword: emailChanged
        ? profileForm.currentPassword || undefined
        : undefined,
    });
    profileForm.currentPassword = "";
    message.success(t("profile.profileSaved"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword() {
  if (!passwordForm.password) return;
  if (passwordForm.password.length < 8) {
    message.warning(t("profile.passwordTooShort"));
    return;
  }
  if (passwordForm.password !== passwordForm.confirm) {
    message.warning(t("profile.passwordMismatch"));
    return;
  }
  if (!passwordForm.currentPassword) {
    message.warning(t("profile.currentPassword"));
    return;
  }

  savingPassword.value = true;
  try {
    await auth.updateMyProfile({
      currentPassword: passwordForm.currentPassword,
      password: passwordForm.password,
    });
    passwordForm.currentPassword = "";
    passwordForm.password = "";
    passwordForm.confirm = "";
    message.success(t("profile.passwordChanged"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    savingPassword.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === "sessions") void loadSessions();
});

onMounted(() => {
  void loadSessions();
});
</script>

<template>
  <div class="profile-page">
    <div class="page-head">
      <div>
        <h1>{{ t("profile.title") }}</h1>
        <p class="page-sub">{{ t("profile.subtitle") }}</p>
      </div>
    </div>

    <section class="hero panel">
      <div class="hero-mark" aria-hidden="true">{{ monogram }}</div>
      <div class="hero-body">
        <h2 class="hero-name">
          {{ auth.user?.displayName || auth.user?.email || "—" }}
        </h2>
        <div class="hero-email">{{ auth.user?.email }}</div>
        <div class="hero-chips">
          <span class="chip chip-ok">{{ auth.user?.role || "—" }}</span>
          <span
            class="chip"
            :class="auth.user?.disabled ? 'chip-off' : 'chip-ok'"
          >
            {{
              auth.user?.disabled ? t("profile.disabled") : t("profile.active")
            }}
          </span>
          <span class="chip">{{ grantsLabel }}</span>
        </div>
      </div>
    </section>

    <NTabs v-model:value="activeTab" type="line" animated class="profile-tabs">
      <NTabPane name="account" :tab="t('profile.tabAccount')">
        <div class="tab-body">
          <div class="layout">
            <section class="panel">
              <header class="panel-head">
                <h3>{{ t("profile.overview") }}</h3>
              </header>
              <dl class="facts">
                <div class="fact">
                  <dt>{{ t("profile.userId") }}</dt>
                  <dd><code>{{ auth.user?.id || "—" }}</code></dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.tenant") }}</dt>
                  <dd><code>{{ auth.user?.tenantId || "—" }}</code></dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.role") }}</dt>
                  <dd>{{ auth.user?.role || "—" }}</dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.grants") }}</dt>
                  <dd>{{ grantsLabel }}</dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.permissions") }}</dt>
                  <dd>
                    {{
                      t("profile.permissionsCount", {
                        count: auth.user?.permissions?.length ?? 0,
                      })
                    }}
                  </dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.created") }}</dt>
                  <dd>{{ formatWhen(auth.user?.createdAt) }}</dd>
                </div>
                <div class="fact">
                  <dt>{{ t("profile.updated") }}</dt>
                  <dd>{{ formatWhen(auth.user?.updatedAt) }}</dd>
                </div>
              </dl>
            </section>

            <section class="panel">
              <header class="panel-head">
                <div>
                  <h3>{{ t("profile.personal") }}</h3>
                  <p class="panel-sub">{{ t("profile.personalHint") }}</p>
                </div>
              </header>
              <NForm label-placement="top" class="form">
                <NFormItem :label="t('profile.name')">
                  <NInput
                    v-model:value="profileForm.displayName"
                    :placeholder="t('profile.namePlaceholder')"
                  />
                </NFormItem>
                <NFormItem :label="t('profile.email')">
                  <NInput
                    v-model:value="profileForm.email"
                    :placeholder="t('profile.emailPlaceholder')"
                    :disabled="!hasPassword"
                    autocomplete="email"
                  />
                </NFormItem>
                <NFormItem
                  v-if="hasPassword && profileForm.email.trim().toLowerCase() !== (auth.user?.email || '').toLowerCase()"
                  :label="t('profile.currentPassword')"
                  required
                >
                  <NInput
                    v-model:value="profileForm.currentPassword"
                    type="password"
                    show-password-on="click"
                    autocomplete="current-password"
                  />
                </NFormItem>
                <div v-if="!hasPassword" class="banner">
                  {{ t("profile.securitySso") }}
                </div>
                <NButton
                  type="primary"
                  :loading="savingProfile"
                  @click="saveProfile"
                >
                  {{ t("profile.saveProfile") }}
                </NButton>
              </NForm>
            </section>
          </div>
        </div>
      </NTabPane>

      <NTabPane name="preferences" :tab="t('profile.tabPreferences')">
        <div class="tab-body">
          <section class="panel panel-single">
            <header class="panel-head">
              <div>
                <h3>{{ t("profile.preferences") }}</h3>
                <p class="panel-sub">{{ t("profile.preferencesHint") }}</p>
              </div>
            </header>
            <NForm label-placement="top" class="form form-narrow">
              <NFormItem :label="t('profile.themeMode')">
                <div class="seg">
                  <button
                    v-for="opt in themeOptions"
                    :key="opt.value"
                    type="button"
                    class="seg-btn"
                    :class="{ active: theme.preference === opt.value }"
                    @click="theme.setPreference(opt.value as ThemePreference)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </NFormItem>
              <NFormItem :label="t('profile.language')">
                <NSelect
                  :value="localeStore.locale"
                  :options="localeStore.options"
                  @update:value="(v: AppLocale) => localeStore.setLocale(v)"
                />
              </NFormItem>
              <NFormItem :label="t('profile.accent')">
                <div class="accent-block">
                  <p class="field-hint">{{ t("profile.accentHint") }}</p>
                  <div class="accent-row">
                    <button
                      v-for="opt in accentOptions"
                      :key="opt.id"
                      type="button"
                      class="accent-swatch"
                      :class="{ active: theme.accent === opt.id }"
                      :title="opt.label"
                      :style="{ '--swatch': opt.swatch }"
                      @click="theme.setAccent(opt.id as AccentId)"
                    >
                      <span class="accent-dot" />
                      <span class="accent-label">{{ opt.label }}</span>
                    </button>
                    <button
                      type="button"
                      class="accent-swatch"
                      :class="{ active: theme.accent === 'custom' }"
                      :title="t('profile.accentCustomHint')"
                      :style="{ '--swatch': theme.customAccent }"
                      @click="theme.setAccent('custom')"
                    >
                      <span class="accent-dot accent-dot-custom" />
                      <span class="accent-label">{{ t("profile.accentCustom") }}</span>
                    </button>
                  </div>
                  <div
                    v-if="theme.accent === 'custom'"
                    class="accent-custom-panel"
                  >
                    <NColorPicker
                      class="accent-color-picker"
                      :value="theme.customAccent"
                      :modes="['hex']"
                      :show-alpha="false"
                      :show-preview="true"
                      :swatches="presetSwatches"
                      to="body"
                      @update:value="onCustomAccent"
                    />
                  </div>
                </div>
              </NFormItem>
            </NForm>
          </section>
        </div>
      </NTabPane>

      <NTabPane name="security" :tab="t('profile.tabSecurity')">
        <div class="tab-body">
          <section class="panel panel-single">
            <header class="panel-head">
              <div>
                <h3>{{ t("profile.security") }}</h3>
                <p class="panel-sub">
                  {{
                    hasPassword
                      ? t("profile.securityHint")
                      : t("profile.securitySso")
                  }}
                </p>
              </div>
            </header>
            <div v-if="!hasPassword" class="banner">
              {{ t("profile.securitySso") }}
            </div>
            <NForm v-else label-placement="top" class="form form-narrow">
              <NFormItem :label="t('profile.currentPassword')" required>
                <NInput
                  v-model:value="passwordForm.currentPassword"
                  type="password"
                  show-password-on="click"
                  autocomplete="current-password"
                />
              </NFormItem>
              <NFormItem :label="t('profile.newPassword')" required>
                <NInput
                  v-model:value="passwordForm.password"
                  type="password"
                  show-password-on="click"
                  autocomplete="new-password"
                  :placeholder="t('profile.passwordKeep')"
                />
              </NFormItem>
              <NFormItem :label="t('profile.confirmPassword')" required>
                <NInput
                  v-model:value="passwordForm.confirm"
                  type="password"
                  show-password-on="click"
                  autocomplete="new-password"
                />
              </NFormItem>
              <NButton
                type="primary"
                :loading="savingPassword"
                @click="savePassword"
              >
                {{ t("profile.changePassword") }}
              </NButton>
            </NForm>
          </section>
        </div>
      </NTabPane>

      <NTabPane name="sessions" :tab="t('profile.tabSessions')">
        <div class="tab-body">
          <section class="panel sessions-panel">
            <header class="panel-head sessions-head">
              <div>
                <h3>{{ t("profile.sessions") }}</h3>
                <p class="panel-sub">{{ t("profile.sessionsHint") }}</p>
              </div>
              <div class="sessions-actions">
                <NButton
                  size="small"
                  secondary
                  :loading="sessionsLoading"
                  @click="loadSessions"
                >
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
              </div>
            </header>

            <NEmpty
              v-if="!sessionsLoading && !sessions.length"
              :description="t('profile.noSessions')"
            />
            <ul v-else class="session-list">
              <li
                v-for="s in sessions"
                :key="s.id"
                class="session-row"
                :class="{ current: s.current }"
              >
                <div class="session-main">
                  <div class="session-id-row">
                    <code class="session-id">{{ s.id.slice(0, 14) }}…</code>
                    <span v-if="s.current" class="chip chip-ok">
                      {{ t("profile.thisDevice") }}
                    </span>
                  </div>
                  <div class="session-meta">
                    {{
                      t("profile.createdExpires", {
                        created: formatWhen(s.createdAt),
                        expires: formatWhen(s.expiresAt),
                      })
                    }}
                  </div>
                </div>
                <NButton
                  v-if="!s.current"
                  size="small"
                  type="error"
                  secondary
                  @click="revokeOneSession(s.id)"
                >
                  {{ t("profile.revoke") }}
                </NButton>
              </li>
            </ul>
          </section>
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 920px;
}

.profile-tabs :deep(.n-tabs-nav) {
  margin-bottom: 0.15rem;
}
.tab-body {
  padding-top: 0.85rem;
}

.layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
@media (max-width: 820px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.panel {
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-accent) 8%, transparent),
      transparent 55%
    ),
    var(--app-surface);
  padding: 1.05rem 1.15rem 1.1rem;
}
.panel-single {
  max-width: 560px;
}
.panel-head {
  margin-bottom: 0.85rem;
}
.panel-head h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--app-text);
}
.panel-sub {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--app-text-muted);
}

.hero {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.hero-mark {
  flex: 0 0 auto;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.02em;
  color: var(--app-brand-fg, #fff);
  background: linear-gradient(
    145deg,
    var(--app-accent-hover) 0%,
    var(--app-accent) 55%,
    var(--app-accent-pressed) 100%
  );
}
.hero-name {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--app-text);
}
.hero-email {
  margin-top: 0.15rem;
  font-size: 0.9rem;
  color: var(--app-text-muted);
  word-break: break-word;
}
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 650;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
  color: var(--app-text-muted);
}
.chip-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.chip-off {
  background: color-mix(in srgb, #c23b3b 14%, transparent);
  border-color: color-mix(in srgb, #c23b3b 32%, transparent);
  color: #c23b3b;
}

.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.fact {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: baseline;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--app-border);
}
.fact:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.fact dt {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--app-text-muted);
}
.fact dd {
  margin: 0;
  font-size: 0.88rem;
  color: var(--app-text);
  word-break: break-word;
}
.fact code {
  font-size: 0.8rem;
  color: var(--app-text-soft);
}

.form {
  display: flex;
  flex-direction: column;
}
.form-narrow {
  max-width: 420px;
}
.field-hint {
  margin: 0 0 0.55rem;
  font-size: 0.8rem;
  color: var(--app-text-muted);
  line-height: 1.4;
}
.banner {
  margin-bottom: 0.85rem;
  padding: 0.7rem 0.85rem;
  border-radius: 11px;
  font-size: 0.85rem;
  line-height: 1.45;
  border: 1px solid color-mix(in srgb, #2f6fed 28%, transparent);
  background: color-mix(in srgb, #2f6fed 10%, transparent);
  color: var(--app-text-soft);
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  width: 100%;
}
.seg-btn {
  flex: 1 1 auto;
  min-width: 4.5rem;
  border: 1px solid var(--app-border);
  background: var(--app-chip-bg);
  color: var(--app-text-soft);
  border-radius: 999px;
  padding: 0.4rem 0.75rem;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 550;
  cursor: pointer;
}
.seg-btn:hover {
  color: var(--app-text);
  border-color: var(--app-accent);
}
.seg-btn.active {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.accent-block {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.55rem;
  width: 100%;
}
.accent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  width: 100%;
}
.accent-swatch {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
  border-radius: 999px;
  padding: 0.35rem 0.7rem 0.35rem 0.45rem;
  font: inherit;
  cursor: pointer;
  color: var(--app-text-soft);
}
.accent-swatch:hover {
  border-color: var(--swatch);
  color: var(--app-text);
}
.accent-swatch.active {
  border-color: var(--swatch);
  background: color-mix(in srgb, var(--swatch) 16%, transparent);
  color: var(--app-text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--swatch) 35%, transparent);
}
.accent-dot {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 999px;
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 18%, transparent);
}
.accent-dot-custom {
  background:
    conic-gradient(
      from 0deg,
      #ff6b6b,
      #ffd93d,
      #6bcb77,
      #4d96ff,
      #c77dff,
      #ff6b6b
    );
  box-shadow: none;
}
.accent-swatch.active .accent-dot-custom {
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 18%, transparent);
}
.accent-label {
  font-size: 0.8rem;
  font-weight: 600;
}
.accent-custom-panel {
  width: 100%;
  max-width: 280px;
  padding: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.accent-color-picker {
  width: 100%;
}
.accent-color-picker :deep(.n-color-picker-trigger) {
  width: 100%;
  min-height: 34px;
}

.sessions-panel {
  padding-bottom: 0.85rem;
}
.sessions-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.sessions-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface-raised);
}
.session-row.current {
  border-color: var(--app-chip-active-border);
  background: var(--app-chip-active-bg);
}
.session-id-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.session-id {
  font-size: 0.82rem;
  color: var(--app-text);
}
.session-meta {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  line-height: 1.35;
}
</style>

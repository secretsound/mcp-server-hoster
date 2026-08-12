<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NIcon,
  NMenu,
  NPopover,
  useMessage,
} from "naive-ui";
import type { MenuGroupOption, MenuOption } from "naive-ui";
import {
  AddOutline,
  ChevronDownOutline,
  CodeSlashOutline,
  KeyOutline,
  LinkOutline,
  LogOutOutline,
  MailOutline,
  MenuOutline,
  PeopleOutline,
  PersonOutline,
  ColorPaletteOutline,
  RibbonOutline,
  ServerOutline,
  SettingsOutline,
  LibraryOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import AddServerModal from "../components/AddServerModal.vue";
import InstallWizardModal from "../components/InstallWizardModal.vue";
import GatewayPill from "../components/GatewayPill.vue";
import { useAuthStore } from "../stores/auth";
import { useLocaleStore } from "../stores/locale";
import { useServersStore } from "../stores/servers";
import { useSettingsStore } from "../stores/settings";
import { useThemeStore, type ThemePreference } from "../stores/theme";
import { useUiStore } from "../stores/ui";
import type { AppLocale } from "../i18n";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const servers = useServersStore();
const settingsStore = useSettingsStore();
const theme = useThemeStore();
const localeStore = useLocaleStore();
const ui = useUiStore();
const auth = useAuthStore();
const message = useMessage();
const collapsed = ref(false);
const mobileOpen = ref(false);
const userMenuOpen = ref(false);
const isMobile = ref(window.innerWidth < 900);

function onResize() {
  isMobile.value = window.innerWidth < 900;
  if (!isMobile.value) mobileOpen.value = false;
}

onMounted(() => {
  void settingsStore.load();
  window.addEventListener("resize", onResize);
  if (!auth.needsLogin) {
    void servers.refresh().catch(() => {});
    servers.startPolling();
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  servers.stopPolling();
});

watch(
  () => auth.needsLogin,
  (needs) => {
    if (needs) {
      servers.stopPolling();
    } else {
      void servers.refresh().catch(() => {});
      servers.startPolling();
    }
  },
);

function renderIcon(icon: typeof ServerOutline) {
  return () => h(NIcon, null, { default: () => h(icon) });
}

function menuGroup(
  key: string,
  label: string,
  children: MenuOption[],
): MenuGroupOption | null {
  if (!children.length) return null;
  return { type: "group", key, label, children };
}

const menuOptions = computed(() => {
  const workspace: MenuOption[] = [
    {
      label: t("nav.servers"),
      key: "/",
      icon: renderIcon(ServerOutline),
    },
  ];
  if (auth.can("servers:read")) {
    workspace.push({
      label: t("nav.library"),
      key: "/library",
      icon: renderIcon(LibraryOutline),
    });
  }
  workspace.push(
    {
      label: t("nav.connect"),
      key: "/connect",
      icon: renderIcon(LinkOutline),
    },
    {
      label: t("nav.apiKeys"),
      key: "/keys",
      icon: renderIcon(KeyOutline),
    },
  );

  const access: MenuOption[] = [];
  if (auth.can("users:read")) {
    access.push({
      label: t("nav.users"),
      key: "/users",
      icon: renderIcon(PeopleOutline),
    });
  }
  if (auth.can("invites:write")) {
    access.push({
      label: t("nav.invites"),
      key: "/invites",
      icon: renderIcon(MailOutline),
    });
  }
  if (auth.can("roles:read")) {
    access.push({
      label: t("nav.roles"),
      key: "/roles",
      icon: renderIcon(RibbonOutline),
    });
  }
  if (auth.can("audit:read")) {
    access.push({
      label: t("nav.audit"),
      key: "/audit",
      icon: renderIcon(TimeOutline),
    });
  }

  const tools: MenuOption[] = [];
  if (auth.can("servers:read")) {
    tools.push({
      label: t("nav.api"),
      key: "/api",
      icon: renderIcon(CodeSlashOutline),
    });
  }

  const system: MenuOption[] = [];
  if (auth.can("settings:read")) {
    system.push({
      label: t("nav.settings"),
      key: "/settings",
      icon: renderIcon(SettingsOutline),
    });
  }

  return [
    menuGroup("workspace", t("nav.groupWorkspace"), workspace),
    menuGroup("access", t("nav.groupAccess"), access),
    menuGroup("tools", t("nav.groupTools"), tools),
    menuGroup("system", t("nav.groupSystem"), system),
  ].filter((g): g is MenuGroupOption => g != null);
});

const activeKey = computed(() => {
  const p = route.path;
  if (p.startsWith("/servers")) return "/";
  if (p.startsWith("/library") || p.startsWith("/store")) return "/library";
  if (p.startsWith("/connect")) return "/connect";
  if (p.startsWith("/keys")) return "/keys";
  if (p.startsWith("/users")) return "/users";
  if (p.startsWith("/invites")) return "/invites";
  if (p.startsWith("/roles")) return "/roles";
  if (p.startsWith("/audit")) return "/audit";
  if (p.startsWith("/api")) return "/api";
  if (p.startsWith("/settings")) return "/settings";
  return "/";
});

function onMenuUpdate(key: string) {
  mobileOpen.value = false;
  void router.push(key);
}

const userLabel = computed(() => {
  if (!auth.user) {
    return auth.required ? t("nav.signedOut") : t("nav.openMode");
  }
  return auth.user.displayName || auth.user.email;
});

const userEmail = computed(() => auth.user?.email ?? "");

const userMonogram = computed(() => {
  const name = (auth.user?.displayName || auth.user?.email || "?").trim();
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const themeOptions = computed(() => [
  { value: "system" as ThemePreference, label: t("nav.themeSystem") },
  { value: "light" as ThemePreference, label: t("nav.themeLight") },
  { value: "dark" as ThemePreference, label: t("nav.themeDark") },
]);

async function goProfile(tab?: string) {
  userMenuOpen.value = false;
  await router.push({
    name: "profile",
    query: tab ? { tab } : undefined,
  });
}

async function goLogin() {
  userMenuOpen.value = false;
  await router.push({ name: "login" });
}

async function signOut() {
  userMenuOpen.value = false;
  await auth.logout();
  message.success(t("nav.signedOut"));
  if (auth.needsLogin) await router.push({ name: "login" });
}

function onLocaleUpdate(v: AppLocale) {
  localeStore.setLocale(v);
}

watch(
  () => theme.isDark,
  (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  },
  { immediate: true },
);
</script>

<template>
  <div class="shell" :class="{ dark: theme.isDark }">
    <aside v-if="!isMobile" class="sider" :class="{ collapsed }">
      <div class="brand" :class="{ collapsed }">
        <span class="brand-mark">MH</span>
        <span v-if="!collapsed" class="brand-text">{{ settingsStore.displayName }}</span>
      </div>
      <NMenu
        :value="activeKey"
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        @update:value="onMenuUpdate"
      />
      <button
        type="button"
        class="collapse-btn"
        :aria-label="collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? "›" : "‹" }}
      </button>
    </aside>

    <div class="main">
      <header class="header">
        <div class="header-left">
          <NButton
            v-if="isMobile"
            quaternary
            circle
            @click="mobileOpen = true"
          >
            <template #icon>
              <NIcon :component="MenuOutline" />
            </template>
          </NButton>
          <div v-if="isMobile" class="brand compact">
            <span class="brand-mark">MH</span>
            <span class="brand-text">{{ settingsStore.displayName }}</span>
          </div>
          <GatewayPill />
        </div>

        <div class="header-right">
          <NButton
            v-if="auth.can('servers:write')"
            type="primary"
            size="small"
            class="add-btn"
            @click="ui.openAdd()"
          >
            <template #icon>
              <NIcon :component="AddOutline" />
            </template>
            <span class="add-label">{{ t("nav.addServer") }}</span>
          </NButton>

          <NPopover
            v-if="auth.isAuthenticated || auth.required"
            v-model:show="userMenuOpen"
            trigger="click"
            placement="bottom-end"
            :show-arrow="false"
            raw
            class="user-popover"
          >
            <template #trigger>
              <button
                type="button"
                class="user-trigger"
                :aria-label="t('nav.accountMenu')"
                :class="{ open: userMenuOpen }"
              >
                <span class="user-avatar" aria-hidden="true">{{ userMonogram }}</span>
                <span v-if="!isMobile" class="user-trigger-meta">
                  <span class="user-trigger-name">{{ userLabel }}</span>
                  <span v-if="auth.user?.role" class="user-trigger-role">
                    {{ auth.user.role }}
                  </span>
                </span>
                <NIcon
                  v-if="!isMobile"
                  class="user-caret"
                  :component="ChevronDownOutline"
                  :size="14"
                />
              </button>
            </template>

            <div class="user-menu">
              <div v-if="auth.user" class="user-menu-head">
                <span class="user-avatar lg" aria-hidden="true">{{ userMonogram }}</span>
                <div class="user-menu-id">
                  <div class="user-menu-name">{{ userLabel }}</div>
                  <div class="user-menu-email">{{ userEmail }}</div>
                </div>
              </div>
              <div v-else class="user-menu-head bare">
                <div class="user-menu-name">{{ userLabel }}</div>
              </div>

              <div class="user-menu-section">
                <button
                  v-if="auth.isAuthenticated"
                  type="button"
                  class="user-menu-item"
                  @click="goProfile()"
                >
                  <NIcon :component="PersonOutline" :size="16" />
                  <span>{{ t("nav.profile") }}</span>
                </button>
                <button
                  v-if="auth.isAuthenticated"
                  type="button"
                  class="user-menu-item"
                  @click="goProfile('preferences')"
                >
                  <NIcon :component="ColorPaletteOutline" :size="16" />
                  <span>{{ t("nav.preferences") }}</span>
                </button>
                <button
                  v-if="auth.required && !auth.isAuthenticated"
                  type="button"
                  class="user-menu-item"
                  @click="goLogin"
                >
                  <NIcon :component="PersonOutline" :size="16" />
                  <span>{{ t("nav.signIn") }}</span>
                </button>
              </div>

              <div class="user-menu-section prefs">
                <div class="pref-row">
                  <span class="pref-label">{{ t("nav.theme") }}</span>
                  <div class="pref-seg">
                    <button
                      v-for="opt in themeOptions"
                      :key="opt.value"
                      type="button"
                      class="pref-seg-btn"
                      :class="{ active: theme.preference === opt.value }"
                      @click="theme.setPreference(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>
                <div class="pref-row">
                  <span class="pref-label">{{ t("nav.language") }}</span>
                  <div class="pref-seg">
                    <button
                      v-for="opt in localeStore.options"
                      :key="opt.value"
                      type="button"
                      class="pref-seg-btn"
                      :class="{ active: localeStore.locale === opt.value }"
                      @click="onLocaleUpdate(opt.value as AppLocale)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>
              </div>

              <div v-if="auth.isAuthenticated" class="user-menu-section">
                <button
                  type="button"
                  class="user-menu-item danger"
                  @click="signOut"
                >
                  <NIcon :component="LogOutOutline" :size="16" />
                  <span>{{ t("nav.signOut") }}</span>
                </button>
              </div>
            </div>
          </NPopover>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>

    <NDrawer v-model:show="mobileOpen" placement="left" :width="260">
      <NDrawerContent :title="settingsStore.displayName" closable>
        <NMenu
          :value="activeKey"
          :options="menuOptions"
          @update:value="onMenuUpdate"
        />
      </NDrawerContent>
    </NDrawer>

    <AddServerModal v-if="auth.can('servers:write')" />
    <InstallWizardModal v-if="auth.can('servers:write')" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  --border-color: #d5dde5;
  --pill-bg: rgba(255, 255, 255, 0.75);
  --sider-bg: rgba(255, 255, 255, 0.82);
  --header-bg: rgba(245, 248, 251, 0.88);
  background:
    radial-gradient(1000px 420px at 8% -8%, #d7efe4 0%, transparent 55%),
    radial-gradient(800px 360px at 100% 0%, #dce7f2 0%, transparent 50%),
    linear-gradient(180deg, #f5f8fb 0%, #eef2f5 45%);
}
.shell.dark {
  --border-color: #2a3641;
  --pill-bg: rgba(23, 31, 39, 0.85);
  --sider-bg: rgba(18, 25, 32, 0.96);
  --header-bg: rgba(15, 22, 28, 0.92);
  background:
    radial-gradient(900px 380px at 10% -10%, #16352c 0%, transparent 55%),
    radial-gradient(700px 320px at 100% 0%, #1a2736 0%, transparent 50%),
    linear-gradient(180deg, #121920 0%, #0f161c 50%);
}
.sider {
  position: relative;
  flex: 0 0 220px;
  width: 220px;
  min-height: 0;
  height: 100%;
  border-right: 1px solid var(--border-color);
  background: var(--sider-bg);
  backdrop-filter: blur(10px);
  transition: flex-basis 0.2s ease, width 0.2s ease;
}
.sider.collapsed {
  flex-basis: 64px;
  width: 64px;
}
.sider :deep(.n-menu-item-group-title) {
  padding-top: 1rem !important;
  padding-bottom: 0.35rem !important;
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-muted) !important;
  opacity: 0.9;
}
.sider :deep(.n-menu .n-menu-item-group:first-child > .n-menu-item-group-title) {
  padding-top: 0.35rem !important;
}
.collapse-btn {
  position: absolute;
  top: 50%;
  right: -12px;
  z-index: 5;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--sider-bg);
  color: inherit;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 1.1rem 1rem 0.85rem;
}
.brand.collapsed {
  justify-content: center;
  padding-inline: 0.5rem;
}
.brand.compact {
  padding: 0;
}
.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9px;
  background: var(--app-accent);
  color: var(--app-brand-fg, #fff);
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}
.brand-text {
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: -0.03em;
}
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.header {
  flex: 0 0 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--header-bg);
  backdrop-filter: blur(10px);
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}
.header-right {
  flex: 0 0 auto;
}
.add-btn :deep(.n-button__content) {
  gap: 0.25rem;
}
@media (max-width: 720px) {
  .add-label {
    display: none;
  }
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1.35rem 1.5rem 3rem;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  max-width: 220px;
  padding: 0.2rem 0.45rem 0.2rem 0.2rem;
  border-radius: 999px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font: inherit;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}
.user-trigger:hover,
.user-trigger.open {
  border-color: color-mix(in srgb, var(--app-accent) 45%, var(--app-border));
  background: var(--app-surface-raised);
}
.user-trigger.open {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-accent) 28%, transparent);
}
.user-avatar {
  flex: 0 0 auto;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--app-brand-fg, #fff);
  background: linear-gradient(
    145deg,
    var(--app-accent-hover) 0%,
    var(--app-accent) 55%,
    var(--app-accent-pressed) 100%
  );
}
.user-avatar.lg {
  width: 2.45rem;
  height: 2.45rem;
  font-size: 0.78rem;
  border-radius: 11px;
}
.user-trigger-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.15;
  padding-right: 0.1rem;
}
.user-trigger-name {
  max-width: 9.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 650;
}
.user-trigger-role {
  font-size: 0.68rem;
  color: var(--app-text-muted);
  text-transform: capitalize;
}
.user-caret {
  color: var(--app-text-muted);
  margin-right: 0.15rem;
  transition: transform 140ms ease;
}
.user-trigger.open .user-caret {
  transform: rotate(180deg);
}
</style>

<style>
.user-popover.n-popover,
.user-popover.n-popover:not(.n-popover--raw) {
  padding: 0;
}
.user-menu {
  width: min(300px, 92vw);
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  box-shadow: 0 18px 40px color-mix(in srgb, #000 22%, transparent);
  overflow: hidden;
}
html[data-theme="dark"] .user-menu {
  box-shadow: 0 18px 44px color-mix(in srgb, #000 55%, transparent);
}
.user-menu-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.95rem 1rem 0.85rem;
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--app-accent) 12%, transparent),
      transparent 70%
    );
  border-bottom: 1px solid var(--app-border);
}
.user-menu-head.bare {
  padding-bottom: 0.95rem;
}
.user-menu-id {
  min-width: 0;
}
.user-menu-name {
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.user-menu-email {
  margin-top: 0.15rem;
  font-size: 0.78rem;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-menu-section {
  display: flex;
  flex-direction: column;
  padding: 0.4rem;
  border-bottom: 1px solid var(--app-border);
}
.user-menu-section:last-child {
  border-bottom: none;
}
.user-menu-section.prefs {
  gap: 0.65rem;
  padding: 0.7rem 0.75rem;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--app-text-soft);
  border-radius: 9px;
  padding: 0.55rem 0.65rem;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 550;
  cursor: pointer;
  text-align: left;
}
.user-menu-item:hover {
  background: var(--app-surface-raised);
  color: var(--app-text);
}
.user-menu-item.danger {
  color: #c23b3b;
}
html[data-theme="dark"] .user-menu-item.danger {
  color: #f07178;
}
.user-menu-item.danger:hover {
  background: color-mix(in srgb, #c23b3b 12%, transparent);
}
.pref-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.pref-label {
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.pref-seg {
  display: flex;
  gap: 0.25rem;
  padding: 0.18rem;
  border-radius: 10px;
  background: var(--app-surface-raised);
  border: 1px solid var(--app-border);
}
.pref-seg-btn {
  flex: 1 1 0;
  border: 0;
  background: transparent;
  color: var(--app-text-muted);
  border-radius: 8px;
  padding: 0.35rem 0.4rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}
.pref-seg-btn:hover {
  color: var(--app-text);
}
.pref-seg-btn.active {
  background: var(--app-surface);
  color: var(--app-chip-active-text);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 12%, transparent);
}
</style>

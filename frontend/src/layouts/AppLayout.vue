<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NDropdown,
  NIcon,
  NMenu,
  NSpace,
  NText,
  NTooltip,
  useMessage,
} from "naive-ui";
import type { MenuOption } from "naive-ui";
import {
  AddOutline,
  CloudOutline,
  CodeSlashOutline,
  KeyOutline,
  LinkOutline,
  MailOutline,
  MenuOutline,
  MoonOutline,
  PeopleOutline,
  RibbonOutline,
  ServerOutline,
  SettingsOutline,
  LibraryOutline,
  SunnyOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import AddServerModal from "../components/AddServerModal.vue";
import InstallWizardModal from "../components/InstallWizardModal.vue";
import GatewayPill from "../components/GatewayPill.vue";
import { useAuthStore } from "../stores/auth";
import { useServersStore } from "../stores/servers";
import { useSettingsStore } from "../stores/settings";
import { useThemeStore } from "../stores/theme";
import { useUiStore } from "../stores/ui";

const route = useRoute();
const router = useRouter();
const servers = useServersStore();
const settingsStore = useSettingsStore();
const theme = useThemeStore();
const ui = useUiStore();
const auth = useAuthStore();
const message = useMessage();
const collapsed = ref(false);
const mobileOpen = ref(false);
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

const menuOptions = computed<MenuOption[]>(() => {
  const items: MenuOption[] = [
    {
      label: "Servers",
      key: "/",
      icon: renderIcon(ServerOutline),
    },
  ];
  if (auth.can("servers:read")) {
    items.push({
      label: "Library",
      key: "/library",
      icon: renderIcon(LibraryOutline),
    });
  }
  items.push(
    {
      label: "Connect",
      key: "/connect",
      icon: renderIcon(LinkOutline),
    },
    {
      label: "API keys",
      key: "/keys",
      icon: renderIcon(KeyOutline),
    },
  );
  if (auth.can("users:read")) {
    items.push({
      label: "Users",
      key: "/users",
      icon: renderIcon(PeopleOutline),
    });
  }
  if (auth.can("invites:write")) {
    items.push({
      label: "Invites",
      key: "/invites",
      icon: renderIcon(MailOutline),
    });
  }
  if (auth.can("roles:read")) {
    items.push({
      label: "Roles",
      key: "/roles",
      icon: renderIcon(RibbonOutline),
    });
  }
  if (auth.can("audit:read")) {
    items.push({
      label: "Audit",
      key: "/audit",
      icon: renderIcon(TimeOutline),
    });
  }
  if (auth.can("servers:read")) {
    items.push({
      label: "API",
      key: "/api",
      icon: renderIcon(CodeSlashOutline),
    });
  }
  if (auth.can("settings:read")) {
    items.push({
      label: "Settings",
      key: "/settings",
      icon: renderIcon(SettingsOutline),
    });
  }
  return items;
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

const themeIcon = computed(() => {
  if (theme.preference === "dark") return MoonOutline;
  if (theme.preference === "light") return SunnyOutline;
  return CloudOutline;
});

const themeTip = computed(() => `Theme: ${theme.preference}`);

const userLabel = computed(() => {
  if (!auth.user) return auth.required ? "Signed out" : "Open mode";
  return auth.user.displayName || auth.user.email;
});

const userMenu = computed(() => {
  const opts: Array<{ label: string; key: string }> = [];
  if (auth.isAuthenticated) {
    opts.push({ label: "API keys", key: "keys" });
    opts.push({ label: "Sign out", key: "logout" });
  } else if (auth.required) {
    opts.push({ label: "Sign in", key: "login" });
  }
  return opts;
});

async function onUserMenu(key: string) {
  if (key === "logout") {
    await auth.logout();
    message.success("Signed out");
    if (auth.needsLogin) await router.push({ name: "login" });
    return;
  }
  if (key === "login") {
    await router.push({ name: "login" });
    return;
  }
  if (key === "keys") {
    await router.push({ name: "keys" });
  }
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
        :aria-label="collapsed ? 'Expand menu' : 'Collapse menu'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? "›" : "‹" }}
      </button>
    </aside>

    <div class="main">
      <header class="header">
        <NSpace align="center" justify="space-between" style="width: 100%">
          <NSpace align="center" :size="12">
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
          </NSpace>
          <NSpace :size="8" align="center">
            <NTooltip>
              <template #trigger>
                <NButton quaternary circle @click="theme.cycle()">
                  <template #icon>
                    <NIcon :component="themeIcon" />
                  </template>
                </NButton>
              </template>
              {{ themeTip }}
            </NTooltip>
            <NDropdown
              v-if="userMenu.length"
              trigger="click"
              :options="userMenu"
              @select="onUserMenu"
            >
              <NButton quaternary>
                {{ userLabel }}
              </NButton>
            </NDropdown>
            <NText v-else depth="3" class="user-pill">{{ userLabel }}</NText>
            <NButton
              v-if="auth.can('servers:write')"
              type="primary"
              @click="ui.openAdd()"
            >
              <template #icon>
                <NIcon :component="AddOutline" />
              </template>
              Add server
            </NButton>
          </NSpace>
        </NSpace>
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
  background: #0b6e4f;
  color: #fff;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}
.shell.dark .brand-mark {
  background: #3ecf9a;
  color: #0f161c;
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
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--header-bg);
  backdrop-filter: blur(10px);
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
.user-pill {
  font-size: 0.9rem;
}
</style>

<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import { useLocaleStore } from "./stores/locale";
import { useThemeStore } from "./stores/theme";

const theme = useThemeStore();
const localeStore = useLocaleStore();
</script>

<template>
  <NConfigProvider
    :theme="theme.naiveTheme"
    :theme-overrides="theme.themeOverrides"
    :locale="localeStore.naiveLocale"
    :date-locale="localeStore.naiveDateLocale"
  >
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <RouterView />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

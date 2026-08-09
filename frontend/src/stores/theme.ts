import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { darkTheme, type GlobalTheme } from "naive-ui";
import { darkThemeOverrides, lightThemeOverrides } from "../theme";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "mcp-hoster-theme";

function readPreference(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useThemeStore = defineStore("theme", () => {
  const preference = ref<ThemePreference>(readPreference());
  const systemIsDark = ref(systemDark());

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    systemIsDark.value = media.matches;
  };
  media.addEventListener("change", onChange);

  watch(preference, (v) => localStorage.setItem(STORAGE_KEY, v));

  const isDark = computed(() =>
    preference.value === "system"
      ? systemIsDark.value
      : preference.value === "dark",
  );

  const naiveTheme = computed<GlobalTheme | null>(() =>
    isDark.value ? darkTheme : null,
  );

  const themeOverrides = computed(() =>
    isDark.value ? darkThemeOverrides : lightThemeOverrides,
  );

  function setPreference(v: ThemePreference) {
    preference.value = v;
  }

  function cycle() {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const i = order.indexOf(preference.value);
    preference.value = order[(i + 1) % order.length];
  }

  return {
    preference,
    isDark,
    naiveTheme,
    themeOverrides,
    setPreference,
    cycle,
  };
});

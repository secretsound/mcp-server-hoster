import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { darkTheme, type GlobalTheme } from "naive-ui";
import {
  applyAccentCssVars,
  buildThemeOverrides,
  DEFAULT_CUSTOM_ACCENT,
  normalizeAccentId,
  normalizeHexColor,
  type AccentId,
} from "../theme";

export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "mcp-hoster-theme";
const ACCENT_KEY = "mcp-hoster-accent";
const CUSTOM_ACCENT_KEY = "mcp-hoster-accent-custom";

function readPreference(): ThemePreference {
  const v = localStorage.getItem(THEME_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function readAccent(): AccentId {
  return normalizeAccentId(localStorage.getItem(ACCENT_KEY));
}

function readCustomAccent(): string {
  return normalizeHexColor(
    localStorage.getItem(CUSTOM_ACCENT_KEY) || DEFAULT_CUSTOM_ACCENT,
  );
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useThemeStore = defineStore("theme", () => {
  const preference = ref<ThemePreference>(readPreference());
  const accent = ref<AccentId>(readAccent());
  const customAccent = ref<string>(readCustomAccent());
  const systemIsDark = ref(systemDark());

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    systemIsDark.value = media.matches;
  };
  media.addEventListener("change", onChange);

  watch(preference, (v) => localStorage.setItem(THEME_KEY, v));
  watch(accent, (v) => localStorage.setItem(ACCENT_KEY, v));
  watch(customAccent, (v) => localStorage.setItem(CUSTOM_ACCENT_KEY, v));

  const isDark = computed(() =>
    preference.value === "system"
      ? systemIsDark.value
      : preference.value === "dark",
  );

  const naiveTheme = computed<GlobalTheme | null>(() =>
    isDark.value ? darkTheme : null,
  );

  const themeOverrides = computed(() =>
    buildThemeOverrides(isDark.value, accent.value, customAccent.value),
  );

  watch(
    [isDark, accent, customAccent],
    ([dark, accentId, custom]) => {
      applyAccentCssVars(accentId, dark, custom);
    },
    { immediate: true },
  );

  function setPreference(v: ThemePreference) {
    preference.value = v;
  }

  function setAccent(v: AccentId) {
    accent.value = normalizeAccentId(v);
  }

  function setCustomAccent(hex: string) {
    customAccent.value = normalizeHexColor(hex);
    accent.value = "custom";
  }

  function cycle() {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const i = order.indexOf(preference.value);
    preference.value = order[(i + 1) % order.length]!;
  }

  return {
    preference,
    accent,
    customAccent,
    isDark,
    naiveTheme,
    themeOverrides,
    setPreference,
    setAccent,
    setCustomAccent,
    cycle,
  };
});

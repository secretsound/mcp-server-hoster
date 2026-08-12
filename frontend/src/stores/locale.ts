import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  dateEnUS,
  dateEsAR,
  enUS,
  esAR,
  type NDateLocale,
  type NLocale,
} from "naive-ui";
import { setI18nLocale, type AppLocale } from "../i18n";

const STORAGE_KEY = "mcp-hoster-locale";

const SUPPORTED: AppLocale[] = ["en", "es"];

function detectBrowserLocale(): AppLocale {
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const raw of langs) {
    const base = raw.toLowerCase().split("-")[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}

function readLocale(): AppLocale {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "en" || v === "es") return v;
  return detectBrowserLocale();
}

export const useLocaleStore = defineStore("locale", () => {
  const locale = ref<AppLocale>(readLocale());

  watch(
    locale,
    (v) => {
      localStorage.setItem(STORAGE_KEY, v);
      setI18nLocale(v);
    },
    { immediate: true },
  );

  const naiveLocale = computed<NLocale>(() =>
    locale.value === "es" ? esAR : enUS,
  );

  const naiveDateLocale = computed<NDateLocale>(() =>
    locale.value === "es" ? dateEsAR : dateEnUS,
  );

  const options = computed(() =>
    SUPPORTED.map((code) => ({
      value: code,
      label: code === "en" ? "English" : "Español",
    })),
  );

  function setLocale(v: AppLocale) {
    if (SUPPORTED.includes(v)) locale.value = v;
  }

  return {
    locale,
    naiveLocale,
    naiveDateLocale,
    options,
    setLocale,
  };
});

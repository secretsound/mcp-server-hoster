import { createI18n } from "vue-i18n";
import en from "./locales/en";
import es from "./locales/es";

export type AppLocale = "en" | "es";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: { en, es },
});

export function setI18nLocale(locale: AppLocale) {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
}

export default i18n;

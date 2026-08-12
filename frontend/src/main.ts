import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import i18n from "./i18n";
import {
  applyAccentCssVars,
  normalizeAccentId,
  normalizeHexColor,
} from "./theme";
import "./style.css";

// Apply theme + accent before first paint so tokens match dark/light mode.
(() => {
  const pref = localStorage.getItem("mcp-hoster-theme");
  const dark =
    pref === "dark" ||
    ((pref === "system" || !pref) &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  const accentId = normalizeAccentId(localStorage.getItem("mcp-hoster-accent"));
  const custom = normalizeHexColor(
    localStorage.getItem("mcp-hoster-accent-custom"),
  );
  applyAccentCssVars(accentId, dark, custom);
})();

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
app.config.errorHandler = (err, _instance, info) => {
  console.error("[mcp-hoster ui]", info, err);
};
app.mount("#app");

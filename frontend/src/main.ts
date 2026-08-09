import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./style.css";

// Apply theme class before first paint so text tokens match dark/light mode.
(() => {
  const pref = localStorage.getItem("mcp-hoster-theme");
  const dark =
    pref === "dark" ||
    ((pref === "system" || !pref) &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.config.errorHandler = (err, _instance, info) => {
  console.error("[mcp-hoster ui]", info, err);
};
app.mount("#app");

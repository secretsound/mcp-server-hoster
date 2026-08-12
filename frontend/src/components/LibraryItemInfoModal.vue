<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  NButton,
  NIcon,
  NModal,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import {
  CopyOutline,
  OpenOutline,
} from "@vicons/ionicons5";
import type { LibraryItem } from "../types";
import {
  copyText,
  displayLibraryTags,
  isOfficialLibraryItem,
  isOnlineLibraryItem,
  librarySourceKind,
  librarySourceUrl,
  optionalEnvKeysFromPairs,
  requiredEnvKeysFromPairs,
} from "../utils/serverForm";

const props = defineProps<{
  item: LibraryItem | null;
  categoryLabel?: string;
  show: boolean;
  canInstall?: boolean;
  isInstalled?: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  install: [item: LibraryItem];
}>();

const { t } = useI18n();
const message = useMessage();

const sourceUrl = computed(() =>
  props.item ? librarySourceUrl(props.item) : null,
);

const sourceKind = computed(() =>
  props.item ? librarySourceKind(props.item) : null,
);

const sourceLinkLabel = computed(() => {
  switch (sourceKind.value) {
    case "repo":
      return t("library.infoOpenRepo");
    case "npm":
      return t("library.infoOpenNpm");
    case "pypi":
      return t("library.infoOpenPypi");
    case "web":
      return t("library.infoOpenSource");
    default:
      return t("library.infoOpenSource");
  }
});

const sourceHost = computed(() => {
  if (!sourceUrl.value) return "";
  try {
    return new URL(sourceUrl.value).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl.value;
  }
});

const monogram = computed(() => {
  const name = props.item?.name?.trim() || "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const commandPreview = computed(() => {
  const p = props.item?.preset;
  if (!p) return "";
  if (p.launcher === "npx") {
    const spec = [p.package, p.packageVersion ? `@${p.packageVersion}` : ""]
      .join("")
      .replace(/@@/, "@");
    return ["npx", "-y", spec, p.extraArgs].filter(Boolean).join(" ");
  }
  if (p.launcher === "uvx") {
    return ["uvx", p.package, p.extraArgs].filter(Boolean).join(" ");
  }
  const args = String(p.argsLines || "")
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);
  return [p.command, ...args].filter(Boolean).join(" ");
});

const requiredEnv = computed(() => {
  const env = props.item?.preset?.env || [];
  const keys = new Set(requiredEnvKeysFromPairs(env));
  return env.filter((e) => keys.has(e.key));
});

const optionalEnv = computed(() => {
  const env = props.item?.preset?.env || [];
  const keys = new Set(optionalEnvKeysFromPairs(env));
  return env.filter((e) => keys.has(e.key));
});

const gitHref = computed(() => {
  const git = props.item?.preset?.git?.trim() || "";
  if (!git) return null;
  if (/^https?:\/\//i.test(git)) return git;
  if (/^github\.com\//i.test(git)) return `https://${git}`;
  return null;
});

const metaRows = computed(() => {
  if (!props.item) return [];
  const rows: Array<{ label: string; value: string; href?: string | null }> = [
    { label: t("library.infoId"), value: props.item.id },
  ];
  if (props.item.source) {
    rows.push({
      label: t("library.infoSource"),
      value: props.item.source,
      href: sourceUrl.value,
    });
  }
  if (props.item.preset?.launcher) {
    rows.push({
      label: t("library.infoLauncher"),
      value: props.item.preset.launcher,
    });
  }
  if (props.item.preset?.package) {
    const ver = props.item.preset.packageVersion
      ? `@${props.item.preset.packageVersion}`
      : "";
    rows.push({
      label: t("library.infoPackage"),
      value: `${props.item.preset.package}${ver}`,
      href: sourceUrl.value,
    });
  }
  if (props.item.preset?.git) {
    rows.push({
      label: t("library.infoGit"),
      value: props.item.preset.ref
        ? `${props.item.preset.git} (${props.item.preset.ref})`
        : props.item.preset.git,
      href: gitHref.value,
    });
  }
  return rows;
});

function close() {
  emit("update:show", false);
}

function onInstall() {
  if (!props.item) return;
  emit("install", props.item);
  close();
}

async function copyCommand() {
  if (!commandPreview.value) return;
  if (await copyText(commandPreview.value)) {
    message.success(t("common.copied"));
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="lib-info-modal"
    style="width: min(540px, 96vw)"
    :bordered="false"
    closable
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <template v-if="item" #header>
      <div class="info-hero">
        <div class="info-mark" aria-hidden="true">{{ monogram }}</div>
        <div class="info-hero-text">
          <div class="info-kicker">{{ t("library.infoTitle") }}</div>
          <h2 class="info-title">{{ item.name }}</h2>
          <div class="info-chips">
            <span v-if="categoryLabel" class="chip chip-cat">{{ categoryLabel }}</span>
            <span
              class="chip"
              :class="isOnlineLibraryItem(item.tags) ? 'chip-warn' : 'chip-ok'"
            >
              {{
                isOnlineLibraryItem(item.tags)
                  ? t("library.onlineRequired")
                  : t("library.localApp")
              }}
            </span>
            <span
              v-if="isOfficialLibraryItem(item.tags)"
              class="chip chip-ok"
            >
              {{ t("library.official") }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="item" class="info-body">
      <p class="info-blurb">{{ item.blurb }}</p>

      <a
        v-if="sourceUrl"
        class="source-card"
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div class="source-card-text">
          <span class="source-card-label">{{ sourceLinkLabel }}</span>
          <span class="source-card-host">{{ sourceHost }}</span>
        </div>
        <NIcon :component="OpenOutline" :size="18" />
      </a>

      <section class="info-section">
        <h3 class="section-label">{{ t("library.infoDetails") }}</h3>
        <dl class="meta-grid">
          <div v-for="row in metaRows" :key="row.label" class="meta-row">
            <dt>{{ row.label }}</dt>
            <dd>
              <a
                v-if="row.href"
                :href="row.href"
                target="_blank"
                rel="noopener noreferrer"
                class="meta-link"
              >
                {{ row.value }}
              </a>
              <code v-else>{{ row.value }}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section v-if="commandPreview" class="info-section">
        <div class="section-head">
          <h3 class="section-label">{{ t("library.infoCommand") }}</h3>
          <NButton
            size="tiny"
            quaternary
            :aria-label="t('common.copy')"
            @click="copyCommand"
          >
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            {{ t("common.copy") }}
          </NButton>
        </div>
        <pre class="cmd-block"><code>{{ commandPreview }}</code></pre>
      </section>

      <section
        v-if="requiredEnv.length || optionalEnv.length"
        class="info-section"
      >
        <h3 class="section-label">{{ t("library.infoEnvironment") }}</h3>
        <ul class="env-list">
          <li v-for="e in requiredEnv" :key="`r-${e.key}`" class="env-row">
            <div class="env-top">
              <code>{{ e.key }}</code>
              <span class="chip chip-warn">{{ t("common.required") }}</span>
            </div>
            <p v-if="e.description" class="env-hint">{{ e.description }}</p>
          </li>
          <li v-for="e in optionalEnv" :key="`o-${e.key}`" class="env-row">
            <div class="env-top">
              <code>{{ e.key }}</code>
              <span class="chip">{{ t("common.optional") }}</span>
            </div>
            <p v-if="e.description" class="env-hint">{{ e.description }}</p>
          </li>
        </ul>
      </section>

      <NSpace
        v-if="displayLibraryTags(item.tags).length"
        :size="6"
        class="tag-row"
      >
        <NTag
          v-for="tag in displayLibraryTags(item.tags)"
          :key="tag"
          size="small"
          :bordered="false"
        >
          {{ tag }}
        </NTag>
      </NSpace>
    </div>

    <template v-if="item" #footer>
      <div class="info-footer">
        <NText depth="3" class="footer-hint">
          {{ item.preset?.launcher || "" }}
          <template v-if="item.preset?.package">
            · {{ item.preset.package }}
          </template>
        </NText>
        <NSpace>
          <NButton @click="close">{{ t("common.close") }}</NButton>
          <NButton v-if="canInstall" type="primary" @click="onInstall">
            {{
              isInstalled
                ? t("library.installAnother")
                : t("common.install")
            }}
          </NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.info-hero {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding-right: 0.5rem;
}
.info-mark {
  flex: 0 0 auto;
  width: 3rem;
  height: 3rem;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  color: var(--app-brand-fg, #fff);
  background:
    linear-gradient(145deg, var(--app-accent-hover) 0%, var(--app-accent) 55%, var(--app-accent-pressed) 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--app-accent) 28%, transparent);
}
:global(html[data-theme="dark"]) .info-mark {
  box-shadow: 0 8px 22px color-mix(in srgb, var(--app-accent) 22%, transparent);
}
.info-hero-text {
  min-width: 0;
  flex: 1;
}
.info-kicker {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  margin-bottom: 0.2rem;
}
.info-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--app-text);
}
.info-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  background: var(--app-surface-raised);
  color: var(--app-text-soft);
  border: 1px solid var(--app-border);
}
.chip-cat {
  background: color-mix(in srgb, #2f6fed 12%, transparent);
  border-color: color-mix(in srgb, #2f6fed 28%, transparent);
  color: #2f6fed;
}
:global(html[data-theme="dark"]) .chip-cat {
  color: #6aa1ff;
  background: color-mix(in srgb, #6aa1ff 14%, transparent);
  border-color: color-mix(in srgb, #6aa1ff 30%, transparent);
}
.chip-warn {
  background: color-mix(in srgb, #b8860b 14%, transparent);
  border-color: color-mix(in srgb, #b8860b 32%, transparent);
  color: #9a7209;
}
:global(html[data-theme="dark"]) .chip-warn {
  color: #e0b44a;
  background: color-mix(in srgb, #e0b44a 14%, transparent);
  border-color: color-mix(in srgb, #e0b44a 30%, transparent);
}
.chip-ok {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}

.info-body {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  animation: info-in 220ms ease-out;
}
@keyframes info-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.info-blurb {
  margin: 0;
  color: var(--app-text-soft);
  line-height: 1.55;
  font-size: 0.98rem;
}

.source-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  border: 1px solid color-mix(in srgb, var(--app-chip-active-text) 35%, var(--app-border));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--app-chip-active-text) 12%, transparent),
      transparent 70%
    ),
    var(--app-surface-raised);
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}
.source-card:hover {
  border-color: var(--app-chip-active-text);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--app-chip-active-text) 14%, transparent);
}
.source-card-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.source-card-label {
  font-weight: 650;
  font-size: 0.92rem;
  color: var(--app-chip-active-text);
}
.source-card-host {
  font-size: 0.8rem;
  color: var(--app-text-muted);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.section-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}

.meta-grid {
  margin: 0;
  padding: 0.15rem 0;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-surface-raised) 70%, transparent);
  overflow: hidden;
}
.meta-row {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  border-top: 1px solid var(--app-border);
}
.meta-row:first-child {
  border-top: none;
}
.meta-row dt {
  margin: 0;
  font-size: 0.8rem;
  color: var(--app-text-muted);
  font-weight: 500;
}
.meta-row dd {
  margin: 0;
  min-width: 0;
}
.meta-row code,
.meta-link {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82rem;
  word-break: break-all;
  color: var(--app-text);
}
.meta-link {
  color: var(--app-chip-active-text);
  text-decoration: none;
}
.meta-link:hover {
  text-decoration: underline;
}

.cmd-block {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  background: #121920;
  color: #d7e6df;
  overflow-x: auto;
}
:global(html[data-theme="light"]) .cmd-block {
  background: #14212b;
  color: #e8f5ef;
}
.cmd-block code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.env-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.env-row {
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}
.env-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.env-top code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--app-text);
}
.env-hint {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--app-text-muted);
}

.tag-row {
  margin-top: -0.15rem;
}

.info-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  width: 100%;
}
.footer-hint {
  font-size: 0.8rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 520px) {
  .meta-row {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
  .footer-hint {
    max-width: 100%;
  }
  .info-mark {
    width: 2.6rem;
    height: 2.6rem;
    font-size: 0.85rem;
  }
  .info-title {
    font-size: 1.2rem;
  }
}
</style>

<style>
/* Soften Naive card chrome for this modal only */
.lib-info-modal.n-card {
  border-radius: 16px !important;
  overflow: hidden;
}
.lib-info-modal .n-card-header {
  padding: 1.15rem 1.25rem 0.85rem !important;
}
.lib-info-modal .n-card__content {
  padding: 0.35rem 1.25rem 0.5rem !important;
}
.lib-info-modal .n-card__footer {
  padding: 0.85rem 1.25rem 1.1rem !important;
  border-top: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-surface-raised) 65%, transparent);
}
</style>

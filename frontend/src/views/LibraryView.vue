<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NInput,
  NSpin,
  NSpace,
  NTag,
  NText,
  NThing,
} from "naive-ui";
import { SearchOutline } from "@vicons/ionicons5";
import type { LibraryCategoryId, LibraryItem } from "../types";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import {
  displayLibraryTags,
  isOfficialLibraryItem,
  isSelfHostedLibraryItem,
  requiredEnvKeysFromPairs,
} from "../utils/serverForm";

const { t } = useI18n();
const servers = useServersStore();
const library = useLibraryStore();
const ui = useUiStore();
const auth = useAuthStore();
const router = useRouter();
const canInstall = computed(() => auth.can("servers:write"));

const query = ref("");
const category = ref<"all" | LibraryCategoryId>("all");

onMounted(() => {
  void library.ensureLoaded();
});

const installed = computed(() => new Set(servers.servers.map((s) => s.id)));

const categoryOptions = computed(() => [
  {
    id: "all" as const,
    label: t("library.all"),
    description: t("library.allDescription"),
  },
  ...library.categories,
]);

function matchesQuery(item: LibraryItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.name, item.blurb, item.source, item.category, ...item.tags]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return library.items.filter((item) => {
    if (category.value !== "all" && item.category !== category.value) {
      return false;
    }
    return matchesQuery(item, q);
  });
});

const showFeatured = computed(
  () =>
    category.value === "all" &&
    !query.value.trim() &&
    library.featured.length > 0,
);

const featured = computed(() => library.featured);

const grouped = computed(() => {
  if (category.value !== "all" || query.value.trim()) {
    return [
      {
        id: category.value,
        label:
          category.value === "all"
            ? t("library.results")
            : library.categories.find((c) => c.id === category.value)?.label ||
              t("library.results"),
        description: "",
        items: filtered.value,
      },
    ];
  }
  return library.categories
    .map((cat) => ({
      ...cat,
      items: filtered.value.filter((item) => item.category === cat.id),
    }))
    .filter((g) => g.items.length > 0);
});

function categoryLabel(id: LibraryCategoryId): string {
  return library.categories.find((c) => c.id === id)?.label || id;
}

function install(item: LibraryItem) {
  ui.openInstall(item);
}

function openServer(id: string) {
  void router.push(`/servers/${encodeURIComponent(id)}`);
}

function launcherOf(item: LibraryItem): string {
  const launcher = item.preset?.launcher;
  if (launcher === "npx" || launcher === "uvx") return launcher;
  if (launcher === "custom") return item.preset?.command?.trim() || "custom";
  return "custom";
}

function packageOf(item: LibraryItem): string | null {
  const pkg = item.preset?.package?.trim();
  if (!pkg) return null;
  const ver = item.preset?.packageVersion?.trim();
  return ver ? `${pkg}@${ver}` : pkg;
}

function requiredEnvCount(item: LibraryItem): number {
  return requiredEnvKeysFromPairs(item.preset?.env).length;
}

function isInstalled(item: LibraryItem): boolean {
  return installed.value.has(item.id) || installed.value.has(item.preset?.id || "");
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ t("library.title") }}</h1>
        <p class="page-sub">
          {{ t("library.subtitle") }}
        </p>
      </div>
    </div>

    <NAlert v-if="library.error" type="error" style="margin-bottom: 1rem">
      {{ library.error }}
      <template #action>
        <NButton size="small" @click="library.refresh()">{{ t("library.retry") }}</NButton>
      </template>
    </NAlert>

    <NSpin :show="library.loading && !library.loaded">
      <div class="toolbar">
        <NInput
          v-model:value="query"
          clearable
          :placeholder="t('library.searchPlaceholder')"
          class="search"
        >
          <template #prefix>
            <NIcon :component="SearchOutline" />
          </template>
        </NInput>
        <div class="filters">
          <button
            v-for="opt in categoryOptions"
            :key="opt.id"
            type="button"
            class="chip"
            :class="{ active: category === opt.id }"
            @click="category = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <section v-if="showFeatured" class="featured">
        <div class="section-head">
          <h2>{{ t("library.featured") }}</h2>
          <NText depth="3">{{ t("library.featuredSub") }}</NText>
        </div>
        <div class="featured-grid">
          <NCard
            v-for="item in featured"
            :key="item.id"
            size="small"
            hoverable
            class="lib-card featured-card"
          >
            <NThing>
              <template #header>
                <span class="title">{{ item.name }}</span>
              </template>
              <template #header-extra>
                <NSpace :size="6" align="center">
                  <NTag
                    v-if="isInstalled(item)"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    {{ t("library.installed") }}
                  </NTag>
                  <NTag v-else size="small" :bordered="false">{{ t("library.featuredTag") }}</NTag>
                </NSpace>
              </template>
              <template #description>
                <span class="sub">
                  {{ categoryLabel(item.category) }} · {{ item.source }}
                </span>
              </template>

              <div class="card-body">
                <p class="blurb">{{ item.blurb }}</p>
                <NSpace :size="6" class="meta">
                  <NTag size="tiny" :bordered="false">
                    {{ launcherOf(item) }}
                  </NTag>
                  <NTag v-if="packageOf(item)" size="tiny" :bordered="false">
                    {{ packageOf(item) }}
                  </NTag>
                  <NTag
                    v-if="requiredEnvCount(item)"
                    size="tiny"
                    :bordered="false"
                  >
                    {{ t("library.envCount", { count: requiredEnvCount(item) }) }}
                  </NTag>
                  <NTag
                    v-if="isSelfHostedLibraryItem(item.tags)"
                    size="tiny"
                    type="warning"
                    :bordered="false"
                  >
                    {{ t("library.selfHosted") }}
                  </NTag>
                </NSpace>
              </div>

              <template #action>
                <NSpace class="card-actions">
                  <NButton
                    v-if="canInstall"
                    type="primary"
                    size="small"
                    :disabled="isInstalled(item)"
                    @click="install(item)"
                  >
                    {{ isInstalled(item) ? t("common.installed") : t("common.install") }}
                  </NButton>
                  <NButton
                    v-if="isInstalled(item)"
                    size="small"
                    @click="openServer(item.preset?.id || item.id)"
                  >
                    {{ t("common.open") }}
                  </NButton>
                </NSpace>
              </template>
            </NThing>
          </NCard>
        </div>
      </section>

      <NEmpty
        v-if="!filtered.length"
        :description="t('library.noMatch')"
        style="margin-top: 2rem"
      >
        <template #extra>
          <NButton
            @click="
              query = '';
              category = 'all';
            "
          >
            {{ t("library.clearFilters") }}
          </NButton>
        </template>
      </NEmpty>

      <section
        v-for="group in grouped"
        :key="String(group.id)"
        class="catalog"
      >
        <div class="section-head">
          <h2>{{ group.label }}</h2>
          <NText v-if="group.description" depth="3">{{ group.description }}</NText>
          <NText v-else depth="3">{{ t("library.serversCount", { count: group.items.length }) }}</NText>
        </div>
        <div class="cards">
          <NCard
            v-for="item in group.items"
            :key="item.id"
            size="small"
            hoverable
            class="lib-card"
          >
            <NThing>
              <template #header>
                <span class="title">{{ item.name }}</span>
              </template>
              <template #header-extra>
                <NTag
                  v-if="isInstalled(item)"
                  size="small"
                  type="success"
                  :bordered="false"
                >
                  {{ t("library.installed") }}
                </NTag>
              </template>
              <template #description>
                <span class="sub">{{ item.source }}</span>
              </template>

              <div class="card-body">
                <p class="blurb">{{ item.blurb }}</p>
                <NSpace :size="6" class="meta">
                  <NTag size="tiny" :bordered="false" type="info">
                    {{ categoryLabel(item.category) }}
                  </NTag>
                  <NTag size="tiny" :bordered="false">
                    {{ launcherOf(item) }}
                  </NTag>
                  <NTag v-if="packageOf(item)" size="tiny" :bordered="false">
                    {{ packageOf(item) }}
                  </NTag>
                  <NTag
                    v-if="requiredEnvCount(item)"
                    size="tiny"
                    :bordered="false"
                  >
                    {{ t("library.envCount", { count: requiredEnvCount(item) }) }}
                  </NTag>
                  <NTag
                    v-if="isSelfHostedLibraryItem(item.tags)"
                    size="tiny"
                    type="warning"
                    :bordered="false"
                  >
                    {{ t("library.selfHosted") }}
                  </NTag>
                  <NTag
                    v-if="isOfficialLibraryItem(item.tags)"
                    size="tiny"
                    type="success"
                    :bordered="false"
                  >
                    {{ t("library.official") }}
                  </NTag>
                  <NTag
                    v-for="tag in displayLibraryTags(item.tags)"
                    :key="tag"
                    size="tiny"
                    :bordered="false"
                  >
                    {{ tag }}
                  </NTag>
                </NSpace>
              </div>

              <template #action>
                <NSpace class="card-actions">
                  <NButton
                    v-if="canInstall"
                    type="primary"
                    size="small"
                    :disabled="isInstalled(item)"
                    @click="install(item)"
                  >
                    {{ isInstalled(item) ? t("common.installed") : t("common.install") }}
                  </NButton>
                  <NButton
                    v-if="isInstalled(item)"
                    size="small"
                    @click="openServer(item.preset?.id || item.id)"
                  >
                    {{ t("common.open") }}
                  </NButton>
                </NSpace>
              </template>
            </NThing>
          </NCard>
        </div>
      </section>
    </NSpin>
  </div>
</template>

<style scoped>
.toolbar {
  display: grid;
  gap: 0.85rem;
  margin-bottom: 1.5rem;
}
.search {
  max-width: 420px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.chip {
  border: 1px solid var(--app-border);
  background: var(--app-chip-bg);
  color: var(--app-text-soft);
  border-radius: 999px;
  padding: 0.35rem 0.8rem;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--app-chip-active-text);
  color: var(--app-text);
}
.chip.active {
  background: var(--app-chip-active-bg);
  border-color: var(--app-chip-active-border);
  color: var(--app-chip-active-text);
}
.featured,
.catalog {
  margin-bottom: 1.75rem;
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.55rem 0.85rem;
  margin-bottom: 0.85rem;
}
.section-head h2 {
  margin: 0;
  font-size: 1.1rem;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.featured-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
  align-items: stretch;
}
.featured-card {
  border-color: color-mix(
    in srgb,
    var(--n-primary-color, #3ecf9a) 35%,
    transparent
  );
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--n-primary-color, #3ecf9a) 10%, transparent),
    transparent 55%
  );
}
.lib-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.lib-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.lib-card :deep(.n-thing) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.lib-card :deep(.n-thing-main) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.lib-card :deep(.n-thing-main__content) {
  flex: 1;
}
.lib-card :deep(.n-thing-main__action) {
  margin-top: auto;
  padding-top: 0.85rem;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.15rem;
}
.title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--app-text);
}
.sub {
  color: var(--app-text-muted);
  font-size: 0.82rem;
  word-break: break-word;
}
.blurb {
  margin: 0;
  color: var(--app-text-soft);
  font-size: 0.9rem;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  margin: 0;
}
.card-actions {
  width: 100%;
}
</style>

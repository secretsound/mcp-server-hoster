<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NAlert,
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NSpin,
  NText,
} from "naive-ui";
import { SearchOutline } from "@vicons/ionicons5";
import type { LibraryCategoryId, LibraryItem } from "../types";
import LibraryItemCard from "../components/LibraryItemCard.vue";
import LibraryItemInfoModal from "../components/LibraryItemInfoModal.vue";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import { libraryInstances } from "../utils/serverForm";

const { t } = useI18n();
const servers = useServersStore();
const library = useLibraryStore();
const ui = useUiStore();
const auth = useAuthStore();
const canInstall = computed(() => auth.can("servers:write"));

const query = ref("");
const category = ref<"all" | LibraryCategoryId>("all");
const infoItem = ref<LibraryItem | null>(null);
const infoOpen = ref(false);

onMounted(() => {
  void library.ensureLoaded();
});

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

function showInfo(item: LibraryItem) {
  infoItem.value = item;
  infoOpen.value = true;
}

function instanceCount(item: LibraryItem): number {
  return libraryInstances(item, servers.servers).length;
}

function isInstalled(item: LibraryItem): boolean {
  return instanceCount(item) > 0;
}

function installedBadge(item: LibraryItem): string | null {
  const count = instanceCount(item);
  if (count <= 0) return null;
  if (count === 1) return t("library.installed");
  return t("library.installedCount", { count });
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
        <div class="card-grid">
          <LibraryItemCard
            v-for="item in featured"
            :key="item.id"
            :item="item"
            :category-label="categoryLabel(item.category)"
            featured
            :installed-badge="installedBadge(item)"
            :can-install="canInstall"
            :is-installed="isInstalled(item)"
            @info="showInfo(item)"
            @install="install(item)"
          />
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
        <div class="card-grid">
          <LibraryItemCard
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            :category-label="
              category === 'all' ? categoryLabel(item.category) : undefined
            "
            :installed-badge="installedBadge(item)"
            :can-install="canInstall"
            :is-installed="isInstalled(item)"
            @info="showInfo(item)"
            @install="install(item)"
          />
        </div>
      </section>
    </NSpin>

    <LibraryItemInfoModal
      v-model:show="infoOpen"
      :item="infoItem"
      :category-label="infoItem ? categoryLabel(infoItem.category) : ''"
      :can-install="canInstall"
      :is-installed="infoItem ? isInstalled(infoItem) : false"
      @install="install"
    />
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
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
  align-items: stretch;
}
</style>

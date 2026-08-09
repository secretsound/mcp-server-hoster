import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import type { LibraryCategory, LibraryItem } from "../types";

export const useLibraryStore = defineStore("library", () => {
  const items = ref<LibraryItem[]>([]);
  const categories = ref<LibraryCategory[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  const featured = computed(() =>
    items.value.filter((item) => item.featured).slice(0, 4),
  );

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api<{
        categories: LibraryCategory[];
        items: LibraryItem[];
      }>("/api/library");
      categories.value = res.categories ?? [];
      items.value = res.items ?? [];
      loaded.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function ensureLoaded() {
    if (loaded.value || loading.value) return;
    await refresh();
  }

  return {
    items,
    categories,
    featured,
    loading,
    loaded,
    error,
    refresh,
    ensureLoaded,
  };
});

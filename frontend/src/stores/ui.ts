import { ref } from "vue";
import { defineStore } from "pinia";
import type { LibraryItem, ServerFormValues } from "../types";

export const useUiStore = defineStore("ui", () => {
  const addOpen = ref(false);
  const addPreset = ref<ServerFormValues | null>(null);
  const addTemplateId = ref("npx");
  const addNote = ref<string | null>(null);

  const installOpen = ref(false);
  const installItem = ref<LibraryItem | null>(null);

  function openAdd(opts?: {
    templateId?: string;
    preset?: ServerFormValues | null;
    note?: string | null;
  }) {
    addTemplateId.value = opts?.templateId ?? "npx";
    addPreset.value = opts?.preset ?? null;
    addNote.value = opts?.note ?? null;
    addOpen.value = true;
  }

  function closeAdd() {
    addOpen.value = false;
    addPreset.value = null;
    addNote.value = null;
  }

  function openInstall(item: LibraryItem) {
    installItem.value = item;
    installOpen.value = true;
  }

  function closeInstall() {
    installOpen.value = false;
    installItem.value = null;
  }

  return {
    addOpen,
    addPreset,
    addTemplateId,
    addNote,
    openAdd,
    closeAdd,
    installOpen,
    installItem,
    openInstall,
    closeInstall,
  };
});

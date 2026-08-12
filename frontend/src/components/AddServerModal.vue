<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NModal,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import { getTemplates } from "../data/templates";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import type { ServerFormValues } from "../types";
import { buildCreatePayload } from "../utils/serverForm";
import ServerFormFields from "./ServerFormFields.vue";

const { t, locale } = useI18n();
const ui = useUiStore();
const servers = useServersStore();
const router = useRouter();
const message = useMessage();
const submitting = ref(false);
const formError = ref("");
const activeTemplate = ref("npx");
const formNote = ref("");

const templates = computed(() => {
  void locale.value;
  return getTemplates();
});

const form = reactive<ServerFormValues>({
  id: "",
  name: "",
  launcher: "npx",
  package: "",
  packageVersion: "",
  command: "",
  extraArgs: "",
  argsLines: "",
  env: [{ key: "", value: "" }],
  git: "",
  ref: "",
  startNow: true,
});

function applyValues(values: ServerFormValues) {
  Object.assign(form, {
    ...values,
    env: values.env?.length
      ? values.env.map((e) => ({ ...e }))
      : [{ key: "", value: "" }],
  });
}

function applyTemplate(id: string) {
  const list = getTemplates();
  const tmpl = list.find((x) => x.id === id) || list[0];
  activeTemplate.value = tmpl.id;
  applyValues(tmpl.values);
  formNote.value = tmpl.note || "";
  formError.value = "";
}

watch(
  () => ui.addOpen,
  (open) => {
    if (!open) return;
    formError.value = "";
    if (ui.addPreset) {
      activeTemplate.value = "";
      applyValues(ui.addPreset);
      formNote.value =
        ui.addNote || t("addServer.libraryPresetNote");
    } else {
      applyTemplate(ui.addTemplateId || "npx");
      if (ui.addNote) formNote.value = ui.addNote;
    }
  },
);

const submitLabel = computed(() =>
  form.startNow === false ? t("addServer.create") : t("addServer.createAndStart"),
);

async function onSubmit() {
  formError.value = "";
  submitting.value = true;
  try {
    const body = buildCreatePayload(form);
    const server = await servers.create(body);
    message.success(t("addServer.created", { id: server.id }));
    ui.closeAdd();
    await router.push(`/servers/${encodeURIComponent(server.id)}`);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <NModal
    :show="ui.addOpen"
    preset="card"
    :title="t('addServer.title')"
    style="width: min(720px, 96vw)"
    :mask-closable="!submitting"
    @update:show="(v: boolean) => !v && ui.closeAdd()"
  >
    <NSpace vertical :size="14">
      <div class="templates">
        <NButton
          v-for="tmpl in templates"
          :key="tmpl.id"
          size="small"
          :type="activeTemplate === tmpl.id ? 'primary' : 'default'"
          :secondary="activeTemplate === tmpl.id"
          @click="applyTemplate(tmpl.id)"
        >
          {{ tmpl.label }}
        </NButton>
      </div>

      <NAlert v-if="formNote" type="info" :bordered="false">
        {{ formNote }}
      </NAlert>

      <ServerFormFields v-model="form" />

      <NText v-if="formError" type="error">{{ formError }}</NText>

      <NSpace justify="end">
        <NButton :disabled="submitting" @click="ui.closeAdd()">{{ t("common.cancel") }}</NButton>
        <NButton type="primary" :loading="submitting" @click="onSubmit">
          {{ submitLabel }}
        </NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>

<style scoped>
.templates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
</style>

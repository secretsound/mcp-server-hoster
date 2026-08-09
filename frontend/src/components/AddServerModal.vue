<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NModal,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import { TEMPLATES } from "../data/templates";
import { useServersStore } from "../stores/servers";
import { useUiStore } from "../stores/ui";
import type { ServerFormValues } from "../types";
import { buildCreatePayload } from "../utils/serverForm";
import ServerFormFields from "./ServerFormFields.vue";

const ui = useUiStore();
const servers = useServersStore();
const router = useRouter();
const message = useMessage();
const submitting = ref(false);
const formError = ref("");
const activeTemplate = ref("npx");
const formNote = ref("");

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
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  activeTemplate.value = t.id;
  applyValues(t.values);
  formNote.value = t.note || "";
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
        ui.addNote ||
        "Preconfigured from the Library — review env vars, then create.";
    } else {
      applyTemplate(ui.addTemplateId || "npx");
      if (ui.addNote) formNote.value = ui.addNote;
    }
  },
);

const submitLabel = computed(() =>
  form.startNow === false ? "Create" : "Create & start",
);

async function onSubmit() {
  formError.value = "";
  submitting.value = true;
  try {
    const body = buildCreatePayload(form);
    const server = await servers.create(body);
    message.success(`Created ${server.id}`);
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
    title="Add MCP server"
    style="width: min(720px, 96vw)"
    :mask-closable="!submitting"
    @update:show="(v: boolean) => !v && ui.closeAdd()"
  >
    <NSpace vertical :size="14">
      <div class="templates">
        <NButton
          v-for="t in TEMPLATES"
          :key="t.id"
          size="small"
          :type="activeTemplate === t.id ? 'primary' : 'default'"
          :secondary="activeTemplate === t.id"
          @click="applyTemplate(t.id)"
        >
          {{ t.label }}
        </NButton>
      </div>

      <NAlert v-if="formNote" type="info" :bordered="false">
        {{ formNote }}
      </NAlert>

      <ServerFormFields v-model="form" />

      <NText v-if="formError" type="error">{{ formError }}</NText>

      <NSpace justify="end">
        <NButton :disabled="submitting" @click="ui.closeAdd()">Cancel</NButton>
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

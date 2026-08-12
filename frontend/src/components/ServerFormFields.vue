<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NText,
} from "naive-ui";
import type { ServerFormValues } from "../types";
import EnvKeyValueEditor from "./EnvKeyValueEditor.vue";

defineProps<{
  showId?: boolean;
  idDisabled?: boolean;
  enabledLabel?: string;
  /** When false, hide the enabled / start-on-save checkbox. */
  showEnabled?: boolean;
}>();

const { t } = useI18n();
const model = defineModel<ServerFormValues>({ required: true });

const launcherOptions = computed(() => [
  { label: t("serverForm.launcherNpx"), value: "npx" },
  { label: t("serverForm.launcherUvx"), value: "uvx" },
  { label: t("serverForm.launcherCustom"), value: "custom" },
]);

const isCustom = computed(() => model.value.launcher === "custom");

const packageTitle = computed(() =>
  model.value.launcher === "uvx"
    ? t("serverForm.pypiPackage")
    : t("serverForm.npmPackage"),
);

const packagePlaceholder = computed(() =>
  model.value.launcher === "uvx"
    ? "mcp-portainer"
    : "@modelcontextprotocol/server-everything",
);

const extraHint = computed(() =>
  model.value.launcher === "uvx"
    ? t("serverForm.extraHintUvx")
    : t("serverForm.extraHintNpx"),
);
</script>

<template>
  <NForm label-placement="top" require-mark-placement="right-hanging">
    <div class="grid-2">
      <NFormItem v-if="showId !== false" :label="t('serverForm.id')" required>
        <NInput
          v-model:value="model.id"
          placeholder="mealie"
          :disabled="idDisabled"
          :allow-input="(v: string) => !v || /^[A-Za-z0-9_-]*$/.test(v)"
        />
      </NFormItem>
      <NFormItem :label="t('serverForm.displayName')">
        <NInput v-model:value="model.name" placeholder="Mealie" />
      </NFormItem>
    </div>

    <div class="grid-2">
      <NFormItem :label="t('serverForm.launchWith')">
        <NSelect v-model:value="model.launcher" :options="launcherOptions" />
      </NFormItem>
      <NFormItem v-if="!isCustom" :label="packageTitle" required>
        <NInput
          v-model:value="model.package"
          :placeholder="packagePlaceholder"
        />
      </NFormItem>
      <NFormItem v-else :label="t('serverForm.command')" required>
        <NInput v-model:value="model.command" placeholder="uvx" />
      </NFormItem>
    </div>

    <NFormItem v-if="!isCustom" :label="t('serverForm.version')">
      <template #label>
        {{ t("serverForm.version") }}
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          {{ t("serverForm.versionHint") }}
        </NText>
      </template>
      <NInput
        v-model:value="model.packageVersion"
        :placeholder="
          model.launcher === 'uvx'
            ? t('serverForm.versionPlaceholderUvx')
            : t('serverForm.versionPlaceholderNpx')
        "
      />
    </NFormItem>

    <NFormItem v-if="!isCustom" :label="t('serverForm.extraArgs')">
      <template #label>
        {{ t("serverForm.extraArgs") }}
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          {{ extraHint }}
        </NText>
      </template>
      <NInput
        v-model:value="model.extraArgs"
        :placeholder="
          model.launcher === 'npx'
            ? t('serverForm.extraPlaceholderNpx')
            : t('serverForm.extraPlaceholderUvx')
        "
      />
    </NFormItem>

    <NFormItem v-else :label="t('serverForm.args')">
      <template #label>
        {{ t("serverForm.args") }}
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          {{ t("serverForm.argsHint") }}
        </NText>
      </template>
      <NInput
        v-model:value="model.argsLines"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </NFormItem>

    <NFormItem :label="t('serverForm.environment')">
      <EnvKeyValueEditor v-model="model.env" />
    </NFormItem>

    <NCollapse>
      <NCollapseItem
        :title="t('serverForm.advancedGit')"
        name="git"
      >
        <div class="grid-2">
          <NFormItem :label="t('serverForm.gitUrl')">
            <NInput
              v-model:value="model.git"
              placeholder="https://github.com/org/mcp-server.git"
            />
          </NFormItem>
          <NFormItem :label="t('serverForm.gitRef')">
            <NInput v-model:value="model.ref" placeholder="main" />
          </NFormItem>
        </div>
        <NText depth="3">
          {{ t("serverForm.gitUvxHint") }}
        </NText>
      </NCollapseItem>
    </NCollapse>

    <NFormItem
      v-if="showEnabled !== false"
      :show-label="false"
      style="margin-top: 0.75rem"
    >
      <NCheckbox v-model:checked="model.startNow">
        {{ enabledLabel || t("serverForm.startImmediately") }}
      </NCheckbox>
    </NFormItem>
  </NForm>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.75rem;
}
@media (max-width: 720px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>

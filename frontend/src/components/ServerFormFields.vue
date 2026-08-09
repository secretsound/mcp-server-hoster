<script setup lang="ts">
import { computed } from "vue";
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

const model = defineModel<ServerFormValues>({ required: true });

const launcherOptions = [
  { label: "npx (Node package)", value: "npx" },
  { label: "uvx (Python / git+)", value: "uvx" },
  { label: "Custom command", value: "custom" },
];

const isCustom = computed(() => model.value.launcher === "custom");

const packageTitle = computed(() =>
  model.value.launcher === "uvx" ? "PyPI package name" : "npm package",
);

const packagePlaceholder = computed(() =>
  model.value.launcher === "uvx"
    ? "mcp-portainer"
    : "@modelcontextprotocol/server-everything",
);

const extraHint = computed(() =>
  model.value.launcher === "uvx"
    ? "(optional flags after the package — not --from; use Custom for that)"
    : "(optional path or flags after the package)",
);
</script>

<template>
  <NForm label-placement="top" require-mark-placement="right-hanging">
    <div class="grid-2">
      <NFormItem v-if="showId !== false" label="ID" required>
        <NInput
          v-model:value="model.id"
          placeholder="mealie"
          :disabled="idDisabled"
          :allow-input="(v: string) => !v || /^[A-Za-z0-9_-]*$/.test(v)"
        />
      </NFormItem>
      <NFormItem label="Display name">
        <NInput v-model:value="model.name" placeholder="Mealie" />
      </NFormItem>
    </div>

    <div class="grid-2">
      <NFormItem label="Launch with">
        <NSelect v-model:value="model.launcher" :options="launcherOptions" />
      </NFormItem>
      <NFormItem v-if="!isCustom" :label="packageTitle" required>
        <NInput
          v-model:value="model.package"
          :placeholder="packagePlaceholder"
        />
      </NFormItem>
      <NFormItem v-else label="Command" required>
        <NInput v-model:value="model.command" placeholder="uvx" />
      </NFormItem>
    </div>

    <NFormItem v-if="!isCustom" label="Version">
      <template #label>
        Version
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          (optional pin — leave empty for latest)
        </NText>
      </template>
      <NInput
        v-model:value="model.packageVersion"
        :placeholder="model.launcher === 'uvx' ? 'e.g. 0.3.1' : 'e.g. 0.6.2'"
      />
    </NFormItem>

    <NFormItem v-if="!isCustom" label="Extra args">
      <template #label>
        Extra args
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          {{ extraHint }}
        </NText>
      </template>
      <NInput
        v-model:value="model.extraArgs"
        :placeholder="
          model.launcher === 'npx' ? 'e.g. /data/workspaces/fs' : 'optional tool flags'
        "
      />
    </NFormItem>

    <NFormItem v-else label="Args">
      <template #label>
        Args
        <NText depth="3" style="margin-left: 0.35rem; font-weight: 400">
          (one per line)
        </NText>
      </template>
      <NInput
        v-model:value="model.argsLines"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </NFormItem>

    <NFormItem label="Environment">
      <EnvKeyValueEditor v-model="model.env" />
    </NFormItem>

    <NCollapse>
      <NCollapseItem
        title="Advanced: clone a git repo into the sandbox (optional)"
        name="git"
      >
        <div class="grid-2">
          <NFormItem label="Git URL">
            <NInput
              v-model:value="model.git"
              placeholder="https://github.com/org/mcp-server.git"
            />
          </NFormItem>
          <NFormItem label="Git ref">
            <NInput v-model:value="model.ref" placeholder="main" />
          </NFormItem>
        </div>
        <NText depth="3">
          For <code>uvx --from git+https://...</code>, leave empty — uvx fetches
          the package.
        </NText>
      </NCollapseItem>
    </NCollapse>

    <NFormItem
      v-if="showEnabled !== false"
      :show-label="false"
      style="margin-top: 0.75rem"
    >
      <NCheckbox v-model:checked="model.startNow">
        {{ enabledLabel || "Start immediately after save" }}
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

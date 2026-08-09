<script setup lang="ts">
import { computed } from "vue";
import { NDynamicInput, NInput, NText } from "naive-ui";
import type { EnvPair } from "../types";
import { isEnvPairRequired } from "../utils/serverForm";

const model = defineModel<EnvPair[]>({ required: true });

const props = withDefaults(
  defineProps<{
    /** Highlight rows whose keys are in this list (in addition to pair.required). */
    highlightKeys?: string[];
  }>(),
  { highlightKeys: () => [] },
);

const highlight = computed(() => new Set(props.highlightKeys || []));

function onCreate(): EnvPair {
  return { key: "", value: "" };
}

function isHighlighted(pair: EnvPair): boolean {
  const key = pair.key.trim();
  if (key && highlight.value.has(key)) return true;
  return isEnvPairRequired(pair);
}
</script>

<template>
  <NDynamicInput v-model:value="model" :on-create="onCreate">
    <template #default="{ value }">
      <div class="pair" :class="{ required: isHighlighted(value) }">
        <div class="row">
          <NInput v-model:value="value.key" placeholder="KEY" />
          <NInput
            v-model:value="value.value"
            :type="value.secret ? 'password' : 'text'"
            :placeholder="value.secret ? '••••••••' : 'value'"
            :show-password-on="value.secret ? 'click' : undefined"
          />
        </div>
        <NText v-if="value.description" depth="3" class="hint">
          {{ value.description }}
          <template v-if="isHighlighted(value)"> · required</template>
        </NText>
        <NText v-else-if="isHighlighted(value)" depth="3" class="hint">
          Required before start
        </NText>
      </div>
    </template>
  </NDynamicInput>
</template>

<style scoped>
.pair {
  width: 100%;
  display: grid;
  gap: 0.25rem;
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  border: 1px solid transparent;
}
.pair.required {
  border-color: color-mix(in srgb, var(--n-warning-color, #f0a020) 55%, transparent);
  background: color-mix(in srgb, var(--n-warning-color, #f0a020) 8%, transparent);
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
}
.hint {
  font-size: 0.78rem;
  line-height: 1.35;
}
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>

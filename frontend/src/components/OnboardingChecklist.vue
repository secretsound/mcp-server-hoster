<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { NButton, NCard, NSpace, NTag, NText } from "naive-ui";
import { useUiStore } from "../stores/ui";

const props = defineProps<{
  serversCount: number;
  runningCount: number;
  keysCount: number;
  authRequired: boolean;
  /** Compact strip when some servers already exist */
  compact?: boolean;
}>();

const emit = defineEmits<{ dismiss: [] }>();

const router = useRouter();
const ui = useUiStore();

type Step = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  primary?: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
};

const steps = computed<Step[]>(() => {
  const list: Step[] = [
    {
      id: "install",
      title: "Install a server",
      detail: "Pick a preset from the Library, or add a custom command.",
      done: props.serversCount > 0,
      primary: {
        label: "Browse library",
        run: () => router.push("/library"),
      },
      secondary: {
        label: "Add server",
        run: () => ui.openAdd(),
      },
    },
    {
      id: "start",
      title: "Start it",
      detail: "Running servers advertise tools on the unified /mcp gateway.",
      done: props.runningCount > 0,
      primary: props.serversCount
        ? {
          label: "Go to servers",
          run: () => router.push("/"),
        }
        : undefined,
    },
  ];
  if (props.authRequired) {
    list.push({
      id: "key",
      title: "Create an API key",
      detail: "Mint a scoped key for clients that need Bearer auth (or use OAuth).",
      done: props.keysCount > 0,
      primary: {
        label: "API keys",
        run: () => router.push("/keys"),
      },
    });
  }
  list.push({
    id: "connect",
    title: "Connect a client",
    detail: "Copy Cursor / Claude / Bifrost snippets with your gateway URL.",
    done: props.serversCount > 0 &&
      props.runningCount > 0 &&
      (!props.authRequired || props.keysCount > 0),
    primary: {
      label: "Open Connect",
      run: () => router.push("/connect"),
    },
  });
  return list;
});

const doneCount = computed(() => steps.value.filter((s) => s.done).length);
const allDone = computed(() => doneCount.value === steps.value.length);
</script>

<template>
  <NCard
    size="small"
    class="onboard"
    :class="{ compact }"
    :bordered="false"
  >
    <div class="head">
      <div>
        <h2>{{ compact ? "Getting started" : "Welcome — get connected" }}</h2>
        <NText depth="3" class="sub">
          {{ doneCount }} of {{ steps.length }} complete
          <template v-if="!compact">
            · Library → start →
            {{ authRequired ? "key → " : "" }}Connect
          </template>
        </NText>
      </div>
      <NButton
        v-if="compact || allDone"
        size="tiny"
        quaternary
        @click="emit('dismiss')"
      >
        Dismiss
      </NButton>
    </div>

    <ol class="steps">
      <li
        v-for="(step, i) in steps"
        :key="step.id"
        :class="{ done: step.done }"
      >
        <div class="step-mark">
          <NTag
            size="small"
            :type="step.done ? 'success' : 'default'"
            :bordered="false"
          >
            {{ step.done ? "Done" : i + 1 }}
          </NTag>
        </div>
        <div class="step-body">
          <div class="step-title">{{ step.title }}</div>
          <p class="step-detail">{{ step.detail }}</p>
          <NSpace v-if="!step.done" :size="8">
            <NButton
              v-if="step.primary"
              size="small"
              type="primary"
              secondary
              @click="step.primary.run()"
            >
              {{ step.primary.label }}
            </NButton>
            <NButton
              v-if="step.secondary"
              size="small"
              @click="step.secondary.run()"
            >
              {{ step.secondary.label }}
            </NButton>
          </NSpace>
        </div>
      </li>
    </ol>
  </NCard>
</template>

<style scoped>
.onboard {
  margin-bottom: 1rem;
  background: color-mix(
    in srgb,
    var(--app-chip-active-text) 10%,
    var(--app-surface)
  );
  border: 1px solid
    color-mix(in srgb, var(--app-chip-active-text) 28%, var(--app-border));
}
.onboard.compact {
  background: var(--app-surface);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 650;
}
.sub {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.85rem;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.steps li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.65rem;
  align-items: start;
}
.steps li.done .step-title {
  color: var(--app-text-muted);
}
.step-title {
  font-weight: 600;
  font-size: 0.95rem;
}
.step-detail {
  margin: 0.15rem 0 0.45rem;
  font-size: 0.85rem;
  color: var(--app-text-soft);
  line-height: 1.4;
}
.compact .steps {
  gap: 0.55rem;
}
.compact .step-detail {
  margin-bottom: 0.35rem;
}
</style>

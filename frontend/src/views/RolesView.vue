<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NTag,
  NText,
  NThing,
  useDialog,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import type { PermissionInfo, RoleRecord } from "../types";

const auth = useAuthStore();
const message = useMessage();
const dialog = useDialog();

const roles = ref<RoleRecord[]>([]);
const catalog = ref<PermissionInfo[]>([]);
const loading = ref(true);
const modalOpen = ref(false);
const editing = ref<RoleRecord | null>(null);
const saving = ref(false);
const typeFilter = ref<"all" | "system" | "custom">("all");

const form = reactive({
  slug: "",
  name: "",
  description: "",
  permissions: [] as string[],
});

const visibleRoles = computed(() => {
  if (typeFilter.value === "system") {
    return roles.value.filter((r) => r.isSystem);
  }
  if (typeFilter.value === "custom") {
    return roles.value.filter((r) => !r.isSystem);
  }
  return roles.value;
});

const systemCount = computed(
  () => roles.value.filter((r) => r.isSystem).length,
);
const customCount = computed(
  () => roles.value.filter((r) => !r.isSystem).length,
);

/** Group catalog permissions by area (servers, keys, …). */
const catalogGroups = computed(() => {
  const groups = new Map<string, PermissionInfo[]>();
  for (const p of catalog.value) {
    const area = p.id.includes(":") ? p.id.split(":")[0]! : "other";
    const list = groups.get(area) ?? [];
    list.push(p);
    groups.set(area, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
});

async function refresh() {
  loading.value = true;
  try {
    [roles.value, catalog.value] = await Promise.all([
      auth.listRoles(),
      auth.listPermissions(),
    ]);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function openCreate() {
  editing.value = null;
  form.slug = "";
  form.name = "";
  form.description = "";
  form.permissions = ["servers:read", "keys:own"];
  modalOpen.value = true;
}

function openEdit(role: RoleRecord) {
  editing.value = role;
  form.slug = role.slug;
  form.name = role.name;
  form.description = role.description ?? "";
  form.permissions = [...role.permissions];
  modalOpen.value = true;
}

function togglePerm(id: string, on: boolean) {
  if (on) {
    if (!form.permissions.includes(id)) form.permissions.push(id);
  } else {
    form.permissions = form.permissions.filter((p) => p !== id);
  }
}

function toggleGroup(perms: PermissionInfo[], on: boolean) {
  const ids = perms.map((p) => p.id);
  if (on) {
    const set = new Set(form.permissions);
    for (const id of ids) set.add(id);
    form.permissions = [...set];
  } else {
    const drop = new Set(ids);
    form.permissions = form.permissions.filter((id) => !drop.has(id));
  }
}

function groupState(perms: PermissionInfo[]): {
  checked: boolean;
  indeterminate: boolean;
} {
  const selected = perms.filter((p) => form.permissions.includes(p.id)).length;
  if (selected === 0) return { checked: false, indeterminate: false };
  if (selected === perms.length) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

async function save() {
  saving.value = true;
  try {
    if (editing.value) {
      await auth.updateRole(editing.value.id, {
        name: form.name,
        description: form.description || null,
        permissions: editing.value.isSystem ? undefined : form.permissions,
      });
      message.success("Role updated");
    } else {
      await auth.createRole({
        slug: form.slug,
        name: form.name,
        description: form.description || null,
        permissions: form.permissions,
      });
      message.success("Role created");
    }
    modalOpen.value = false;
    await refresh();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

function remove(role: RoleRecord) {
  dialog.warning({
    title: "Delete role?",
    content: `Delete role “${role.name}”? Users must be reassigned first.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await auth.deleteRole(role.id);
        message.success("Deleted");
        await refresh();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

const PREVIEW_LIMIT = 6;

function previewPerms(role: RoleRecord): string[] {
  const sorted = [...role.permissions].sort((a, b) => {
    // Surface high-signal perms first.
    const rank = (p: string) =>
      p === "mcp:full" ? 0 : p.endsWith(":write") ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return sorted.slice(0, PREVIEW_LIMIT);
}

function overflowCount(role: RoleRecord): number {
  return Math.max(0, role.permissions.length - PREVIEW_LIMIT);
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Roles</h1>
        <p class="page-sub">
          Permissions for the UI and admin API. MCP tool access still uses
          per-user grants (unless a role has <code>mcp:full</code>).
          <template v-if="!loading">
            · {{ systemCount }} system · {{ customCount }} custom
          </template>
        </p>
      </div>
      <NButton
        v-if="auth.can('roles:write')"
        type="primary"
        @click="openCreate"
      >
        Add role
      </NButton>
    </div>

    <div class="filters">
      <button
        type="button"
        class="chip"
        :class="{ active: typeFilter === 'all' }"
        @click="typeFilter = 'all'"
      >
        All
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: typeFilter === 'system' }"
        @click="typeFilter = 'system'"
      >
        System
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: typeFilter === 'custom' }"
        @click="typeFilter = 'custom'"
      >
        Custom
      </button>
    </div>

    <NEmpty v-if="!loading && !roles.length" description="No roles" />
    <NEmpty
      v-else-if="!loading && !visibleRoles.length"
      description="No roles match this filter"
      style="margin-top: 1rem"
    >
      <template #extra>
        <NButton @click="typeFilter = 'all'">Show all</NButton>
      </template>
    </NEmpty>

    <div v-else class="cards">
      <NCard
        v-for="role in visibleRoles"
        :key="role.id"
        size="small"
        hoverable
        class="role-card"
      >
        <NThing>
          <template #header>
            <span class="title">{{ role.name }}</span>
          </template>
          <template #header-extra>
            <NTag
              v-if="role.isSystem"
              size="small"
              type="info"
              :bordered="false"
            >
              System
            </NTag>
            <NTag v-else size="small" :bordered="false">Custom</NTag>
          </template>
          <template #description>
            <code class="slug">{{ role.slug }}</code>
          </template>

          <div class="card-body">
            <p class="desc">
              {{ role.description || "No description" }}
            </p>
            <NSpace :size="6" class="meta">
              <NTag size="small" :bordered="false">
                {{ role.permissions.length }} permissions
              </NTag>
              <NTag
                v-if="role.permissions.includes('mcp:full')"
                size="small"
                type="success"
                :bordered="false"
              >
                mcp:full
              </NTag>
            </NSpace>
            <div class="perms">
              <NTag
                v-for="p in previewPerms(role)"
                :key="p"
                size="tiny"
                :bordered="false"
                :type="p === 'mcp:full' ? 'success' : 'default'"
              >
                {{ p }}
              </NTag>
              <NTag
                v-if="overflowCount(role)"
                size="tiny"
                :bordered="false"
              >
                +{{ overflowCount(role) }} more
              </NTag>
            </div>
            <NText
              v-if="formatWhen(role.createdAt)"
              depth="3"
              class="dates"
            >
              Created {{ formatWhen(role.createdAt) }}
            </NText>
          </div>

          <template #action>
            <NSpace class="card-actions">
              <NButton
                v-if="auth.can('roles:write')"
                size="small"
                @click="openEdit(role)"
              >
                Edit
              </NButton>
              <NButton
                v-if="auth.can('roles:write') && !role.isSystem"
                size="small"
                type="error"
                secondary
                @click="remove(role)"
              >
                Delete
              </NButton>
            </NSpace>
          </template>
        </NThing>
      </NCard>
    </div>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="editing ? 'Edit role' : 'Add role'"
      style="width: min(640px, 96vw)"
    >
      <NForm
        label-placement="top"
        require-mark-placement="right-hanging"
        class="role-form"
      >
        <section class="form-section">
          <h3 class="section-title">Details</h3>
          <div class="grid-2">
            <NFormItem v-if="!editing" label="Slug" required>
              <NInput
                v-model:value="form.slug"
                placeholder="operator"
                :allow-input="(v: string) => !v || /^[a-z0-9_-]*$/.test(v)"
              />
            </NFormItem>
            <NFormItem v-else label="Slug">
              <NInput :value="form.slug" readonly disabled />
            </NFormItem>
            <NFormItem label="Name" required>
              <NInput v-model:value="form.name" placeholder="Operator" />
            </NFormItem>
          </div>
          <NFormItem label="Description">
            <NInput
              v-model:value="form.description"
              type="textarea"
              placeholder="What this role is for"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </NFormItem>
        </section>

        <section class="form-section">
          <h3 class="section-title">Permissions</h3>
          <NAlert
            v-if="editing?.isSystem"
            type="info"
            :bordered="false"
          >
            System role permissions are fixed. You can still rename or update
            the description.
          </NAlert>
          <template v-else>
            <NText depth="3" class="section-hint">
              {{ form.permissions.length }} selected · these control the admin
              UI and API, not MCP tool grants (unless
              <code>mcp:full</code>).
            </NText>
            <div class="perm-groups">
              <div
                v-for="[area, perms] in catalogGroups"
                :key="area"
                class="perm-group"
              >
                <div class="group-head">
                  <NCheckbox
                    :checked="groupState(perms).checked"
                    :indeterminate="groupState(perms).indeterminate"
                    @update:checked="(v: boolean) => toggleGroup(perms, v)"
                  >
                    <span class="group-title">{{ area }}</span>
                  </NCheckbox>
                  <NText depth="3" class="group-count">
                    {{
                      perms.filter((p) => form.permissions.includes(p.id))
                        .length
                    }}/{{ perms.length }}
                  </NText>
                </div>
                <div class="perm-list">
                  <NCheckbox
                    v-for="p in perms"
                    :key="p.id"
                    :checked="form.permissions.includes(p.id)"
                    @update:checked="(v: boolean) => togglePerm(p.id, v)"
                  >
                    <div class="perm-item">
                      <strong>{{ p.label }}</strong>
                      <div class="hint">
                        <code>{{ p.id }}</code> — {{ p.description }}
                      </div>
                    </div>
                  </NCheckbox>
                </div>
              </div>
            </div>
          </template>
        </section>
      </NForm>

      <div class="modal-footer">
        <NButton @click="modalOpen = false">Cancel</NButton>
        <NButton type="primary" :loading="saving" @click="save">
          {{ editing ? "Save changes" : "Create role" }}
        </NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 1rem;
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
.role-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.role-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.role-card :deep(.n-thing) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.role-card :deep(.n-thing-main) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.role-card :deep(.n-thing-main__content) {
  flex: 1;
}
.role-card :deep(.n-thing-main__action) {
  margin-top: auto;
  padding-top: 0.85rem;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.15rem;
}
.title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--app-text);
}
.slug {
  font-size: 0.82rem;
  color: var(--app-text-muted);
}
.desc {
  margin: 0;
  color: var(--app-text-soft);
  font-size: 0.9rem;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  margin: 0;
}
.perms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.dates {
  font-size: 0.78rem;
}
.card-actions {
  width: 100%;
}
.role-form {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.section-title {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.section-hint {
  display: block;
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  line-height: 1.4;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.75rem;
}
@media (max-width: 560px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
.perm-groups {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 360px;
  overflow: auto;
  padding-right: 0.15rem;
}
.perm-group {
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--app-surface);
  padding: 0.65rem 0.75rem;
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--app-border);
}
.group-title {
  font-weight: 600;
  text-transform: capitalize;
}
.group-count {
  font-size: 0.78rem;
}
.perm-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.perm-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.hint {
  font-size: 0.8rem;
  color: var(--app-text-muted);
  line-height: 1.35;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--app-border);
}
</style>

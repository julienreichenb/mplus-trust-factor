<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { AdminFaqEntryDTO, CreateFaqEntryRequest, FaqEmbedType, UpdateFaqEntryRequest } from "@mplus/contracts";
import { FAQ_EMBED_TYPE_OPTIONS } from "@mplus/contracts";
import { api } from "../api/client";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import FaqEmbeddedArtifact from "../components/faq/FaqEmbeddedArtifact.vue";

const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const entries = ref<AdminFaqEntryDTO[]>([]);
const showForm = ref(false);
const editingId = ref<string | null>(null);
const title = ref("");
const description = ref("");
const isPublished = ref(false);
const embedType = ref<FaqEmbedType | "">("");
const deleteTarget = ref<AdminFaqEntryDTO | null>(null);
const deleting = ref(false);
const formError = ref<string | null>(null);

const bannerText = computed(() => error.value || message.value || "");
const bannerTone = computed(() => (error.value ? "error" : "success"));
const formTitle = computed(() => (editingId.value ? "Edit FAQ entry" : "Add FAQ entry"));
const isEmpty = computed(() => !loading.value && entries.value.length === 0);

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.listAdminFaq();
    entries.value = response.entries;
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editingId.value = null;
  title.value = "";
  description.value = "";
  isPublished.value = false;
  embedType.value = "";
  showForm.value = true;
  formError.value = null;
  message.value = null;
  error.value = null;
}

function openEdit(entry: AdminFaqEntryDTO): void {
  editingId.value = entry.id;
  title.value = entry.title;
  description.value = entry.description;
  isPublished.value = entry.isPublished;
  embedType.value = entry.embedType ?? "";
  showForm.value = true;
  formError.value = null;
  message.value = null;
  error.value = null;
}

function cancelForm(): void {
  showForm.value = false;
  editingId.value = null;
  formError.value = null;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  formError.value = null;
  message.value = null;
  try {
    if (editingId.value) {
      const payload: UpdateFaqEntryRequest = {
        title: title.value,
        description: description.value,
        isPublished: isPublished.value,
        embedType: embedType.value === "" ? null : embedType.value,
      };
      const updated = await api.updateFaq(editingId.value, payload);
      entries.value = entries.value.map((entry) => (entry.id === updated.id ? updated : entry));
      message.value = "FAQ entry updated.";
    } else {
      const payload: CreateFaqEntryRequest = {
        title: title.value,
        description: description.value,
        isPublished: isPublished.value,
        embedType: embedType.value === "" ? null : embedType.value,
      };
      await api.createFaq(payload);
      message.value = "FAQ entry created.";
      await load();
    }
    showForm.value = false;
    editingId.value = null;
  } catch (err) {
    if (!handleAuthError(err)) formError.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function togglePublished(entry: AdminFaqEntryDTO): Promise<void> {
  error.value = null;
  try {
    const updated = await api.updateFaq(entry.id, { isPublished: !entry.isPublished });
    entries.value = entries.value.map((row) => (row.id === updated.id ? updated : row));
    message.value = updated.isPublished ? "FAQ entry published." : "FAQ entry unpublished.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  }
}

async function move(entry: AdminFaqEntryDTO, direction: "up" | "down"): Promise<void> {
  error.value = null;
  try {
    await api.moveFaq(entry.id, { direction });
    await load();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  deleting.value = true;
  error.value = null;
  try {
    const id = deleteTarget.value.id;
    await api.deleteFaq(id);
    entries.value = entries.value.filter((entry) => entry.id !== id);
    deleteTarget.value = null;
    message.value = "FAQ entry deleted.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

function previewDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function embedLabel(type: FaqEmbedType | null): string | null {
  if (!type) return null;
  return FAQ_EMBED_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="admin-faq" data-testid="admin-faq-page">
    <header class="admin-faq__header">
      <div>
        <p class="eyebrow">Admin</p>
        <h1>FAQ</h1>
        <p class="lede">Create, publish and order public FAQ entries. Descriptions are plain text.</p>
      </div>
      <button type="button" class="btn primary" data-testid="admin-faq-add" @click="openCreate">
        Add FAQ entry
      </button>
    </header>

    <StatusBanner v-if="bannerText" :tone="bannerTone">{{ bannerText }}</StatusBanner>
    <p v-if="loading" class="muted" data-testid="admin-faq-loading">Loading FAQ entries…</p>

    <p v-if="isEmpty" class="muted" data-testid="admin-faq-empty">
      No FAQ entries yet. Add the first question to publish it on the public FAQ page.
    </p>

    <div v-else-if="!loading && entries.length" class="table-wrap">
      <table class="faq-table" data-testid="admin-faq-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">State</th>
            <th scope="col">Embedded</th>
            <th scope="col">Order</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in entries" :key="entry.id" data-testid="admin-faq-row">
            <th scope="row" class="title-cell">
              <div class="title-stack">
                <span class="title-text">{{ entry.title }}</span>
                <p class="desc-preview">{{ previewDescription(entry.description) }}</p>
              </div>
            </th>
            <td>
              <span
                class="state-chip"
                :data-published="entry.isPublished ? 'true' : 'false'"
                :class="entry.isPublished ? 'state-chip--published' : 'state-chip--draft'"
              >
                {{ entry.isPublished ? "Published" : "Draft" }}
              </span>
            </td>
            <td class="embed-cell">
              <span v-if="entry.embedType" class="embed-label" data-testid="admin-faq-embed-label">
                {{ embedLabel(entry.embedType) }}
              </span>
              <span v-else class="embed-empty" aria-hidden="true">—</span>
            </td>
            <td class="order">
              <div class="order-group">
              <button
                type="button"
                class="icon-btn"
                :disabled="index === 0"
                data-testid="admin-faq-move-up"
                aria-label="Move up"
                title="Move up"
                @click="move(entry, 'up')"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 10l4-4 4 4"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="index === entries.length - 1"
                data-testid="admin-faq-move-down"
                aria-label="Move down"
                title="Move down"
                @click="move(entry, 'down')"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 6l4 4 4-4"
                  />
                </svg>
              </button>
              </div>
            </td>
            <td class="actions-cell">
              <div class="action-group">
              <button
                type="button"
                class="icon-btn"
                data-testid="admin-faq-edit"
                aria-label="Edit"
                title="Edit"
                @click="openEdit(entry)"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 13l2.2-.5L12.5 5.2a1.2 1.2 0 0 0 0-1.7L12.5 3a1.2 1.2 0 0 0-1.7 0L3.5 10.3 3 13z"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                data-testid="admin-faq-publish-toggle"
                :aria-label="entry.isPublished ? 'Unpublish' : 'Publish'"
                :title="entry.isPublished ? 'Unpublish' : 'Publish'"
                @click="togglePublished(entry)"
              >
                <svg
                  v-if="entry.isPublished"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z"
                  />
                  <circle cx="8" cy="8" r="1.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
                <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M2 8s2.4-4 6-4c1.1 0 2.1.3 3 .8M14 8s-.6 1-1.6 2M3 3l10 10M6.2 6.4A2 2 0 0 0 8 10c.3 0 .6 0 .8-.2"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--danger"
                data-testid="admin-faq-delete"
                aria-label="Delete"
                title="Delete"
                @click="deleteTarget = entry"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.5 5h9M6 5V3.8A.8.8 0 0 1 6.8 3h2.4a.8.8 0 0 1 .8.8V5M5 5.5l.4 7.2a.8.8 0 0 0 .8.8h3.6a.8.8 0 0 0 .8-.8L11 5.5"
                  />
                </svg>
              </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="showForm"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="faq-editor-title"
      data-testid="admin-faq-editor-modal"
      @click.self="cancelForm"
    >
      <form class="modal modal--editor" data-testid="admin-faq-form" @submit.prevent="save">
        <h2 id="faq-editor-title">{{ formTitle }}</h2>
        <StatusBanner v-if="formError" tone="error">{{ formError }}</StatusBanner>
        <label class="field">
          <span>Title</span>
          <input
            v-model="title"
            class="admin-control"
            data-testid="admin-faq-title"
            required
          />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea
            v-model="description"
            class="admin-control admin-control--area"
            rows="6"
            data-testid="admin-faq-description"
            required
          />
        </label>
        <label class="check">
          <input v-model="isPublished" type="checkbox" data-testid="admin-faq-published" />
          Published
        </label>
        <label class="field">
          <span>Embedded content</span>
          <select v-model="embedType" class="admin-control" data-testid="admin-faq-embed-type">
            <option v-for="option in FAQ_EMBED_TYPE_OPTIONS" :key="option.label" :value="option.value ?? ''">
              {{ option.label }}
            </option>
          </select>
        </label>
        <div v-if="embedType" class="preview" data-testid="admin-faq-artifact-preview">
          <p class="preview__label">Public artifact preview</p>
          <FaqEmbeddedArtifact :type="embedType" />
        </div>
        <div class="row-actions">
          <button type="button" class="btn ghost" :disabled="saving" @click="cancelForm">Cancel</button>
          <button type="submit" class="btn primary" data-testid="admin-faq-save" :disabled="saving">
            {{ saving ? "Saving…" : "Save" }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="deleteTarget"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="faq-delete-title"
      data-testid="delete-confirm-modal"
    >
      <div class="modal">
        <h2 id="faq-delete-title">Delete FAQ entry?</h2>
        <p>Permanently delete <strong>{{ deleteTarget.title }}</strong>? This cannot be undone.</p>
        <div class="row-actions">
          <button type="button" class="btn ghost" :disabled="deleting" @click="deleteTarget = null">
            Cancel
          </button>
          <button
            type="button"
            class="btn primary danger"
            :disabled="deleting"
            data-testid="confirm-delete"
            @click="confirmDelete"
          >
            {{ deleting ? "Deleting…" : "Delete" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-faq {
  max-width: 64rem;
  display: grid;
  gap: var(--space-5);
}

.admin-faq__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
  align-items: flex-start;
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-amber-400);
  font-weight: 700;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-3xl);
}

.lede,
.muted {
  color: var(--color-text-muted);
  margin: var(--space-2) 0 0;
}

.field {
  display: grid;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.admin-control--area {
  min-height: 8rem;
  resize: vertical;
  line-height: 1.5;
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
}

.preview {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-card);
}

.preview__label {
  margin: 0;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}

.faq-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.faq-table th,
.faq-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: middle;
}

.faq-table .title-cell {
  vertical-align: top;
}

.faq-table thead th {
  color: var(--color-text-muted);
  font-weight: 600;
}

.title-cell {
  width: 100%;
  min-width: 14rem;
  font-weight: 600;
}

.title-stack {
  display: grid;
  gap: 0.3rem;
  min-height: 3.4rem;
  align-content: start;
}

.title-text {
  display: block;
}

.desc-preview {
  margin: 0;
  color: var(--color-text-muted);
  font-weight: 400;
  font-size: var(--text-sm);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.state-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 1.4;
  text-transform: uppercase;
  white-space: nowrap;
}

.state-chip--published {
  color: var(--color-success-500);
  border-color: rgb(34 197 94 / 35%);
  background: rgb(34 197 94 / 10%);
}

.state-chip--draft {
  color: var(--color-amber-400);
  border-color: rgb(251 191 36 / 35%);
  background: rgb(251 191 36 / 10%);
}

.embed-cell {
  max-width: 11rem;
  vertical-align: middle;
}

.embed-label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.3;
}

.embed-empty {
  color: var(--color-text-muted);
  opacity: 0.45;
}

.faq-table .order,
.faq-table .actions-cell {
  white-space: nowrap;
  width: 1%;
  vertical-align: middle;
}

.order-group,
.action-group {
  display: inline-flex;
  align-items: center;
  gap: 0;
}

.action-group {
  gap: 0.15rem;
}

.order-group .icon-btn {
  width: 1.75rem;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  background: transparent;
  color: var(--color-text-muted);
}

.icon-btn:hover:not(:disabled) {
  color: var(--color-text);
  background: rgb(255 255 255 / 6%);
}

.icon-btn:disabled {
  opacity: 0.35;
}

.icon-btn--danger {
  color: var(--color-danger-500);
}

.btn.ghost {
  background: transparent;
  min-height: 2.25rem;
  padding: 0.35rem 0.7rem;
}

.btn.danger {
  color: var(--color-danger-500);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  display: grid;
  place-items: center;
  z-index: 50;
  padding: var(--space-4);
}

.modal {
  width: min(32rem, 100%);
  max-height: min(90vh, 56rem);
  overflow: auto;
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  display: grid;
  gap: var(--space-3);
}

.modal--editor {
  width: min(44rem, 100%);
}

.modal h2 {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-lg);
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  DRAFT_ABILITY_CATEGORIES,
  DRAFT_AVAILABILITIES,
  DRAFT_DIMENSION_TAGS,
  DRAFT_SOURCE_OWNERSHIPS,
} from "@mplus/abilities";
import { api } from "../../api/client";
import type { ManualCatalogEditDetail } from "../../api/types";
import { loadWowheadTooltipScript, refreshWowheadTooltips } from "../../integrations/wowhead/tooltips";
import { wowheadSpellUrl } from "../../integrations/wowhead/urls";
import StatusBanner from "../common/StatusBanner.vue";
import SpellWowIcon from "./SpellWowIcon.vue";

const props = defineProps<{
  open: boolean;
  canonicalKey: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

interface DraftForm {
  name: string;
  spellIds: number[];
  iconName: string | null;
  classSlug: string;
  specSlugsText: string;
  raceSlugsText: string;
  category: string;
  dimensionTags: string[];
  availability: string;
  cooldownSeconds: string;
  charges: string;
  sourceOwnership: string;
  notes: string;
  validFromBuild: string;
  validToBuild: string;
  provenanceSource: string;
}

const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const detail = ref<ManualCatalogEditDetail | null>(null);
const draftVersion = ref<number | null>(null);
const draftForm = ref<DraftForm>(emptyForm());

function emptyForm(): DraftForm {
  return {
    name: "",
    spellIds: [],
    iconName: null,
    classSlug: "",
    specSlugsText: "",
    raceSlugsText: "",
    category: "",
    dimensionTags: [],
    availability: "",
    cooldownSeconds: "",
    charges: "",
    sourceOwnership: "",
    notes: "",
    validFromBuild: "",
    validToBuild: "",
    provenanceSource: "",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function populateFormFromDraft(draft: unknown) {
  const d = asRecord(draft);
  const provenance = asRecord(d.provenance);
  draftForm.value = {
    name: String(d.name ?? ""),
    spellIds: asNumberArray(d.spellIds),
    iconName: typeof d.iconName === "string" ? d.iconName : null,
    classSlug: String(d.classSlug ?? ""),
    specSlugsText: asStringArray(d.specSlugs).join(", "),
    raceSlugsText: asStringArray(d.raceSlugs).join(", "),
    category: String(d.category ?? ""),
    dimensionTags: asStringArray(d.dimensionTags),
    availability: String(d.availability ?? ""),
    cooldownSeconds: d.cooldownSeconds != null ? String(d.cooldownSeconds) : "",
    charges: d.charges != null ? String(d.charges) : "",
    sourceOwnership: String(d.sourceOwnership ?? ""),
    notes: String(d.notes ?? ""),
    validFromBuild: String(d.validFromBuild ?? d.validityBuild ?? ""),
    validToBuild: String(d.validToBuild ?? provenance.validToBuild ?? ""),
    provenanceSource: String(provenance.source ?? "CURATED_OVERRIDE"),
  };
}

function parseCsvStrings(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function draftPayload(): Record<string, unknown> {
  const bindings = asRecord(detail.value?.draft).bindings;
  return {
    canonicalKey: props.canonicalKey,
    name: draftForm.value.name.trim(),
    spellIds: [...draftForm.value.spellIds],
    bindings: Array.isArray(bindings) ? bindings : [],
    iconName: draftForm.value.iconName,
    classSlug: draftForm.value.classSlug || null,
    specSlugs: parseCsvStrings(draftForm.value.specSlugsText),
    raceSlugs: parseCsvStrings(draftForm.value.raceSlugsText),
    category: draftForm.value.category || null,
    dimensionTags: [...draftForm.value.dimensionTags],
    availability: draftForm.value.availability || null,
    cooldownSeconds: draftForm.value.cooldownSeconds ? Number(draftForm.value.cooldownSeconds) : null,
    charges: draftForm.value.charges ? Number(draftForm.value.charges) : null,
    sourceOwnership: draftForm.value.sourceOwnership || null,
    notes: draftForm.value.notes || null,
    validFromBuild: draftForm.value.validFromBuild || null,
    validToBuild: draftForm.value.validToBuild || null,
    provenance: {
      source: draftForm.value.provenanceSource || "CURATED_OVERRIDE",
      verifiedAt: new Date().toISOString(),
      gameVersion: draftForm.value.validFromBuild || null,
    },
  };
}

const primarySpellId = computed(() => draftForm.value.spellIds[0] ?? null);

const aliasSpellIds = computed(() => {
  const active = asRecord(detail.value?.activeRule);
  return asNumberArray(active.aliases);
});

const spellIdRows = computed(() => {
  const primary = primarySpellId.value;
  const abilityName = draftForm.value.name.trim();
  return draftForm.value.spellIds.map((spellId) => {
    const isPrimary = spellId === primary;
    const isAlias = aliasSpellIds.value.includes(spellId) && !isPrimary;
    const label = isPrimary && abilityName ? abilityName : isAlias ? `Alias spell ${spellId}` : `Spell ${spellId}`;
    return {
      spellId,
      label,
      url: wowheadSpellUrl(spellId),
      isPrimary,
    };
  });
});

async function refreshTooltips(): Promise<void> {
  await nextTick();
  refreshWowheadTooltips();
}

async function loadDetail(): Promise<void> {
  if (!props.canonicalKey) return;
  loading.value = true;
  error.value = null;
  try {
    const loaded = await api.getManualCatalogEdit(props.canonicalKey);
    detail.value = loaded;
    draftVersion.value = loaded.draftVersion;
    if (loaded.draft) {
      populateFormFromDraft(loaded.draft);
    }
    await refreshTooltips();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load manual edit";
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const body: {
      draft: Record<string, unknown>;
      expectedVersion?: number;
    } = { draft: draftPayload() };
    if (draftVersion.value != null) body.expectedVersion = draftVersion.value;
    const saved = await api.saveManualCatalogEdit(props.canonicalKey, body);
    detail.value = saved;
    draftVersion.value = saved.draftVersion;
    if (saved.draft) populateFormFromDraft(saved.draft);
    emit("saved");
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save manual edit";
  } finally {
    saving.value = false;
  }
}

function toggleDimensionTag(tag: string): void {
  const tags = new Set(draftForm.value.dimensionTags);
  if (tags.has(tag)) tags.delete(tag);
  else tags.add(tag);
  draftForm.value.dimensionTags = [...tags];
}

watch(
  () => [props.open, props.canonicalKey] as const,
  ([open, key]) => {
    if (!open || !key) return;
    draftForm.value = emptyForm();
    detail.value = null;
    draftVersion.value = null;
    void loadWowheadTooltipScript().catch(() => {
      /* progressive enhancement */
    });
    void loadDetail();
  },
);
</script>

<template>
  <div v-if="open" class="manual-edit-overlay" data-testid="manual-edit-modal">
    <div
      class="manual-edit-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="`Edit ${draftForm.name || canonicalKey}`"
    >
      <header class="manual-edit-header" data-testid="manual-edit-header">
        <a
          v-if="primarySpellId && wowheadSpellUrl(primarySpellId)"
          class="manual-edit-header__icon-link"
          :href="wowheadSpellUrl(primarySpellId)!"
          target="_blank"
          rel="noopener noreferrer"
          :data-wowhead="`spell=${primarySpellId}`"
          :aria-label="`${draftForm.name || 'Spell'} on Wowhead`"
          data-testid="manual-edit-header-icon"
        >
          <SpellWowIcon
            :icon-name="draftForm.iconName"
            :spell-id="primarySpellId"
            :alt="draftForm.name"
            :width="44"
            :height="44"
          />
        </a>
        <SpellWowIcon
          v-else-if="primarySpellId"
          class="manual-edit-header__icon-static"
          :icon-name="draftForm.iconName"
          :spell-id="primarySpellId"
          :alt="draftForm.name"
          :width="44"
          :height="44"
        />
        <div class="manual-edit-header__text">
          <h3 class="manual-edit-header__title">{{ draftForm.name || "Catalog rule" }}</h3>
          <p class="manual-edit-header__slug mono" data-testid="manual-edit-slug">{{ canonicalKey }}</p>
        </div>
      </header>

      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>
      <p v-if="loading" class="muted">Loading rule…</p>

      <form v-else class="manual-edit-form" @submit.prevent="save">
        <label>
          Display name
          <input v-model="draftForm.name" class="admin-control" type="text" required />
        </label>

        <div class="spell-id-field">
          <span class="spell-id-field__label">Spell IDs</span>
          <ul v-if="spellIdRows.length" class="spell-id-list" data-testid="manual-edit-spell-list">
            <li v-for="row in spellIdRows" :key="row.spellId" class="spell-id-list__item">
              <a
                v-if="row.url"
                class="spell-id-link"
                :href="row.url"
                target="_blank"
                rel="noopener noreferrer"
                :data-wowhead="`spell=${row.spellId}`"
                :aria-label="`${row.label} on Wowhead (opens in new tab)`"
                data-testid="manual-edit-spell-link"
              >
                <SpellWowIcon
                  class="spell-id-link__icon"
                  :spell-id="row.spellId"
                  :alt="row.label"
                  :width="24"
                  :height="24"
                />
                <span class="spell-id-link__label">{{ row.label }}</span>
                <svg
                  class="spell-id-link__external"
                  viewBox="0 0 12 12"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M3.5 2H10v6.5M10 2 2 10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </a>
              <span v-else class="spell-id-link spell-id-link--static">
                <SpellWowIcon
                  class="spell-id-link__icon"
                  :spell-id="row.spellId"
                  :alt="row.label"
                  :width="24"
                  :height="24"
                />
                <span class="spell-id-link__label">{{ row.label }}</span>
              </span>
            </li>
          </ul>
          <p v-else class="muted spell-id-empty">No spell IDs on this rule.</p>
        </div>

        <label>
          Class
          <input v-model="draftForm.classSlug" class="admin-control" type="text" />
        </label>
        <label>
          Specs (csv)
          <input v-model="draftForm.specSlugsText" class="admin-control" type="text" />
        </label>
        <label>
          Races (csv)
          <input v-model="draftForm.raceSlugsText" class="admin-control" type="text" />
        </label>
        <label>
          Category *
          <select v-model="draftForm.category" class="admin-control" data-testid="manual-edit-category" required>
            <option value="">—</option>
            <option v-for="c in DRAFT_ABILITY_CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <fieldset class="tag-fieldset">
          <legend>Dimensions</legend>
          <div class="tag-fieldset__grid">
            <label
              v-for="tag in DRAFT_DIMENSION_TAGS"
              :key="tag"
              class="tag-toggle"
              :class="{ 'tag-toggle--active': draftForm.dimensionTags.includes(tag) }"
            >
              <input
                type="checkbox"
                class="tag-toggle__input"
                :checked="draftForm.dimensionTags.includes(tag)"
                @change="toggleDimensionTag(tag)"
              />
              <span class="tag-toggle__label">{{ tag }}</span>
            </label>
          </div>
        </fieldset>
        <label>
          Availability
          <select v-model="draftForm.availability" class="admin-control">
            <option value="">—</option>
            <option v-for="a in DRAFT_AVAILABILITIES" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <label>
          Cooldown (seconds)
          <input
            v-model="draftForm.cooldownSeconds"
            class="admin-control"
            type="number"
            min="0"
            data-testid="manual-edit-cooldown"
          />
        </label>
        <label>
          Charges
          <input v-model="draftForm.charges" class="admin-control" type="number" min="0" />
        </label>
        <label>
          Ownership
          <select v-model="draftForm.sourceOwnership" class="admin-control">
            <option value="">—</option>
            <option v-for="o in DRAFT_SOURCE_OWNERSHIPS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label>
          Valid from build
          <input v-model="draftForm.validFromBuild" class="admin-control" type="text" />
        </label>
        <label>
          Valid to build
          <input v-model="draftForm.validToBuild" class="admin-control" type="text" />
        </label>
        <label>
          Provenance source
          <input v-model="draftForm.provenanceSource" class="admin-control" type="text" />
        </label>
        <label>
          Notes
          <textarea v-model="draftForm.notes" class="admin-control" rows="3" />
        </label>

        <p
          v-if="detail?.draftValidation && !detail.draftValidation.readyForPublishReview"
          class="field-hint field-hint--warn"
        >
          Draft is incomplete for release candidate inclusion.
        </p>

        <div class="manual-edit-actions">
          <button type="button" class="btn secondary" :disabled="saving" @click="emit('close')">
            Cancel
          </button>
          <button type="submit" class="btn primary" :disabled="saving" data-testid="manual-edit-save">
            {{ saving ? "Saving…" : "Save draft" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.manual-edit-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2rem 1rem;
  background: color-mix(in srgb, var(--bg) 35%, transparent);
  backdrop-filter: blur(2px);
}

.manual-edit-dialog {
  width: min(720px, 100%);
  max-height: calc(100vh - 4rem);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  padding: 1rem 1.25rem;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--fg) 12%, transparent);
}

.manual-edit-header {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.manual-edit-header__icon-link {
  display: inline-flex;
  flex-shrink: 0;
  border-radius: 6px;
  line-height: 0;
  text-decoration: none;
}

.manual-edit-header__icon-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.manual-edit-header__icon-static {
  flex-shrink: 0;
}

.manual-edit-header__text {
  min-width: 0;
}

.manual-edit-header__title {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.25;
}

.manual-edit-header__slug {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.82rem;
  word-break: break-word;
}

.spell-id-field {
  display: grid;
  gap: 0.35rem;
}

.spell-id-field__label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
}

.spell-id-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}

.spell-id-link {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--fg);
  text-decoration: none;
  font-size: 0.9rem;
  max-width: 100%;
}

.spell-id-link:hover,
.spell-id-link:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
  outline: none;
}

.spell-id-link--static {
  cursor: default;
}

.spell-id-link__icon {
  flex-shrink: 0;
}

.spell-id-link__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spell-id-link__external {
  flex-shrink: 0;
  color: var(--muted);
}

.spell-id-link:hover .spell-id-link__external,
.spell-id-link:focus-visible .spell-id-link__external {
  color: var(--accent);
}

.spell-id-empty {
  margin: 0;
  font-size: 0.85rem;
}

.manual-edit-form {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.manual-edit-form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.manual-edit-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.tag-fieldset {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
}

.tag-fieldset__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.75rem;
}

.tag-toggle--active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.tag-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mono {
  font-family: ui-monospace, monospace;
}

.muted {
  color: var(--muted);
}

.field-hint--warn {
  color: var(--warn);
  font-size: 0.85rem;
}
</style>

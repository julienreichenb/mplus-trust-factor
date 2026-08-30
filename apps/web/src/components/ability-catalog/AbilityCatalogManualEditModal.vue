<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { DRAFT_ABILITY_CATEGORIES } from "@mplus/abilities";
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

const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const detail = ref<ManualCatalogEditDetail | null>(null);
const draftVersion = ref<number | null>(null);
const category = ref("");

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

function populateBusinessFieldsFromDraft(draft: unknown) {
  const d = asRecord(draft);
  category.value = String(d.category ?? "");
}

function formatAvailabilityLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unknown source availability";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const sourceFacts = computed(() => {
  const draft = asRecord(detail.value?.draft);
  const active = asRecord(detail.value?.activeRule);
  const provenance = asRecord(draft.provenance ?? active.provenance);
  const spellIds = asNumberArray(draft.spellIds).length
    ? asNumberArray(draft.spellIds)
    : asNumberArray(active.spellIds);
  const cooldown = draft.cooldownSeconds ?? active.cooldownSeconds;
  const charges = draft.charges ?? active.charges;
  return {
    name: String(draft.name ?? active.name ?? ""),
    spellIds,
    iconName: typeof draft.iconName === "string" ? draft.iconName : (active.iconName as string | null) ?? null,
    classSlug: String(draft.classSlug ?? active.classSlug ?? "—"),
    specSlugs: asStringArray(draft.specSlugs ?? active.specSlugs).join(", ") || "—",
    raceSlugs: asStringArray(draft.raceSlugs ?? active.raceSlugs).join(", ") || "—",
    cooldownSeconds: cooldown != null ? String(cooldown) : "—",
    charges: charges != null ? String(charges) : "—",
    sourceOwnership: String(draft.sourceOwnership ?? active.sourceOwnership ?? "—"),
    validFromBuild: String(draft.validFromBuild ?? draft.validityBuild ?? provenance.validFromBuild ?? "—"),
    validToBuild: String(draft.validToBuild ?? provenance.validToBuild ?? "—"),
    provenanceSource: String(provenance.source ?? "—"),
    dimensionTags: asStringArray(draft.dimensionTags),
    availability: formatAvailabilityLabel(draft.availability ?? active.availability),
  };
});

const primarySpellId = computed(() => sourceFacts.value.spellIds[0] ?? null);

const aliasSpellIds = computed(() => {
  const active = asRecord(detail.value?.activeRule);
  return asNumberArray(active.aliases);
});

const spellIdRows = computed(() => {
  const primary = primarySpellId.value;
  const abilityName = sourceFacts.value.name.trim();
  return sourceFacts.value.spellIds.map((spellId) => {
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

function businessPayload(): { category: string | null } {
  return {
    category: category.value || null,
  };
}

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
      populateBusinessFieldsFromDraft(loaded.draft);
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
      draft: { category: string | null };
      expectedVersion?: number;
    } = { draft: businessPayload() };
    if (draftVersion.value != null) body.expectedVersion = draftVersion.value;
    const saved = await api.saveManualCatalogEdit(props.canonicalKey, body);
    detail.value = saved;
    draftVersion.value = saved.draftVersion;
    if (saved.draft) populateBusinessFieldsFromDraft(saved.draft);
    emit("saved");
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save manual edit";
  } finally {
    saving.value = false;
  }
}

watch(
  () => [props.open, props.canonicalKey] as const,
  ([open, key]) => {
    if (!open || !key) return;
    category.value = "";
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
      :aria-label="`Edit ${sourceFacts.name || canonicalKey}`"
    >
      <header class="manual-edit-header" data-testid="manual-edit-header">
        <a
          v-if="primarySpellId && wowheadSpellUrl(primarySpellId)"
          class="manual-edit-header__icon-link"
          :href="wowheadSpellUrl(primarySpellId)!"
          target="_blank"
          rel="noopener noreferrer"
          :data-wowhead="`spell=${primarySpellId}`"
          :aria-label="`${sourceFacts.name || 'Spell'} on Wowhead`"
          data-testid="manual-edit-header-icon"
        >
          <SpellWowIcon
            :icon-name="sourceFacts.iconName"
            :spell-id="primarySpellId"
            :alt="sourceFacts.name"
            :width="44"
            :height="44"
          />
        </a>
        <SpellWowIcon
          v-else-if="primarySpellId"
          class="manual-edit-header__icon-static"
          :icon-name="sourceFacts.iconName"
          :spell-id="primarySpellId"
          :alt="sourceFacts.name"
          :width="44"
          :height="44"
        />
        <div class="manual-edit-header__text">
          <h3 class="manual-edit-header__title">{{ sourceFacts.name || "Catalog rule" }}</h3>
          <p class="manual-edit-header__slug mono" data-testid="manual-edit-slug">{{ canonicalKey }}</p>
        </div>
      </header>

      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>
      <p v-if="loading" class="muted">Loading rule…</p>

      <form v-else class="manual-edit-form" @submit.prevent="save">
        <section class="source-facts" aria-label="Source facts (read-only)">
          <h4 class="section-title">Source facts</h4>
          <p class="section-hint muted">WoW/provider data — not editable here.</p>
          <dl class="source-facts__grid">
            <div><dt>Name</dt><dd>{{ sourceFacts.name || "—" }}</dd></div>
            <div><dt>Class</dt><dd>{{ sourceFacts.classSlug }}</dd></div>
            <div><dt>Specs</dt><dd>{{ sourceFacts.specSlugs }}</dd></div>
            <div><dt>Races</dt><dd>{{ sourceFacts.raceSlugs }}</dd></div>
            <div><dt>Cooldown</dt><dd data-testid="manual-edit-cooldown-readonly">{{ sourceFacts.cooldownSeconds }}s</dd></div>
            <div><dt>Charges</dt><dd>{{ sourceFacts.charges }}</dd></div>
            <div><dt>Ownership</dt><dd>{{ sourceFacts.sourceOwnership }}</dd></div>
            <div><dt>Valid from build</dt><dd>{{ sourceFacts.validFromBuild }}</dd></div>
            <div><dt>Valid to build</dt><dd>{{ sourceFacts.validToBuild }}</dd></div>
            <div><dt>Provenance</dt><dd>{{ sourceFacts.provenanceSource }}</dd></div>
            <div class="source-facts__wide">
              <dt>Compiled dimensions</dt>
              <dd>{{ sourceFacts.dimensionTags.join(", ") || "—" }}</dd>
            </div>
          </dl>
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
        </section>

        <section class="business-metadata" aria-label="Trust Factor semantics">
          <h4 class="section-title">Trust Factor semantics</h4>
          <label>
            Category *
            <select v-model="category" class="admin-control" data-testid="manual-edit-category" required>
              <option value="">—</option>
              <option v-for="c in DRAFT_ABILITY_CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <div class="source-availability" data-testid="manual-edit-availability">
            <span class="source-availability__label">Availability</span>
            <span class="source-availability__value">{{ sourceFacts.availability }}</span>
          </div>
        </section>

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

.section-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}

.section-hint {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
}

.source-facts,
.business-metadata {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--border);
}

.source-facts__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}

.source-facts__grid dt {
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
}

.source-facts__grid dd {
  margin: 0.1rem 0 0;
  font-size: 0.9rem;
}

.source-facts__wide {
  grid-column: 1 / -1;
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

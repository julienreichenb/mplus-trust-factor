<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ExBossVoiceAlert } from "../../lib/exboss-voice-pack-manifest";
import {
  alertFamilyKey,
  familyLabel,
  indexesInFamily,
  suggestBulkTargets,
  type BulkSuggestionReason,
} from "../../lib/exboss-voice-pack-bulk";
import {
  voicePackUiState,
  type VoicePackAlertState,
} from "../../lib/exboss-voice-pack-storage";
import VoicePackMediaIcon from "./VoicePackMediaIcon.vue";

const props = defineProps<{
  open: boolean;
  sourceAlert: ExBossVoiceAlert;
  alerts: readonly ExBossVoiceAlert[];
  alertStates: readonly VoicePackAlertState[];
  hasSourceCustom: boolean;
  busy?: boolean;
  playingIndex: number | null;
}>();

const emit = defineEmits<{
  close: [];
  playEnglish: [index: number];
  stopPlayback: [];
  applyExisting: [indexes: number[]];
  recordForSelected: [indexes: number[]];
}>();

const query = ref("");
const selected = ref<Set<number>>(new Set());
const showAll = ref(false);

const sourceFamily = computed(() => alertFamilyKey(props.sourceAlert.filename));

const suggestions = computed(() =>
  suggestBulkTargets(props.alerts, props.sourceAlert.index),
);

const suggestedIndexes = computed(() => new Set(suggestions.value.map((row) => row.index)));

const reasonByIndex = computed(() => {
  const map = new Map<number, BulkSuggestionReason[]>();
  for (const row of suggestions.value) map.set(row.index, row.reasons);
  return map;
});

const visibleAlerts = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const base = showAll.value
    ? props.alerts.filter((alert) => alert.index !== props.sourceAlert.index)
    : props.alerts.filter((alert) => suggestedIndexes.value.has(alert.index));

  if (!needle) return base;
  return base.filter(
    (alert) =>
      alert.englishCue.toLowerCase().includes(needle) ||
      alert.filename.toLowerCase().includes(needle) ||
      alert.label.toLowerCase().includes(needle),
  );
});

const selectedCount = computed(() => selected.value.size);
const familyIndexes = computed(() =>
  indexesInFamily(props.alerts, sourceFamily.value, props.sourceAlert.index),
);

function isSelected(index: number): boolean {
  return selected.value.has(index);
}

function toggle(index: number): void {
  const next = new Set(selected.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  selected.value = next;
}

function selectFamily(): void {
  const next = new Set(selected.value);
  for (const index of familyIndexes.value) next.add(index);
  selected.value = next;
}

function selectSuggested(): void {
  selected.value = new Set(suggestedIndexes.value);
}

function clearSelected(): void {
  selected.value = new Set();
}

function reasonLabel(reasons: BulkSuggestionReason[] | undefined): string {
  if (!reasons?.length) return "";
  const parts: string[] = [];
  if (reasons.includes("family")) parts.push("Same family");
  if (reasons.includes("similar")) parts.push("Similar cue");
  return parts.join(" · ");
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = "";
    showAll.value = false;
    selected.value = new Set(suggestedIndexes.value);
  },
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-if="open"
    class="bulk-overlay"
    data-testid="voice-pack-bulk-modal"
    @click.self="emit('close')"
  >
    <div
      class="bulk-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-pack-bulk-title"
    >
      <header class="bulk-dialog__header">
        <div>
          <p class="eyebrow">Bulk replace</p>
          <h2 id="voice-pack-bulk-title">Apply one voice to similar alerts</h2>
          <p class="bulk-dialog__lede">
            Source:
            <strong>{{ sourceAlert.englishCue }}</strong>
            <span class="mpts-data"> · {{ sourceAlert.filename }}</span>
          </p>
        </div>
        <button
          type="button"
          class="btn link"
          data-testid="voice-pack-bulk-close"
          @click="emit('close')"
        >
          Close
        </button>
      </header>

      <div class="bulk-dialog__toolbar">
        <input
          class="bulk-dialog__search"
          type="search"
          data-testid="voice-pack-bulk-search"
          aria-label="Filter alerts"
          placeholder="Filter alerts"
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value"
        />
        <div class="bulk-dialog__chips">
          <button
            type="button"
            class="bulk-chip"
            data-testid="voice-pack-bulk-select-family"
            @click="selectFamily()"
          >
            Select {{ familyLabel(sourceFamily) }}
          </button>
          <button
            type="button"
            class="bulk-chip"
            data-testid="voice-pack-bulk-select-suggested"
            @click="selectSuggested()"
          >
            Select suggested
          </button>
          <button type="button" class="bulk-chip" @click="clearSelected()">Clear</button>
          <button
            type="button"
            class="bulk-chip"
            data-testid="voice-pack-bulk-toggle-all"
            @click="showAll = !showAll"
          >
            {{ showAll ? "Show suggestions" : "Browse all alerts" }}
          </button>
        </div>
      </div>

      <ul class="bulk-dialog__list" data-testid="voice-pack-bulk-list">
        <li v-if="visibleAlerts.length === 0" class="bulk-dialog__empty">No matching alerts.</li>
        <li
          v-for="alert in visibleAlerts"
          :key="alert.index"
          class="bulk-row"
          :data-testid="`voice-pack-bulk-row-${alert.index}`"
        >
          <label class="bulk-row__check">
            <input
              type="checkbox"
              :checked="isSelected(alert.index)"
              :data-testid="`voice-pack-bulk-check-${alert.index}`"
              @change="toggle(alert.index)"
            />
            <span class="bulk-row__body">
              <span class="bulk-row__cue">{{ alert.englishCue }}</span>
              <span class="bulk-row__meta">
                <span class="mpts-data">{{ alert.filename }}</span>
                <span class="bulk-row__state">
                  {{ voicePackUiState(alertStates[alert.index]) === "custom" ? "Custom" : "Original" }}
                </span>
                <span v-if="reasonByIndex.get(alert.index)" class="bulk-row__reason">
                  {{ reasonLabel(reasonByIndex.get(alert.index)) }}
                </span>
              </span>
            </span>
          </label>
          <button
            type="button"
            class="bulk-row__play"
            :data-testid="`voice-pack-bulk-play-${alert.index}`"
            :aria-label="
              playingIndex === alert.index
                ? `Stop ${alert.englishCue}`
                : `Play original ${alert.englishCue}`
            "
            @click="
              playingIndex === alert.index
                ? emit('stopPlayback')
                : emit('playEnglish', alert.index)
            "
          >
            <VoicePackMediaIcon :kind="playingIndex === alert.index ? 'stop' : 'play'" />
          </button>
        </li>
      </ul>

      <footer class="bulk-dialog__footer">
        <p class="bulk-dialog__count" data-testid="voice-pack-bulk-count">
          {{ selectedCount }} selected
        </p>
        <div class="bulk-dialog__actions">
          <button
            type="button"
            class="btn secondary"
            data-testid="voice-pack-bulk-record"
            :disabled="busy || selectedCount === 0"
            @click="emit('recordForSelected', [...selected])"
          >
            Record once for selected
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="voice-pack-bulk-apply"
            :disabled="busy || !hasSourceCustom || selectedCount === 0"
            @click="emit('applyExisting', [...selected])"
          >
            Use current custom
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.bulk-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: rgb(0 0 0 / 55%);
}

.bulk-dialog {
  width: min(42rem, 100%);
  max-height: min(88vh, 44rem);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-elevated, 0 18px 40px rgb(0 0 0 / 35%));
}

.bulk-dialog__header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: start;
}

.bulk-dialog__header h2 {
  margin: 0.15rem 0 var(--space-2);
  font-size: var(--text-xl);
}

.bulk-dialog__lede {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.bulk-dialog__toolbar {
  display: grid;
  gap: var(--space-2);
}

.bulk-dialog__search {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font: inherit;
}

.bulk-dialog__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.bulk-chip {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 700;
  padding: 0.35rem 0.65rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-surface-hover);
  color: var(--color-text);
  cursor: pointer;
}

.bulk-chip:hover {
  border-color: var(--color-gold-300);
}

.bulk-dialog__list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
}

.bulk-dialog__empty {
  padding: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.bulk-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--color-border);
}

.bulk-row:last-child {
  border-bottom: none;
}

.bulk-row__check {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  cursor: pointer;
}

.bulk-row__cue {
  display: block;
  font-size: var(--text-sm);
  font-weight: 600;
}

.bulk-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  margin-top: 0.15rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.bulk-row__state {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bulk-row__reason {
  color: var(--color-gold-300);
}

.bulk-row__play {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.bulk-row__play:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.bulk-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.bulk-dialog__count {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.bulk-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>

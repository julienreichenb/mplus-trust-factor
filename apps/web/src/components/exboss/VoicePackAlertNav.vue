<script setup lang="ts">
import { computed, nextTick, onUpdated, ref, watch } from "vue";
import type { ExBossVoiceAlert } from "../../lib/exboss-voice-pack-manifest";
import {
  voicePackUiState,
  type VoicePackAlertState,
} from "../../lib/exboss-voice-pack-storage";
import VoicePackMediaIcon from "./VoicePackMediaIcon.vue";

const props = defineProps<{
  alerts: readonly ExBossVoiceAlert[];
  alertStates: readonly VoicePackAlertState[];
  currentIndex: number;
  disabled?: boolean;
  playingIndex: number | null;
  searchInputId?: string;
}>();

const emit = defineEmits<{
  select: [index: number];
  play: [index: number];
  stopPlayback: [];
}>();

const listEl = ref<HTMLElement | null>(null);
const query = ref("");

const filteredAlerts = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.alerts;
  return props.alerts.filter((alert) => {
    return (
      alert.englishCue.toLowerCase().includes(needle) ||
      alert.filename.toLowerCase().includes(needle) ||
      alert.label.toLowerCase().includes(needle)
    );
  });
});

function uiLabel(state: VoicePackAlertState | undefined): string {
  return voicePackUiState(state) === "custom" ? "Custom" : "Original";
}

function isPlaying(index: number): boolean {
  return props.playingIndex === index;
}

function onPlayClick(event: MouseEvent, index: number): void {
  event.stopPropagation();
  if (isPlaying(index)) emit("stopPlayback");
  else emit("play", index);
}

function scrollCurrentIntoView(): void {
  const root = listEl.value;
  if (!root) return;
  const active = root.querySelector<HTMLElement>("[data-current='true']");
  if (active && typeof active.scrollIntoView === "function") {
    active.scrollIntoView({ block: "nearest" });
  }
}

watch(
  () => props.currentIndex,
  async () => {
    await nextTick();
    scrollCurrentIntoView();
  },
);

onUpdated(() => {
  scrollCurrentIntoView();
});
</script>

<template>
  <nav class="alert-nav" aria-label="Alert list" data-testid="voice-pack-alert-nav">
    <div class="alert-nav__list">
      <div class="alert-nav__search">
        <input
          :id="searchInputId ?? 'voice-pack-alert-search'"
          class="alert-nav__search-input"
          type="search"
          :data-testid="searchInputId ?? 'voice-pack-alert-search'"
          aria-label="Search alerts"
          placeholder="Search alerts"
          autocomplete="off"
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value"
        />
      </div>
      <ul ref="listEl" class="alert-nav__items">
        <li v-for="alert in filteredAlerts" :key="alert.index">
          <div
            class="alert-nav__row"
            :class="{
              'is-current': alert.index === currentIndex,
              [`is-${voicePackUiState(alertStates[alert.index])}`]: true,
            }"
          >
            <button
              type="button"
              class="alert-nav__item"
              :disabled="disabled"
              :aria-current="alert.index === currentIndex ? 'true' : undefined"
              :data-current="alert.index === currentIndex ? 'true' : 'false'"
              :data-testid="`voice-pack-alert-${alert.index}`"
              @click="emit('select', alert.index)"
            >
              <span class="alert-nav__cue">{{ alert.englishCue }}</span>
              <span class="alert-nav__meta">
                <span class="alert-nav__file mpts-data">{{ alert.filename }}</span>
                <span class="alert-nav__state">{{ uiLabel(alertStates[alert.index]) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="alert-nav__play"
              :disabled="disabled"
              :data-testid="`voice-pack-nav-play-${alert.index}`"
              :aria-label="
                isPlaying(alert.index)
                  ? `Stop ${alert.englishCue}`
                  : `Play ${alert.englishCue}`
              "
              @click="onPlayClick($event, alert.index)"
            >
              <VoicePackMediaIcon :kind="isPlaying(alert.index) ? 'stop' : 'play'" />
            </button>
          </div>
        </li>
      </ul>
      <p v-if="filteredAlerts.length === 0" class="alert-nav__empty">No matching alerts.</p>
    </div>
  </nav>
</template>

<style scoped>
.alert-nav {
  min-height: 0;
  height: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  overflow: hidden;
}

.alert-nav__list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(70vh, 40rem);
}

.alert-nav__search {
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.alert-nav__search-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
}

.alert-nav__search-input:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}

.alert-nav__items {
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  overflow: auto;
  display: grid;
  gap: 0.2rem;
  align-content: start;
}

.alert-nav__empty {
  margin: 0;
  padding: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.alert-nav__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
}

.alert-nav__row.is-current {
  border-color: var(--color-brand);
  background: rgb(245 158 11 / 10%);
}

.alert-nav__item {
  width: 100%;
  display: grid;
  gap: 0.2rem;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--color-text);
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  font: inherit;
}

.alert-nav__item:disabled,
.alert-nav__play:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.alert-nav__row:hover:not(:has(:disabled)),
.alert-nav__row:focus-within:not(:has(:disabled)) {
  background: var(--color-surface-hover);
}

.alert-nav__row.is-current:hover:not(:has(:disabled)) {
  background: rgb(245 158 11 / 10%);
}

.alert-nav__play {
  display: grid;
  place-items: center;
  width: 2.4rem;
  border: 0;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 0;
}

.alert-nav__play:hover:not(:disabled),
.alert-nav__play:focus-visible:not(:disabled) {
  color: var(--color-brand);
}

.alert-nav__cue {
  font-size: var(--text-sm);
  font-weight: 600;
}

.alert-nav__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  align-items: baseline;
}

.alert-nav__file {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-nav__state {
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-info-500);
}

.alert-nav__row.is-custom .alert-nav__state {
  color: var(--color-success-500);
}
</style>

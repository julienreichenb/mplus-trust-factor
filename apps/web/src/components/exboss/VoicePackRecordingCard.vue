<script setup lang="ts">
import type { ExBossVoiceAlert } from "../../lib/exboss-voice-pack-manifest";
import {
  voicePackUiState,
  type VoicePackAlertState,
} from "../../lib/exboss-voice-pack-storage";
import VoicePackMediaIcon from "./VoicePackMediaIcon.vue";

const props = defineProps<{
  alert: ExBossVoiceAlert;
  currentIndex: number;
  totalCount: number;
  state: VoicePackAlertState;
  recording: boolean;
  encoding: boolean;
  busy: boolean;
  playingSource: "english" | "custom" | null;
  customUrl: string | null;
  referenceError: string | null;
  remainingMs: number;
  recordingProgressPercent: number;
  maxRecordingMs: number;
  englishDurationMs: number | null;
}>();

const emit = defineEmits<{
  playEnglish: [];
  playCustom: [];
  stopPlayback: [];
  startRecording: [];
  stopRecording: [];
  markFallback: [];
  deleteCustom: [];
  openBulkReplace: [];
  previous: [];
  next: [];
}>();

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

const uiState = () => voicePackUiState(props.state);
</script>

<template>
  <article
    class="record-card"
    data-testid="voice-pack-recording-card"
    tabindex="0"
  >
    <header class="record-card__header">
      <p class="eyebrow">Alert {{ currentIndex + 1 }} of {{ totalCount }}</p>
      <h2 class="record-card__cue">{{ alert.englishCue }}</h2>
      <p class="record-card__file mpts-data">{{ alert.filename }}</p>
      <p class="record-card__state" data-testid="voice-pack-alert-state">
        {{ uiState() === "custom" ? "Custom" : "Original" }}
      </p>
    </header>

    <section class="record-card__section">
      <div class="record-card__actions">
        <button
          v-if="playingSource !== 'english'"
          type="button"
          class="btn secondary"
          data-testid="voice-pack-play-english"
          aria-label="Play original audio"
          :disabled="recording || encoding"
          @click="emit('playEnglish')"
        >
          <VoicePackMediaIcon kind="play" />
          Play original
          <span
            v-if="englishDurationMs != null"
            class="record-card__duration mpts-data"
            data-testid="voice-pack-english-duration"
          >
            {{ formatSeconds(englishDurationMs) }}s
          </span>
        </button>
        <button
          v-else
          type="button"
          class="btn secondary"
          data-testid="voice-pack-stop-english"
          aria-label="Stop original audio"
          @click="emit('stopPlayback')"
        >
          <VoicePackMediaIcon kind="stop" />
          Stop original
        </button>
      </div>
      <p
        v-if="referenceError"
        class="record-card__hint record-card__hint--error"
        data-testid="voice-pack-reference-error"
      >
        {{ referenceError }}
      </p>
    </section>

    <section class="record-card__section" aria-labelledby="custom-rec-heading">
      <h3 id="custom-rec-heading">Your recording</h3>

      <div
        v-if="recording"
        class="record-card__recording"
        data-testid="voice-pack-recording-active"
        role="status"
        aria-live="polite"
      >
        <p class="record-card__recording-label">
          Recording… {{ formatSeconds(remainingMs) }}s left
        </p>
        <div
          class="record-card__meter"
          role="progressbar"
          :aria-valuenow="recordingProgressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`Recording ${recordingProgressPercent} percent of ${formatSeconds(maxRecordingMs)} seconds`"
        >
          <div class="record-card__meter-fill" :style="{ width: `${recordingProgressPercent}%` }" />
        </div>
        <button
          type="button"
          class="btn danger"
          data-testid="voice-pack-stop-recording"
          aria-label="Stop recording"
          @click="emit('stopRecording')"
        >
          Stop
        </button>
      </div>

      <p
        v-else-if="encoding"
        class="record-card__hint"
        data-testid="voice-pack-encoding"
        role="status"
        aria-live="polite"
      >
        Converting to MP3…
      </p>

      <div v-else class="record-card__actions">
        <button
          type="button"
          class="btn primary"
          data-testid="voice-pack-record"
          :aria-label="uiState() === 'custom' ? 'Re-record custom voice' : 'Record custom voice'"
          :disabled="busy"
          @click="emit('startRecording')"
        >
          {{ uiState() === "custom" ? "Re-record" : "Record voice" }}
        </button>
        <button
          v-if="uiState() === 'custom'"
          type="button"
          class="btn secondary"
          data-testid="voice-pack-keep-english"
          aria-label="Keep original audio for this alert"
          :disabled="busy"
          @click="emit('markFallback')"
        >
          Keep original
        </button>
        <button
          v-if="customUrl"
          type="button"
          class="btn secondary"
          data-testid="voice-pack-play-custom"
          :aria-label="playingSource === 'custom' ? 'Stop custom recording playback' : 'Play custom recording'"
          @click="playingSource === 'custom' ? emit('stopPlayback') : emit('playCustom')"
        >
          <VoicePackMediaIcon :kind="playingSource === 'custom' ? 'stop' : 'play'" />
          {{ playingSource === "custom" ? "Stop playback" : "Play custom" }}
        </button>
        <button
          v-if="uiState() === 'custom'"
          type="button"
          class="btn danger"
          data-testid="voice-pack-delete-custom"
          aria-label="Delete custom recording"
          :disabled="busy"
          @click="emit('deleteCustom')"
        >
          Delete recording
        </button>
        <button
          type="button"
          class="btn secondary"
          data-testid="voice-pack-bulk-replace"
          aria-label="Bulk replace similar alerts"
          :disabled="busy"
          @click="emit('openBulkReplace')"
        >
          Bulk replace…
        </button>
      </div>
    </section>

    <footer class="record-card__nav">
      <button
        type="button"
        class="btn secondary"
        data-testid="voice-pack-previous"
        aria-label="Previous alert"
        :disabled="busy || currentIndex <= 0"
        @click="emit('previous')"
      >
        Previous
      </button>
      <button
        type="button"
        class="btn secondary"
        data-testid="voice-pack-next"
        aria-label="Next alert"
        :disabled="busy || currentIndex >= totalCount - 1"
        @click="emit('next')"
      >
        Next
      </button>
    </footer>
  </article>
</template>

<style scoped>
.record-card {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.record-card:focus {
  outline: none;
}

.record-card:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}

.record-card__header {
  display: grid;
  gap: var(--space-2);
}

.record-card__cue {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-2xl);
  line-height: 1.2;
}

.record-card__file,
.record-card__state,
.record-card__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.record-card__hint--error {
  color: var(--color-danger-500);
}

.record-card__section {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.record-card__section h3 {
  margin: 0;
  font-size: var(--text-base);
}

.record-card__actions,
.record-card__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.record-card__actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.record-card__duration {
  font-weight: 600;
  color: var(--color-text-muted);
}

.record-card__recording {
  display: grid;
  gap: var(--space-3);
  align-items: start;
}

.record-card__recording-label {
  margin: 0;
  font-weight: 700;
  color: var(--color-brand);
}

.record-card__meter {
  height: 0.55rem;
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 8%);
  overflow: hidden;
}

.record-card__meter-fill {
  height: 100%;
  width: 0;
  background: var(--color-danger-500);
}

@media (prefers-reduced-motion: reduce) {
  .record-card__meter-fill {
    transition: none;
  }
}
</style>

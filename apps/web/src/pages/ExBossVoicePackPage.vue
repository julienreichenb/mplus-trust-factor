<script setup lang="ts">
import { onMounted } from "vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import VoicePackAlertNav from "../components/exboss/VoicePackAlertNav.vue";
import VoicePackBulkReplaceModal from "../components/exboss/VoicePackBulkReplaceModal.vue";
import VoicePackExportBar from "../components/exboss/VoicePackExportBar.vue";
import VoicePackRecordingCard from "../components/exboss/VoicePackRecordingCard.vue";
import { useExBossVoicePackWizard } from "../composables/useExBossVoicePackWizard";
import type { VoicePackSession } from "../lib/exboss-voice-pack-session";
import type { buildVoicePackZip } from "../lib/exboss-voice-pack-export";

const props = defineProps<{
  session?: VoicePackSession;
  confirmReset?: () => boolean;
  buildZip?: typeof buildVoicePackZip;
  downloadZip?: (bytes: Uint8Array, filename: string) => void;
}>();

const {
  alerts,
  currentIndex,
  currentAlert,
  alertStates,
  totalCount,
  customCount,
  recording,
  encoding,
  busy,
  hydrating,
  hydrated,
  uiError,
  referenceError,
  currentState,
  currentCustomUrl,
  playingSource,
  playingIndex,
  recordingRemainingMs,
  recordingProgressPercent,
  mobileNavOpen,
  maxRecordingMs,
  packName,
  packNameValidation,
  addonDirectory,
  canExport,
  exporting,
  exportSuccess,
  navLocked,
  englishDurationMs,
  bulkModalOpen,
  bulkSuccess,
  hydrate,
  selectAlert,
  next,
  previous,
  markFallback,
  startRecording,
  stopRecording,
  deleteCustom,
  startOver,
  setPackName,
  playEnglish,
  playCustom,
  playEffective,
  stopPlayback,
  toggleMobileNav,
  exportPack,
  openBulkReplace,
  closeBulkReplace,
  applyBulkExisting,
  recordBulkForSelected,
} = useExBossVoicePackWizard({
  session: props.session,
  confirmReset: props.confirmReset,
  buildZip: props.buildZip,
  downloadZip: props.downloadZip,
});

onMounted(() => {
  void hydrate();
});
</script>

<template>
  <section class="voice-pack-page" data-testid="exboss-voice-pack-page">
    <header class="voice-pack-page__header">
      <div>
        <p class="eyebrow">Tools</p>
        <h1>ExBoss Voice Pack Builder</h1>
        <p class="voice-pack-page__lede">
          Record a custom ExBoss voice pack in your browser. Alerts you skip keep the original
          English voice. Drafts stay on this device.
        </p>
      </div>
      <button
        type="button"
        class="btn link"
        data-testid="voice-pack-start-over"
        :disabled="busy || hydrating || exporting"
        @click="startOver()"
      >
        Start over
      </button>
    </header>

    <StatusBanner
      v-if="uiError"
      tone="error"
      :message="uiError"
      data-testid="voice-pack-error"
    />
    <StatusBanner
      v-else-if="bulkSuccess"
      tone="success"
      :message="bulkSuccess"
      data-testid="voice-pack-bulk-success"
    />

    <p v-if="hydrating" class="muted" data-testid="voice-pack-loading">
      Restoring your draft…
    </p>

    <template v-else-if="hydrated">
      <VoicePackExportBar
        :pack-name="packName"
        :pack-name-validation="packNameValidation"
        :addon-directory="addonDirectory"
        :can-export="canExport"
        :exporting="exporting"
        :export-success="exportSuccess"
        :custom-count="customCount"
        :total-count="totalCount"
        @update-pack-name="setPackName"
        @export="exportPack()"
      />

      <div class="voice-pack-page__layout">
        <aside class="voice-pack-page__sidebar" aria-label="Desktop alert navigation">
          <VoicePackAlertNav
            :alerts="alerts"
            :alert-states="alertStates"
            :current-index="currentIndex"
            :disabled="navLocked"
            :playing-index="playingIndex"
            search-input-id="voice-pack-alert-search-desktop"
            @select="selectAlert"
            @play="playEffective"
            @stop-playback="stopPlayback()"
          />
        </aside>

        <div class="voice-pack-page__main">
          <div class="voice-pack-page__mobile-nav" data-testid="voice-pack-mobile-nav">
            <button
              type="button"
              class="btn secondary"
              data-testid="voice-pack-mobile-nav-toggle"
              :aria-expanded="mobileNavOpen ? 'true' : 'false'"
              aria-controls="voice-pack-mobile-alert-list"
              @click="toggleMobileNav()"
            >
              {{ mobileNavOpen ? "Hide alerts" : "Browse alerts" }}
            </button>
            <div
              v-show="mobileNavOpen"
              id="voice-pack-mobile-alert-list"
              class="voice-pack-page__mobile-panel"
            >
              <VoicePackAlertNav
                :alerts="alerts"
                :alert-states="alertStates"
                :current-index="currentIndex"
                :disabled="navLocked"
                :playing-index="playingIndex"
                search-input-id="voice-pack-alert-search-mobile"
                @select="selectAlert"
                @play="playEffective"
                @stop-playback="stopPlayback()"
              />
            </div>
          </div>

          <VoicePackRecordingCard
            :alert="currentAlert"
            :current-index="currentIndex"
            :total-count="totalCount"
            :state="currentState"
            :recording="recording"
            :encoding="encoding"
            :busy="busy"
            :playing-source="playingSource"
            :custom-url="currentCustomUrl"
            :reference-error="referenceError"
            :remaining-ms="recordingRemainingMs"
            :recording-progress-percent="recordingProgressPercent"
            :max-recording-ms="maxRecordingMs"
            :english-duration-ms="englishDurationMs"
            @play-english="playEnglish()"
            @play-custom="playCustom()"
            @stop-playback="stopPlayback()"
            @start-recording="startRecording()"
            @stop-recording="stopRecording()"
            @mark-fallback="markFallback()"
            @delete-custom="deleteCustom()"
            @open-bulk-replace="openBulkReplace()"
            @previous="previous()"
            @next="next()"
          />
        </div>
      </div>

      <VoicePackBulkReplaceModal
        :open="bulkModalOpen"
        :source-alert="currentAlert"
        :alerts="alerts"
        :alert-states="alertStates"
        :has-source-custom="Boolean(currentCustomUrl) || currentState === 'custom'"
        :busy="busy || recording || encoding || exporting"
        :playing-index="playingIndex"
        @close="closeBulkReplace()"
        @play-english="playEnglish"
        @stop-playback="stopPlayback()"
        @apply-existing="applyBulkExisting"
        @record-for-selected="recordBulkForSelected"
      />
    </template>
  </section>
</template>

<style scoped>
.voice-pack-page {
  display: grid;
  gap: var(--space-5);
}

.voice-pack-page__header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  align-items: start;
  flex-wrap: wrap;
}

.voice-pack-page__header h1 {
  margin: 0.2rem 0 var(--space-2);
}

.voice-pack-page__lede {
  margin: 0;
  max-width: 42rem;
  color: var(--color-text-muted);
}

.voice-pack-page__layout {
  display: grid;
  gap: var(--space-5);
}

.voice-pack-page__sidebar {
  display: none;
}

.voice-pack-page__main {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.voice-pack-page__mobile-panel {
  margin-top: var(--space-3);
}

@media (min-width: 960px) {
  .voice-pack-page__layout {
    grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr);
    align-items: start;
  }

  .voice-pack-page__sidebar {
    display: block;
    position: sticky;
    top: 5.5rem;
  }

  .voice-pack-page__mobile-nav {
    display: none;
  }
}
</style>

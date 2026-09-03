import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  addonDirectoryName,
  buildVoicePackZip,
  validatePackName,
  type VoicePackZipResult,
} from "../lib/exboss-voice-pack-export";
import {
  downloadZipBytes,
  voicePackZipFilename,
} from "../lib/exboss-voice-pack-download";
import { MAX_RECORDING_DURATION_MS } from "../lib/exboss-voice-pack-recorder";
import {
  createVoicePackSession,
  type VoicePackSession,
} from "../lib/exboss-voice-pack-session";
import {
  voicePackUiState,
  type VoicePackAlertState,
} from "../lib/exboss-voice-pack-storage";
import { voicePackErrorMessage } from "../lib/exboss-voice-pack-ui-errors";
import { buildExBossEnglishReferenceUrl } from "../lib/exboss-voice-pack-reference-audio";

export type VoicePackWizardView = "record";

export interface UseExBossVoicePackWizardOptions {
  session?: VoicePackSession;
  confirmReset?: () => boolean;
  now?: () => number;
  buildZip?: typeof buildVoicePackZip;
  downloadZip?: (bytes: Uint8Array, filename: string) => void;
}

export function useExBossVoicePackWizard(options: UseExBossVoicePackWizardOptions = {}) {
  const session = options.session ?? createVoicePackSession();
  const confirmReset = options.confirmReset ?? (() => window.confirm(
    "Start over? This clears every recording and English choice in this browser.",
  ));
  const now = options.now ?? (() => Date.now());
  const buildZip = options.buildZip ?? buildVoicePackZip;
  const downloadZip = options.downloadZip ?? downloadZipBytes;

  const hydrated = ref(false);
  const hydrating = ref(false);
  const busy = ref(false);
  const uiError = ref<string | null>(null);
  const recordingStartedAt = ref<number | null>(null);
  const elapsedMs = ref(0);
  const playingSource = ref<"english" | "custom" | null>(null);
  const playingIndex = ref<number | null>(null);
  const referenceError = ref<string | null>(null);
  const mobileNavOpen = ref(false);
  const view = ref<VoicePackWizardView>("record");
  const exporting = ref(false);
  const exportSuccess = ref<string | null>(null);
  const englishDurationMs = ref<number | null>(null);
  const bulkModalOpen = ref(false);
  const pendingBulkTargets = ref<number[] | null>(null);
  const pendingBulkSourceIndex = ref<number | null>(null);
  const bulkSuccess = ref<string | null>(null);
  let durationProbeToken = 0;

  const revision = ref(0);
  const customObjectUrls = shallowRef(new Map<number, string>());
  const customBlobRefs = new Map<number, Blob>();

  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let busyTimer: ReturnType<typeof setInterval> | null = null;
  let englishAudio: HTMLAudioElement | null = null;
  let customAudio: HTMLAudioElement | null = null;

  function bump(): void {
    revision.value += 1;
    hydrated.value = session.state.hydrated;
  }

  function clearElapsedTimer(): void {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function clearBusyTimer(): void {
    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = null;
    }
  }

  function syncObjectUrls(): void {
    const next = new Map<number, string>();
    const previous = customObjectUrls.value;
    for (const [index, blob] of session.state.customMp3s) {
      const existingUrl = previous.get(index);
      if (existingUrl && customBlobRefs.get(index) === blob) {
        next.set(index, existingUrl);
      } else {
        if (existingUrl) URL.revokeObjectURL(existingUrl);
        next.set(index, URL.createObjectURL(blob));
        customBlobRefs.set(index, blob);
      }
    }
    for (const [index, url] of previous) {
      if (!next.has(index)) {
        URL.revokeObjectURL(url);
        customBlobRefs.delete(index);
      }
    }
    customObjectUrls.value = next;
  }

  function revokeAllObjectUrls(): void {
    for (const url of customObjectUrls.value.values()) {
      URL.revokeObjectURL(url);
    }
    customObjectUrls.value = new Map();
    customBlobRefs.clear();
  }

  function stopAudio(): void {
    if (englishAudio) {
      englishAudio.pause();
      englishAudio.src = "";
      englishAudio = null;
    }
    if (customAudio) {
      customAudio.pause();
      customAudio.src = "";
      customAudio = null;
    }
    playingSource.value = null;
    playingIndex.value = null;
  }

  function startElapsedWatch(): void {
    clearElapsedTimer();
    recordingStartedAt.value = now();
    elapsedMs.value = 0;
    elapsedTimer = setInterval(() => {
      if (!session.state.recording) {
        clearElapsedTimer();
        elapsedMs.value = 0;
        recordingStartedAt.value = null;
        bump();
        return;
      }
      const started = recordingStartedAt.value ?? now();
      elapsedMs.value = Math.min(MAX_RECORDING_DURATION_MS, Math.max(0, now() - started));
      bump();
    }, 100);
  }

  function watchBusyUntilIdle(): void {
    clearBusyTimer();
    busy.value = true;
    busyTimer = setInterval(() => {
      bump();
      syncObjectUrls();
      if (session.state.lastError) {
        uiError.value = voicePackErrorMessage(session.state.lastError);
        pendingBulkTargets.value = null;
        pendingBulkSourceIndex.value = null;
      }
      if (!session.state.recording && !session.state.encoding) {
        clearBusyTimer();
        clearElapsedTimer();
        recordingStartedAt.value = null;
        elapsedMs.value = 0;
        busy.value = false;
        bump();
        syncObjectUrls();
        void flushPendingBulkApply();
      }
    }, 100);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if ((busy.value && !session.state.recording) || exporting.value) return;
    uiError.value = null;
    referenceError.value = null;
    busy.value = true;
    try {
      await action();
      bump();
      syncObjectUrls();
    } catch (error) {
      uiError.value = voicePackErrorMessage(error);
      bump();
    } finally {
      if (!session.state.recording && !session.state.encoding) {
        busy.value = false;
      }
    }
  }

  const alerts = computed(() => {
    void revision.value;
    return session.alerts;
  });
  const currentIndex = computed(() => {
    void revision.value;
    return session.state.currentIndex;
  });
  const currentAlert = computed(() => alerts.value[currentIndex.value]!);
  const alertStates = computed(() => {
    void revision.value;
    return session.state.alertStates as VoicePackAlertState[];
  });
  const totalCount = computed(() => {
    void revision.value;
    return session.totalCount;
  });
  const customCount = computed(() => {
    void revision.value;
    return session.customCount;
  });
  const fallbackCount = computed(() => {
    void revision.value;
    return session.fallbackCount;
  });
  const pendingCount = computed(() => {
    void revision.value;
    return session.pendingCount;
  });
  const completionPercent = computed(() => {
    void revision.value;
    return session.completionPercent;
  });
  const recording = computed(() => {
    void revision.value;
    return session.state.recording;
  });
  const encoding = computed(() => {
    void revision.value;
    return session.state.encoding;
  });
  const reviewReady = computed(() => {
    void revision.value;
    return session.reviewReady;
  });
  const currentUiState = computed(() => voicePackUiState(currentState.value));
  const packName = computed(() => {
    void revision.value;
    return session.state.packName;
  });
  const packNameValidation = computed(() => validatePackName(packName.value));
  const addonDirectory = computed(() =>
    packNameValidation.value.ok ? addonDirectoryName(packNameValidation.value.packName) : null,
  );
  const exportReady = computed(() => {
    void revision.value;
    return session.exportReady;
  });
  const canExport = computed(
    () =>
      exportReady.value &&
      !exporting.value &&
      !busy.value &&
      !recording.value &&
      !encoding.value,
  );
  const currentState = computed(() => alertStates.value[currentIndex.value] ?? "pending");
  const currentCustomUrl = computed(() => customObjectUrls.value.get(currentIndex.value) ?? null);
  const currentReferenceUrl = computed(() =>
    buildExBossEnglishReferenceUrl(currentAlert.value.filename),
  );
  const recordingRemainingMs = computed(() =>
    Math.max(0, MAX_RECORDING_DURATION_MS - elapsedMs.value),
  );
  const recordingProgressPercent = computed(() =>
    Math.round((elapsedMs.value / MAX_RECORDING_DURATION_MS) * 100),
  );
  const navLocked = computed(
    () => (busy.value && !recording.value) || encoding.value || exporting.value,
  );
  const firstPendingIndex = computed(() => alertStates.value.findIndex((s) => s === "pending"));

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  }

  function probeEnglishDuration(filename: string, url: string): void {
    const token = ++durationProbeToken;
    englishDurationMs.value = null;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (token !== durationProbeToken) return;
      const seconds = audio.duration;
      englishDurationMs.value = Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onerror = () => {
      if (token !== durationProbeToken) return;
      englishDurationMs.value = null;
    };
    audio.src = url;
    void filename;
  }

  async function hydrate(): Promise<void> {
    hydrating.value = true;
    uiError.value = null;
    try {
      await session.hydrate();
      syncObjectUrls();
      bump();
    } catch (error) {
      uiError.value = voicePackErrorMessage(error);
    } finally {
      hydrating.value = false;
      hydrated.value = session.state.hydrated;
    }
  }

  async function selectAlert(index: number): Promise<void> {
    if ((busy.value && !session.state.recording) || exporting.value) return;
    stopAudio();
    mobileNavOpen.value = false;
    await run(async () => {
      await session.selectAlert(index);
    });
  }

  async function next(): Promise<void> {
    if ((busy.value && !session.state.recording) || exporting.value) return;
    stopAudio();
    await run(async () => {
      await session.next();
    });
  }

  async function previous(): Promise<void> {
    if ((busy.value && !session.state.recording) || exporting.value) return;
    stopAudio();
    await run(async () => {
      await session.previous();
    });
  }

  async function markFallback(): Promise<void> {
    stopAudio();
    await run(async () => {
      await session.markFallback();
    });
  }

  async function startRecording(): Promise<void> {
    stopAudio();
    uiError.value = null;
    referenceError.value = null;
    exportSuccess.value = null;
    try {
      await session.startRecording();
      bump();
      startElapsedWatch();
      watchBusyUntilIdle();
    } catch (error) {
      pendingBulkTargets.value = null;
      pendingBulkSourceIndex.value = null;
      uiError.value = voicePackErrorMessage(error);
      busy.value = false;
      bump();
    }
  }

  async function stopRecording(): Promise<void> {
    try {
      await session.stopRecording();
      bump();
      syncObjectUrls();
    } catch (error) {
      uiError.value = voicePackErrorMessage(error);
      bump();
    }
  }

  async function deleteCustom(): Promise<void> {
    stopAudio();
    await run(async () => {
      await session.deleteCustom();
    });
  }

  async function startOver(): Promise<void> {
    if (!confirmReset()) return;
    stopAudio();
    clearElapsedTimer();
    clearBusyTimer();
    exportSuccess.value = null;
    bulkSuccess.value = null;
    pendingBulkTargets.value = null;
    pendingBulkSourceIndex.value = null;
    bulkModalOpen.value = false;
    await run(async () => {
      await session.reset();
      revokeAllObjectUrls();
    });
  }

  async function setPackName(value: string): Promise<void> {
    exportSuccess.value = null;
    await session.setPackName(value);
    bump();
  }

  async function flushPendingBulkApply(): Promise<void> {
    const targets = pendingBulkTargets.value;
    const sourceIndex = pendingBulkSourceIndex.value ?? currentIndex.value;
    if (!targets || targets.length === 0) return;
    pendingBulkTargets.value = null;
    pendingBulkSourceIndex.value = null;
    if (voicePackUiState(alertStates.value[sourceIndex]) !== "custom") return;
    try {
      const applied = await session.applyCustomToAlerts(sourceIndex, targets);
      bump();
      syncObjectUrls();
      bulkSuccess.value =
        applied > 0
          ? `Applied this recording to ${applied} other alert${applied === 1 ? "" : "s"}.`
          : null;
    } catch (error) {
      uiError.value = voicePackErrorMessage(error);
    }
  }

  function openBulkReplace(): void {
    if (recording.value || encoding.value || exporting.value) return;
    stopAudio();
    bulkSuccess.value = null;
    uiError.value = null;
    bulkModalOpen.value = true;
  }

  function closeBulkReplace(): void {
    stopAudio();
    bulkModalOpen.value = false;
  }

  async function applyBulkExisting(targetIndexes: number[]): Promise<void> {
    if (!currentCustomUrl.value && currentUiState.value !== "custom") return;
    bulkModalOpen.value = false;
    stopAudio();
    await run(async () => {
      const applied = await session.applyCustomToAlerts(currentIndex.value, targetIndexes);
      bulkSuccess.value =
        applied > 0
          ? `Applied this recording to ${applied} other alert${applied === 1 ? "" : "s"}.`
          : null;
    });
  }

  async function recordBulkForSelected(targetIndexes: number[]): Promise<void> {
    if (recording.value || encoding.value || exporting.value) return;
    pendingBulkSourceIndex.value = currentIndex.value;
    pendingBulkTargets.value = [...new Set(targetIndexes)].filter(
      (index) => index !== currentIndex.value,
    );
    bulkModalOpen.value = false;
    bulkSuccess.value = null;
    await startRecording();
  }

  async function keepCurrent(): Promise<void> {
    if ((busy.value && !session.state.recording) || exporting.value) return;
    if (recording.value || encoding.value) return;
    const hadCustom = Boolean(currentCustomUrl.value) || currentUiState.value === "custom";
    if (!hadCustom) {
      await markFallback();
    }
    if (currentIndex.value < totalCount.value - 1) {
      await next();
    }
  }

  function openReview(): void {
    stopAudio();
    exportSuccess.value = null;
    uiError.value = null;
  }

  function backToRecordings(): void {
    stopAudio();
    view.value = "record";
  }

  async function editFromReview(index: number): Promise<void> {
    view.value = "record";
    await selectAlert(index);
  }

  async function jumpToPending(): Promise<void> {
    const index = firstPendingIndex.value;
    if (index < 0) return;
    view.value = "record";
    await selectAlert(index);
  }

  function playUrl(
    url: string,
    source: "english" | "custom",
    index: number,
    onError: (message: string) => void,
  ): void {
    stopAudio();
    const audio = new Audio(url);
    if (source === "english") englishAudio = audio;
    else customAudio = audio;
    playingSource.value = source;
    playingIndex.value = index;
    audio.onended = () => {
      if ((source === "english" ? englishAudio : customAudio) === audio) {
        playingSource.value = null;
        playingIndex.value = null;
      }
    };
    audio.onerror = () => {
      onError(
        source === "english"
          ? "English reference audio could not be played."
          : "Custom recording could not be played.",
      );
      if ((source === "english" ? englishAudio : customAudio) === audio) {
        playingSource.value = null;
        playingIndex.value = null;
        if (source === "english") englishAudio = null;
        else customAudio = null;
      }
    };
    void audio.play().catch(() => {
      onError(
        source === "english"
          ? "English reference audio could not be played."
          : "Custom recording could not be played.",
      );
      playingSource.value = null;
      playingIndex.value = null;
      if (source === "english") englishAudio = null;
      else customAudio = null;
    });
  }

  function playEnglish(index = currentIndex.value): void {
    const alert = alerts.value[index];
    if (!alert) return;
    referenceError.value = null;
    playUrl(buildExBossEnglishReferenceUrl(alert.filename), "english", index, (message) => {
      referenceError.value = message;
    });
  }

  function playCustom(index = currentIndex.value): void {
    const url = customObjectUrls.value.get(index);
    if (!url) return;
    playUrl(url, "custom", index, (message) => {
      uiError.value = message;
    });
  }

  function playEffective(index: number): void {
    if (voicePackUiState(alertStates.value[index]) === "custom") playCustom(index);
    else playEnglish(index);
  }

  function stopPlayback(): void {
    stopAudio();
  }

  function toggleMobileNav(): void {
    mobileNavOpen.value = !mobileNavOpen.value;
  }

  async function exportPack(): Promise<void> {
    if (!canExport.value || exporting.value) return;
    stopAudio();
    exporting.value = true;
    exportSuccess.value = null;
    uiError.value = null;
    try {
      const customSounds = session.customSoundsForExport();
      const result: VoicePackZipResult = await buildZip({
        packName: session.state.packName,
        customSounds,
        alerts: session.alerts,
      });
      const filename = voicePackZipFilename(result.addonDirectory);
      downloadZip(result.zipBytes, filename);
      exportSuccess.value = `Downloaded ${filename}. Your draft is still saved locally.`;
      bump();
    } catch (error) {
      uiError.value =
        error instanceof Error && error.message
          ? error.message
          : "ZIP export failed. Your draft was kept.";
      bump();
    } finally {
      exporting.value = false;
    }
  }

  async function dispose(): Promise<void> {
    clearElapsedTimer();
    clearBusyTimer();
    stopAudio();
    revokeAllObjectUrls();
    await session.dispose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!hydrated.value || hydrating.value) return;
    if (isEditableTarget(event.target)) return;
    if (recording.value || encoding.value || exporting.value) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      void previous();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      void next();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void keepCurrent();
    }
  }

  watch(
    () => currentAlert.value?.filename,
    (filename) => {
      if (!filename) {
        englishDurationMs.value = null;
        return;
      }
      probeEnglishDuration(filename, buildExBossEnglishReferenceUrl(filename));
    },
    { immediate: true },
  );

  onMounted(() => {
    window.addEventListener("keydown", onKeydown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown);
    void dispose();
  });

  return {
    session,
    view,
    alerts,
    currentIndex,
    currentAlert,
    alertStates,
    totalCount,
    customCount,
    fallbackCount,
    pendingCount,
    completionPercent,
    recording,
    encoding,
    busy,
    hydrating,
    hydrated,
    uiError,
    referenceError,
    currentState,
    currentUiState,
    currentCustomUrl,
    currentReferenceUrl,
    playingSource,
    playingIndex,
    elapsedMs,
    recordingRemainingMs,
    recordingProgressPercent,
    englishDurationMs,
    bulkModalOpen,
    bulkSuccess,
    mobileNavOpen,
    maxRecordingMs: MAX_RECORDING_DURATION_MS,
    reviewReady,
    packName,
    packNameValidation,
    addonDirectory,
    exportReady,
    canExport,
    exporting,
    exportSuccess,
    firstPendingIndex,
    navLocked,
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
    keepCurrent,
    openBulkReplace,
    closeBulkReplace,
    applyBulkExisting,
    recordBulkForSelected,
    openReview,
    backToRecordings,
    editFromReview,
    jumpToPending,
    playEnglish,
    playCustom,
    playEffective,
    stopPlayback,
    toggleMobileNav,
    exportPack,
    dispose,
  };
}

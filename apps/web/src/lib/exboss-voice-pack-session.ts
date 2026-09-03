import { encodeRecordingToMp3, type Mp3EncodeEngine } from "./exboss-voice-pack-encoder";
import { validatePackName } from "./exboss-voice-pack-export";
import { EXBOSS_VOICE_ALERTS, type ExBossVoiceAlert } from "./exboss-voice-pack-manifest";
import {
  createVoicePackRecorder,
  VoicePackRecordingError,
  type VoicePackRecorder,
  type VoicePackRecorderEnvironment,
  type VoicePackRecordingResult,
} from "./exboss-voice-pack-recorder";
import {
  createIndexedDbDraftStore,
  emptyDraftMeta,
  type VoicePackAlertState,
  type VoicePackDraftMeta,
  type VoicePackDraftStore,
} from "./exboss-voice-pack-storage";

export interface VoicePackSessionState {
  packName: string;
  currentIndex: number;
  alertStates: VoicePackAlertState[];
  customMp3s: Map<number, Blob>;
  recording: boolean;
  encoding: boolean;
  hydrated: boolean;
  lastError: unknown | null;
}

export interface VoicePackSessionOptions {
  alerts?: readonly ExBossVoiceAlert[];
  store?: VoicePackDraftStore;
  recorder?: VoicePackRecorder;
  recorderEnvironment?: VoicePackRecorderEnvironment;
  encodeEngine?: Mp3EncodeEngine;
}

export interface VoicePackSession {
  readonly state: VoicePackSessionState;
  readonly alerts: readonly ExBossVoiceAlert[];
  readonly totalCount: number;
  readonly customCount: number;
  readonly fallbackCount: number;
  readonly pendingCount: number;
  readonly completionPercent: number;
  readonly reviewReady: boolean;
  readonly exportReady: boolean;
  hydrate(): Promise<void>;
  setPackName(packName: string): Promise<void>;
  selectAlert(index: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  markFallback(index?: number): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  deleteCustom(index?: number): Promise<void>;
  applyCustomToAlerts(sourceIndex: number, targetIndexes: readonly number[]): Promise<number>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  customSoundsForExport(): Map<number, Blob>;
}

export function createVoicePackSession(
  options: VoicePackSessionOptions = {},
): VoicePackSession {
  const alerts = options.alerts ?? EXBOSS_VOICE_ALERTS;
  const store = options.store ?? createIndexedDbDraftStore();
  const recorder =
    options.recorder ?? createVoicePackRecorder(options.recorderEnvironment ?? {});
  const encodeEngine = options.encodeEngine;
  const state: VoicePackSessionState = {
    packName: "",
    currentIndex: 0,
    alertStates: emptyDraftMeta(alerts.length).alertStates,
    customMp3s: new Map(),
    recording: false,
    encoding: false,
    hydrated: false,
    lastError: null,
  };

  let recordingGate: Promise<void> | null = null;
  let recordingGeneration = 0;
  let starting = false;

  function metaFromState(): VoicePackDraftMeta {
    return {
      schemaVersion: 1,
      packName: state.packName,
      currentIndex: state.currentIndex,
      alertStates: [...state.alertStates],
    };
  }

  async function persistMeta(): Promise<void> {
    await store.saveMeta(metaFromState());
  }

  function counts(): { custom: number; fallback: number; pending: number } {
    let custom = 0;
    let fallback = 0;
    let pending = 0;
    for (const status of state.alertStates) {
      if (status === "custom") custom += 1;
      else if (status === "fallback") fallback += 1;
      else pending += 1;
    }
    return { custom, fallback, pending };
  }

  function hasRequiredCustomBlobs(): boolean {
    return state.alertStates.every((status, index) => {
      if (status !== "custom") return true;
      const blob = state.customMp3s.get(index);
      return Boolean(blob && blob.size > 0);
    });
  }

  async function abandonInFlightRecording(): Promise<void> {
    // Encoding already owns a captured alert index — let it finish there.
    if (state.encoding) {
      await recorder.cancel();
      state.recording = false;
      const gate = recordingGate;
      if (gate) {
        try {
          await gate;
        } catch {
          // Encode/follow errors are stored on the session when relevant.
        }
      }
      return;
    }
    if (!state.recording && !recordingGate && !starting && !recorder.starting) {
      return;
    }
    recordingGeneration += 1;
    await recorder.cancel();
    state.recording = false;
    const gate = recordingGate;
    recordingGate = null;
    if (gate) {
      try {
        await gate;
      } catch {
        // Abandoned recording errors are intentional.
      }
    }
    state.encoding = false;
  }

  async function commitRecording(
    result: VoicePackRecordingResult,
    index: number,
    generation: number,
  ): Promise<void> {
    if (generation !== recordingGeneration) return;
    state.encoding = true;
    state.lastError = null;
    try {
      const mp3 = await encodeRecordingToMp3(result.blob, encodeEngine);
      if (generation !== recordingGeneration) return;
      await store.putMp3(index, mp3);
      if (generation !== recordingGeneration) {
        await store.deleteMp3(index).catch(() => undefined);
        return;
      }
      state.customMp3s.set(index, mp3);
      state.alertStates[index] = "custom";
      await persistMeta();
    } finally {
      state.encoding = false;
      state.recording = false;
    }
  }

  async function followRecording(index: number, generation: number): Promise<void> {
    try {
      const result = await recorder.waitUntilComplete();
      if (!result || generation !== recordingGeneration) {
        state.recording = false;
        return;
      }
      await commitRecording(result, index, generation);
    } catch (error) {
      state.recording = false;
      state.encoding = false;
      if (generation === recordingGeneration) {
        state.lastError = error;
        throw error;
      }
    }
  }

  return {
    state,
    alerts,

    get totalCount() {
      return alerts.length;
    },
    get customCount() {
      return counts().custom;
    },
    get fallbackCount() {
      return counts().fallback;
    },
    get pendingCount() {
      return counts().pending;
    },
    get completionPercent() {
      if (alerts.length === 0) return 100;
      const { custom, fallback } = counts();
      return Math.round(((custom + fallback) / alerts.length) * 100);
    },
    get reviewReady() {
      return counts().pending === 0;
    },
    get exportReady() {
      return (
        validatePackName(state.packName).ok &&
        hasRequiredCustomBlobs() &&
        !state.recording &&
        !state.encoding
      );
    },

    async hydrate(): Promise<void> {
      const draft = await store.load(alerts.length);
      if (!draft) {
        state.packName = "";
        state.currentIndex = 0;
        state.alertStates = emptyDraftMeta(alerts.length).alertStates;
        state.customMp3s = new Map();
        state.hydrated = true;
        state.lastError = null;
        await persistMeta();
        return;
      }
      state.packName = draft.meta.packName;
      state.currentIndex = draft.meta.currentIndex;
      state.alertStates = [...draft.meta.alertStates];
      state.customMp3s = new Map(draft.mp3s);
      state.hydrated = true;
      state.lastError = null;
      await persistMeta();
    },

    async setPackName(packName: string): Promise<void> {
      // Persist the human-visible draft as typed. Validity is enforced by exportReady / ZIP build.
      state.packName = typeof packName === "string" ? packName : "";
      await persistMeta();
    },

    async selectAlert(index: number): Promise<void> {
      if (!Number.isInteger(index) || index < 0 || index >= alerts.length) {
        throw new RangeError(`Alert index ${index} is out of range.`);
      }
      await abandonInFlightRecording();
      state.currentIndex = index;
      await persistMeta();
    },

    async next(): Promise<void> {
      const index = Math.min(state.currentIndex + 1, alerts.length - 1);
      await this.selectAlert(index);
    },

    async previous(): Promise<void> {
      const index = Math.max(state.currentIndex - 1, 0);
      await this.selectAlert(index);
    },

    async markFallback(index = state.currentIndex): Promise<void> {
      if (!Number.isInteger(index) || index < 0 || index >= alerts.length) {
        throw new RangeError(`Alert index ${index} is out of range.`);
      }
      await abandonInFlightRecording();
      await store.deleteMp3(index);
      state.customMp3s.delete(index);
      state.alertStates[index] = "fallback";
      await persistMeta();
    },

    async startRecording(): Promise<void> {
      if (state.recording || state.encoding || recordingGate || starting || recorder.starting) {
        throw new VoicePackRecordingError("ALREADY_RECORDING");
      }
      state.lastError = null;
      starting = true;
      const generation = ++recordingGeneration;
      const index = state.currentIndex;
      try {
        await recorder.start();
        if (generation !== recordingGeneration) {
          await recorder.cancel();
          return;
        }
        if (!recorder.recording) {
          // Cancelled during getUserMedia / start race.
          return;
        }
        state.recording = true;
        const gate = followRecording(index, generation)
          .catch((error) => {
            if (generation === recordingGeneration) {
              state.lastError = error;
            }
          })
          .finally(() => {
            if (recordingGate === gate) recordingGate = null;
          });
        recordingGate = gate;
      } finally {
        starting = false;
      }
    },

    async stopRecording(): Promise<void> {
      if (!state.recording) {
        throw new VoicePackRecordingError("NOT_RECORDING");
      }
      const generation = recordingGeneration;
      await recorder.stop();
      if (recordingGate) await recordingGate;
      if (generation === recordingGeneration && state.lastError) throw state.lastError;
    },

    async deleteCustom(index = state.currentIndex): Promise<void> {
      if (!Number.isInteger(index) || index < 0 || index >= alerts.length) {
        throw new RangeError(`Alert index ${index} is out of range.`);
      }
      await abandonInFlightRecording();
      await store.deleteMp3(index);
      state.customMp3s.delete(index);
      state.alertStates[index] = "pending";
      await persistMeta();
    },

    async applyCustomToAlerts(
      sourceIndex: number,
      targetIndexes: readonly number[],
    ): Promise<number> {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= alerts.length) {
        throw new RangeError(`Alert index ${sourceIndex} is out of range.`);
      }
      await abandonInFlightRecording();
      const sourceBlob = state.customMp3s.get(sourceIndex);
      if (!sourceBlob || sourceBlob.size === 0 || state.alertStates[sourceIndex] !== "custom") {
        throw new Error("Record a custom voice for this alert before applying it to others.");
      }

      const uniqueTargets = [
        ...new Set(
          targetIndexes.filter(
            (index) =>
              Number.isInteger(index) &&
              index >= 0 &&
              index < alerts.length &&
              index !== sourceIndex,
          ),
        ),
      ];

      for (const index of uniqueTargets) {
        await store.putMp3(index, sourceBlob);
        state.customMp3s.set(index, sourceBlob);
        state.alertStates[index] = "custom";
      }
      await persistMeta();
      return uniqueTargets.length;
    },

    async reset(): Promise<void> {
      await abandonInFlightRecording();
      await store.clear();
      state.packName = "";
      state.currentIndex = 0;
      state.alertStates = emptyDraftMeta(alerts.length).alertStates;
      state.customMp3s = new Map();
      state.lastError = null;
      state.hydrated = true;
      await persistMeta();
    },

    async dispose(): Promise<void> {
      await abandonInFlightRecording();
      await recorder.dispose();
      await store.close?.();
    },

    customSoundsForExport(): Map<number, Blob> {
      const sounds = new Map<number, Blob>();
      state.alertStates.forEach((status, index) => {
        if (status !== "custom") return;
        const blob = state.customMp3s.get(index);
        if (!blob || blob.size === 0) {
          throw new Error(
            `Custom recording for alert ${index + 1} is missing. Re-record it before exporting.`,
          );
        }
        sounds.set(index, blob);
      });
      return sounds;
    },
  };
}

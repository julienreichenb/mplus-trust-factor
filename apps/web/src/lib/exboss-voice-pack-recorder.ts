export const MAX_RECORDING_DURATION_MS = 5_000;

export type VoicePackRecordingErrorCode =
  | "PERMISSION_DENIED"
  | "NO_MICROPHONE"
  | "MEDIA_DEVICES_UNAVAILABLE"
  | "MEDIA_RECORDER_UNAVAILABLE"
  | "RECORDER_START_FAILED"
  | "NO_AUDIO_DATA"
  | "ALREADY_RECORDING"
  | "NOT_RECORDING";

export class VoicePackRecordingError extends Error {
  readonly code: VoicePackRecordingErrorCode;

  constructor(code: VoicePackRecordingErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "VoicePackRecordingError";
    this.code = code;
  }
}

export type RecordingStopReason = "manual" | "timeout";

export interface VoicePackRecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  stoppedBy: RecordingStopReason;
}

export interface VoicePackRecorderEnvironment {
  mediaDevices?: Pick<MediaDevices, "getUserMedia"> | null;
  MediaRecorder?: typeof MediaRecorder | null;
  maxDurationMs?: number;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export interface VoicePackRecorder {
  readonly recording: boolean;
  readonly starting: boolean;
  start(): Promise<void>;
  stop(): Promise<VoicePackRecordingResult>;
  waitUntilComplete(): Promise<VoicePackRecordingResult | null>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export function createVoicePackRecorder(
  environment: VoicePackRecorderEnvironment = {},
): VoicePackRecorder {
  const maxDurationMs = environment.maxDurationMs ?? MAX_RECORDING_DURATION_MS;
  let recording = false;
  let starting = false;
  let stopping = false;
  let startEpoch = 0;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let recorderStopped: Promise<void> | null = null;
  let resolveRecorderStopped: (() => void) | null = null;
  let completePromise: Promise<VoicePackRecordingResult | null> | null = null;
  let resolveComplete: ((result: VoicePackRecordingResult | null) => void) | null = null;
  let rejectComplete: ((error: unknown) => void) | null = null;
  let terminalError: unknown | null = null;

  function clearMaxTimer(): void {
    if (maxTimer !== null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  }

  function stopTracks(): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore individual track failures; remaining tracks still stop.
      }
    }
    stream = null;
  }

  function detachRecorder(): void {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    recorder = null;
  }

  function resetCompletion(): void {
    terminalError = null;
    completePromise = new Promise((resolve, reject) => {
      resolveComplete = resolve;
      rejectComplete = reject;
    });
    completePromise.catch(() => {
      // Avoid unhandled rejection when callers only use stop()/cancel().
    });
  }

  function settleRecorderStopped(): void {
    const resolve = resolveRecorderStopped;
    resolveRecorderStopped = null;
    resolve?.();
  }

  function settleComplete(result: VoicePackRecordingResult | null): void {
    const resolve = resolveComplete;
    resolveComplete = null;
    rejectComplete = null;
    resolve?.(result);
  }

  function failComplete(error: unknown): void {
    terminalError = error;
    const reject = rejectComplete;
    resolveComplete = null;
    rejectComplete = null;
    reject?.(error);
  }

  function cleanupHardware(): void {
    clearMaxTimer();
    stopTracks();
    detachRecorder();
    chunks = [];
    recording = false;
    starting = false;
    stopping = false;
    settleRecorderStopped();
    recorderStopped = null;
  }

  function buildResult(activeRecorder: MediaRecorder, reason: RecordingStopReason): VoicePackRecordingResult {
    const blob = new Blob(chunks, { type: activeRecorder.mimeType || "application/octet-stream" });
    const durationMs = Math.min(Math.max(0, Date.now() - startedAt), maxDurationMs);
    return {
      blob,
      mimeType: blob.type || activeRecorder.mimeType || "application/octet-stream",
      durationMs,
      stoppedBy: reason,
    };
  }

  async function requestStop(reason: RecordingStopReason): Promise<VoicePackRecordingResult> {
    if (!recording || !recorder) {
      throw new VoicePackRecordingError("NOT_RECORDING");
    }
    if (stopping) {
      const pending = completePromise;
      if (!pending) throw new VoicePackRecordingError("NOT_RECORDING");
      const result = await pending;
      if (!result) throw new VoicePackRecordingError("NO_AUDIO_DATA");
      return result;
    }
    stopping = true;
    clearMaxTimer();
    const activeRecorder = recorder;
    const stopped = recorderStopped ?? Promise.resolve();
    if (activeRecorder.state === "recording") {
      try {
        activeRecorder.stop();
      } catch (error) {
        cleanupHardware();
        const wrapped = new VoicePackRecordingError("RECORDER_START_FAILED", { cause: error });
        failComplete(wrapped);
        throw wrapped;
      }
    }
    await stopped;
    if (terminalError) {
      const error = terminalError;
      cleanupHardware();
      throw error;
    }
    const result = buildResult(activeRecorder, reason);
    cleanupHardware();
    if (result.blob.size <= 0) {
      settleComplete(null);
      throw new VoicePackRecordingError("NO_AUDIO_DATA");
    }
    settleComplete(result);
    return result;
  }

  return {
    get recording() {
      return recording;
    },
    get starting() {
      return starting;
    },

    async start(): Promise<void> {
      if (recording || starting) {
        throw new VoicePackRecordingError("ALREADY_RECORDING");
      }
      const mediaDevices = resolveMediaDevices(environment);
      const RecorderCtor = resolveMediaRecorder(environment);
      starting = true;
      const epoch = ++startEpoch;
      resetCompletion();
      try {
        stream = await mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        starting = false;
        const mapped = mapGetUserMediaError(error);
        failComplete(mapped);
        throw mapped;
      }

      if (epoch !== startEpoch) {
        stopTracks();
        cleanupHardware();
        settleComplete(null);
        return;
      }

      try {
        const mimeType = pickMimeType(RecorderCtor);
        recorder = mimeType
          ? new RecorderCtor(stream, { mimeType })
          : new RecorderCtor(stream);
        chunks = [];
        recorderStopped = new Promise((resolve) => {
          resolveRecorderStopped = resolve;
        });
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = (event: Event) => {
          const error =
            "error" in event ? (event as Event & { error?: unknown }).error : event;
          const wrapped = new VoicePackRecordingError("RECORDER_START_FAILED", { cause: error });
          failComplete(wrapped);
          cleanupHardware();
        };
        recorder.onstop = () => {
          resolveRecorderStopped?.();
        };
        recorder.start();
        if (epoch !== startEpoch) {
          try {
            if (recorder.state === "recording") recorder.stop();
          } catch {
            // Ignore stop failures while cancelling a raced start.
          }
          cleanupHardware();
          settleComplete(null);
          return;
        }
        if (recorder.state !== "recording") {
          throw new VoicePackRecordingError("RECORDER_START_FAILED");
        }
        recording = true;
        starting = false;
        stopping = false;
        startedAt = Date.now();
        maxTimer = setTimeout(() => {
          maxTimer = null;
          void requestStop("timeout").catch(() => {
            // Timeout stop failures are surfaced through completePromise.
          });
        }, maxDurationMs);
      } catch (error) {
        const wrapped =
          error instanceof VoicePackRecordingError
            ? error
            : new VoicePackRecordingError("RECORDER_START_FAILED", { cause: error });
        cleanupHardware();
        failComplete(wrapped);
        throw wrapped;
      }
    },

    async stop(): Promise<VoicePackRecordingResult> {
      return requestStop("manual");
    },

    async waitUntilComplete(): Promise<VoicePackRecordingResult | null> {
      if (!completePromise) return null;
      return completePromise;
    },

    async cancel(): Promise<void> {
      startEpoch += 1;
      clearMaxTimer();
      if (starting && !recording) {
        // getUserMedia may still be in flight; start() tears down when it resumes.
        if (stream) {
          stopTracks();
          cleanupHardware();
          settleComplete(null);
        }
        return;
      }
      const active = recorder;
      const stopped = recorderStopped;
      if (active && active.state === "recording") {
        try {
          active.stop();
        } catch {
          cleanupHardware();
          settleComplete(null);
          return;
        }
        if (stopped) {
          try {
            await stopped;
          } catch {
            // Discard recorder errors during cancel.
          }
        }
      }
      cleanupHardware();
      settleComplete(null);
    },

    async dispose(): Promise<void> {
      await this.cancel();
    },
  };
}

function resolveMediaDevices(
  environment: VoicePackRecorderEnvironment,
): Pick<MediaDevices, "getUserMedia"> {
  if (environment.mediaDevices === null) {
    throw new VoicePackRecordingError("MEDIA_DEVICES_UNAVAILABLE");
  }
  const devices = environment.mediaDevices ?? globalThis.navigator?.mediaDevices;
  if (!devices?.getUserMedia) {
    throw new VoicePackRecordingError("MEDIA_DEVICES_UNAVAILABLE");
  }
  return devices;
}

function resolveMediaRecorder(
  environment: VoicePackRecorderEnvironment,
): typeof MediaRecorder {
  if (environment.MediaRecorder === null) {
    throw new VoicePackRecordingError("MEDIA_RECORDER_UNAVAILABLE");
  }
  const RecorderCtor = environment.MediaRecorder ?? globalThis.MediaRecorder;
  if (!RecorderCtor) {
    throw new VoicePackRecordingError("MEDIA_RECORDER_UNAVAILABLE");
  }
  return RecorderCtor;
}

function pickMimeType(RecorderCtor: typeof MediaRecorder): string | undefined {
  if (typeof RecorderCtor.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((type) => RecorderCtor.isTypeSupported(type));
}

function mapGetUserMediaError(error: unknown): VoicePackRecordingError {
  const name =
    error instanceof DOMException
      ? error.name
      : error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new VoicePackRecordingError("PERMISSION_DENIED", { cause: error });
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new VoicePackRecordingError("NO_MICROPHONE", { cause: error });
  }
  return new VoicePackRecordingError("RECORDER_START_FAILED", { cause: error });
}

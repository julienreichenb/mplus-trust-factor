import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoicePackRecorder,
  MAX_RECORDING_DURATION_MS,
  type VoicePackRecordingError,
} from "./exboss-voice-pack-recorder";

type TrackStub = {
  stop: ReturnType<typeof vi.fn>;
  kind: string;
  readyState: string;
};

function createStream(): MediaStream {
  const track: TrackStub = {
    stop: vi.fn(),
    kind: "audio",
    readyState: "live",
  };
  return {
    getTracks: () => [track as unknown as MediaStreamTrack],
    getAudioTracks: () => [track as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
}

function createFakeMediaRecorderCtor(options?: {
  emptyData?: boolean;
  startThrows?: boolean;
  errorBeforeStop?: boolean;
}) {
  class FakeMediaRecorder {
    static isTypeSupported = vi.fn(() => true);
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(public stream: MediaStream) {}

    start(): void {
      if (options?.startThrows) throw new Error("start failed");
      this.state = "recording";
    }

    stop(): void {
      this.state = "inactive";
      queueMicrotask(() => {
        if (options?.errorBeforeStop) {
          this.onerror?.({
            error: new Error("encoder failed"),
          } as Event & { error: Error });
          return;
        }
        if (!options?.emptyData) {
          this.ondataavailable?.({
            data: new Blob(["pcm-ish"], { type: "audio/webm" }),
          } as BlobEvent);
        } else {
          this.ondataavailable?.({
            data: new Blob([], { type: "audio/webm" }),
          } as BlobEvent);
        }
        this.onstop?.();
      });
    }
  }
  return FakeMediaRecorder as unknown as typeof MediaRecorder;
}

describe("createVoicePackRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports manual stop and releases tracks + timers", async () => {
    const stream = createStream();
    const getUserMedia = vi.fn(async () => stream);
    const MediaRecorder = createFakeMediaRecorderCtor();
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia },
      MediaRecorder,
    });

    await recorder.start();
    expect(recorder.recording).toBe(true);
    const resultPromise = recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;
    expect(result.stoppedBy).toBe("manual");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(recorder.recording).toBe(false);
    expect((stream.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalledTimes(1);
  });

  it("auto-stops at exactly 5 seconds", async () => {
    const stream = createStream();
    const MediaRecorder = createFakeMediaRecorderCtor();
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia: async () => stream },
      MediaRecorder,
    });

    await recorder.start();
    const complete = recorder.waitUntilComplete();
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_DURATION_MS - 1);
    expect(recorder.recording).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    const result = await complete;
    expect(result?.stoppedBy).toBe("timeout");
    expect(result?.durationMs).toBe(MAX_RECORDING_DURATION_MS);
    expect(recorder.recording).toBe(false);
    expect((stream.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalled();
  });

  it("clears the max-duration timer on manual stop", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const stream = createStream();
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia: async () => stream },
      MediaRecorder: createFakeMediaRecorderCtor(),
    });
    await recorder.start();
    const stopPromise = recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopPromise;
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("maps permission denied", async () => {
    const recorder = createVoicePackRecorder({
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
      MediaRecorder: createFakeMediaRecorderCtor(),
    });
    await expect(recorder.start()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    } satisfies Partial<VoicePackRecordingError>);
  });

  it("rejects unsupported browser environments", async () => {
    await expect(
      createVoicePackRecorder({
        mediaDevices: null,
        MediaRecorder: createFakeMediaRecorderCtor(),
      }).start(),
    ).rejects.toMatchObject({ code: "MEDIA_DEVICES_UNAVAILABLE" });

    await expect(
      createVoicePackRecorder({
        mediaDevices: { getUserMedia: async () => createStream() },
        MediaRecorder: null,
      }).start(),
    ).rejects.toMatchObject({ code: "MEDIA_RECORDER_UNAVAILABLE" });
  });

  it("rejects recordings with no usable audio data", async () => {
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia: async () => createStream() },
      MediaRecorder: createFakeMediaRecorderCtor({ emptyData: true }),
    });
    await recorder.start();
    const stopPromise = recorder.stop();
    const assertion = expect(stopPromise).rejects.toMatchObject({ code: "NO_AUDIO_DATA" });
    await Promise.resolve();
    await Promise.resolve();
    await assertion;
  });

  it("supports a repeated record cycle", async () => {
    const streamA = createStream();
    const streamB = createStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(streamA)
      .mockResolvedValueOnce(streamB);
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia },
      MediaRecorder: createFakeMediaRecorderCtor(),
    });

    await recorder.start();
    const firstStop = recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    await firstStop;

    await recorder.start();
    const secondStop = recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    const second = await secondStop;
    expect(second.blob.size).toBeGreaterThan(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect((streamA.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalled();
    expect((streamB.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalled();
  });

  it("cancels and releases tracks without returning audio", async () => {
    const stream = createStream();
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia: async () => stream },
      MediaRecorder: createFakeMediaRecorderCtor(),
    });
    await recorder.start();
    const complete = recorder.waitUntilComplete();
    const cancelPromise = recorder.cancel();
    await vi.advanceTimersByTimeAsync(0);
    await cancelPromise;
    await expect(complete).resolves.toBeNull();
    expect((stream.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalled();
  });

  it("settles stop and complete when MediaRecorder errors before onstop", async () => {
    const stream = createStream();
    const MediaRecorder = createFakeMediaRecorderCtor({ errorBeforeStop: true });
    const recorder = createVoicePackRecorder({
      mediaDevices: { getUserMedia: async () => stream },
      MediaRecorder,
    });
    await recorder.start();
    const complete = recorder.waitUntilComplete();
    const stopPromise = recorder.stop();
    const stopAssertion = expect(stopPromise).rejects.toMatchObject({
      code: "RECORDER_START_FAILED",
    } satisfies Partial<VoicePackRecordingError>);
    const completeAssertion = expect(complete).rejects.toMatchObject({
      code: "RECORDER_START_FAILED",
    } satisfies Partial<VoicePackRecordingError>);
    await vi.advanceTimersByTimeAsync(0);
    await stopAssertion;
    await completeAssertion;
    expect(recorder.recording).toBe(false);
    expect((stream.getTracks()[0] as unknown as TrackStub).stop).toHaveBeenCalled();
  });
});

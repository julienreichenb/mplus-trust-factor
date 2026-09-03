import { describe, expect, it, vi } from "vitest";
import type { Mp3EncodeEngine } from "./exboss-voice-pack-encoder";
import type { ExBossVoiceAlert } from "./exboss-voice-pack-manifest";
import {
  createVoicePackRecorder,
  type VoicePackRecorder,
} from "./exboss-voice-pack-recorder";
import { createVoicePackSession } from "./exboss-voice-pack-session";
import { createMemoryDraftStore } from "./exboss-voice-pack-storage";

const ALERTS: ExBossVoiceAlert[] = [
  { index: 0, label: "A", filename: "a.ogg", englishCue: "A" },
  { index: 1, label: "B", filename: "b.ogg", englishCue: "B" },
  { index: 2, label: "C", filename: "c.ogg", englishCue: "C" },
];

function mp3Engine(marker = "mp3"): Mp3EncodeEngine {
  const bytes = new TextEncoder().encode(`ID3${marker}`);
  return {
    convert: vi.fn(async () => bytes.slice()),
  };
}

function createFakeMediaRecorderCtor() {
  class FakeMediaRecorder {
    static isTypeSupported = () => true;
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    constructor(public stream: MediaStream) {}
    start(): void {
      this.state = "recording";
    }
    stop(): void {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: new Blob(["raw"], { type: "audio/webm" }),
        } as BlobEvent);
        this.onstop?.();
      });
    }
  }
  return FakeMediaRecorder as unknown as typeof MediaRecorder;
}

function createTestRecorder(): VoicePackRecorder {
  const track = { stop: vi.fn(), kind: "audio", readyState: "live" };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return createVoicePackRecorder({
    mediaDevices: { getUserMedia: async () => stream },
    MediaRecorder: createFakeMediaRecorderCtor(),
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createVoicePackSession", () => {
  it("tracks pending → custom and progress counts", async () => {
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine("one"),
    });
    await session.hydrate();
    expect(session.pendingCount).toBe(3);
    expect(session.completionPercent).toBe(0);

    await session.startRecording();
    const stopPromise = session.stopRecording();
    await flushMicrotasks();
    await stopPromise;

    expect(session.state.alertStates[0]).toBe("custom");
    expect(session.customCount).toBe(1);
    expect(session.pendingCount).toBe(2);
    expect(session.completionPercent).toBe(33);
    expect(session.state.customMp3s.get(0)?.type).toBe("audio/mpeg");
  });

  it("supports pending → fallback and fallback → custom", async () => {
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    await session.markFallback(1);
    expect(session.state.alertStates[1]).toBe("fallback");
    expect(session.fallbackCount).toBe(1);

    await session.selectAlert(1);
    await session.startRecording();
    const stopPromise = session.stopRecording();
    await flushMicrotasks();
    await stopPromise;
    expect(session.state.alertStates[1]).toBe("custom");
  });

  it("re-records custom and deletes back to pending", async () => {
    const engine = mp3Engine("first");
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: engine,
    });
    await session.hydrate();
    await session.startRecording();
    let stopPromise = session.stopRecording();
    await flushMicrotasks();
    await stopPromise;
    const first = session.state.customMp3s.get(0);

    engine.convert = vi.fn(async () => new TextEncoder().encode("ID3second").slice());
    await session.startRecording();
    stopPromise = session.stopRecording();
    await flushMicrotasks();
    await stopPromise;
    const second = session.state.customMp3s.get(0);
    expect(second).not.toBe(first);
    expect(second?.size).toBeGreaterThan(first?.size ?? 0);

    await session.deleteCustom(0);
    expect(session.state.alertStates[0]).toBe("pending");
    expect(session.state.customMp3s.has(0)).toBe(false);
  });

  it("hydrates from the draft store and supports navigation", async () => {
    const store = createMemoryDraftStore();
    const meta = {
      schemaVersion: 1 as const,
      packName: "Saved Pack",
      currentIndex: 2,
      alertStates: ["fallback", "custom", "pending"] as const,
    };
    const blob = new Blob(["ID3"], { type: "audio/mpeg" });
    await store.saveMeta({
      schemaVersion: 1,
      packName: meta.packName,
      currentIndex: meta.currentIndex,
      alertStates: [...meta.alertStates],
    });
    await store.putMp3(1, blob);

    const session = createVoicePackSession({
      alerts: ALERTS,
      store,
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    expect(session.state.packName).toBe("Saved Pack");
    expect(session.state.currentIndex).toBe(2);
    expect(session.state.alertStates).toEqual(["fallback", "custom", "pending"]);
    expect(session.state.customMp3s.get(1)?.size).toBe(3);

    await session.previous();
    expect(session.state.currentIndex).toBe(1);
    await session.next();
    expect(session.state.currentIndex).toBe(2);
    await session.selectAlert(0);
    expect(session.state.currentIndex).toBe(0);
  });

  it("cancels an in-progress recording when jumping alerts", async () => {
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    await session.startRecording();
    expect(session.state.recording).toBe(true);
    await session.selectAlert(2);
    await flushMicrotasks();
    expect(session.state.recording).toBe(false);
    expect(session.state.alertStates[0]).toBe("pending");
    expect(session.state.currentIndex).toBe(2);
  });

  it("resets the entire session draft", async () => {
    const store = createMemoryDraftStore();
    const session = createVoicePackSession({
      alerts: ALERTS,
      store,
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    await session.setPackName("Temp");
    await session.markFallback(0);
    await session.reset();
    expect(session.state.packName).toBe("");
    expect(session.state.alertStates).toEqual(["pending", "pending", "pending"]);
    expect(session.state.customMp3s.size).toBe(0);
    expect(session.exportReady).toBe(false);
  });

  it("copies one custom recording onto multiple alerts", async () => {
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine("bulk"),
    });
    await session.hydrate();
    await session.startRecording();
    const stopPromise = session.stopRecording();
    await flushMicrotasks();
    await stopPromise;
    expect(session.state.alertStates[0]).toBe("custom");

    const applied = await session.applyCustomToAlerts(0, [1, 2, 0, 1]);
    expect(applied).toBe(2);
    expect(session.state.alertStates).toEqual(["custom", "custom", "custom"]);
    expect(session.state.customMp3s.get(1)?.size).toBeGreaterThan(0);
    expect(session.state.customMp3s.get(2)?.size).toBeGreaterThan(0);
  });

  it("marks export ready when the pack name is valid and custom blobs exist", async () => {
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    expect(session.exportReady).toBe(false);
    await session.setPackName("Ready Pack");
    expect(session.exportReady).toBe(true);

    session.state.alertStates[0] = "custom";
    expect(session.exportReady).toBe(false);
    expect(() => session.customSoundsForExport()).toThrow(/missing/i);
  });

  it("commits an encode to the original alert even if the user navigates away", async () => {
    let releaseEncode!: (bytes: Uint8Array) => void;
    const encodeEngine: Mp3EncodeEngine = {
      convert: vi.fn(
        () =>
          new Promise<Uint8Array>((resolve) => {
            releaseEncode = resolve;
          }),
      ),
    };
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createTestRecorder(),
      encodeEngine,
    });
    await session.hydrate();
    await session.startRecording();
    const stopPromise = session.stopRecording();
    for (let i = 0; i < 20 && !session.state.encoding; i += 1) {
      await flushMicrotasks();
    }
    expect(session.state.encoding).toBe(true);
    expect(encodeEngine.convert).toHaveBeenCalled();
    const navigatePromise = session.selectAlert(2);
    releaseEncode(new TextEncoder().encode("ID3pinned"));
    await Promise.all([stopPromise.catch(() => undefined), navigatePromise]);
    for (let i = 0; i < 20 && session.state.encoding; i += 1) {
      await flushMicrotasks();
    }
    expect(session.state.currentIndex).toBe(2);
    expect(session.state.customMp3s.has(0)).toBe(true);
    expect(session.state.customMp3s.has(2)).toBe(false);
    expect(session.state.alertStates[0]).toBe("custom");
    expect(session.state.encoding).toBe(false);
    expect(session.state.recording).toBe(false);
  });

  it("does not leave a live mic when cancel happens during getUserMedia", async () => {
    const track = { stop: vi.fn(), kind: "audio", readyState: "live" };
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    let resolveMedia!: (stream: MediaStream) => void;
    const mediaDevices = {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveMedia = resolve;
          }),
      ),
    };
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: createMemoryDraftStore(),
      recorder: createVoicePackRecorder({
        mediaDevices,
        MediaRecorder: createFakeMediaRecorderCtor(),
      }),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    const startPromise = session.startRecording();
    await flushMicrotasks();
    await session.selectAlert(1);
    resolveMedia(stream);
    await startPromise;
    await flushMicrotasks();
    expect(track.stop).toHaveBeenCalled();
    expect(session.state.recording).toBe(false);
    expect(session.state.currentIndex).toBe(1);
  });

  it("closes the draft store on dispose when close is available", async () => {
    const store = createMemoryDraftStore();
    const close = vi.fn(async () => undefined);
    const session = createVoicePackSession({
      alerts: ALERTS,
      store: { ...store, close },
      recorder: createTestRecorder(),
      encodeEngine: mp3Engine(),
    });
    await session.hydrate();
    await session.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

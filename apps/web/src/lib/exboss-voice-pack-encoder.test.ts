import { describe, expect, it, vi } from "vitest";
import {
  encodeRecordingToMp3,
  MP3_MIME_TYPE,
  voicePackMp3ConversionTrim,
  type Mp3EncodeEngine,
  type VoicePackEncodeError,
} from "./exboss-voice-pack-encoder";
import { MAX_RECORDING_DURATION_MS } from "./exboss-voice-pack-recorder";

describe("encodeRecordingToMp3", () => {
  it("produces a non-empty audio/mpeg blob from a successful convert", async () => {
    const input = new Blob(["raw-webm"], { type: "audio/webm" });
    const engine: Mp3EncodeEngine = {
      convert: vi.fn(async () => new Uint8Array([0xff, 0xfb, 0x10, 0x00])),
    };
    const mp3 = await encodeRecordingToMp3(input, engine);
    expect(mp3.size).toBeGreaterThan(0);
    expect(mp3.type).toBe(MP3_MIME_TYPE);
    expect(mp3).not.toBe(input);
    expect(engine.convert).toHaveBeenCalledWith(input);
  });

  it("never treats the raw recording blob as the exported MP3", async () => {
    const input = new Blob(["raw-webm"], { type: "audio/webm" });
    const engine: Mp3EncodeEngine = {
      convert: async () => input,
    };
    const mp3 = await encodeRecordingToMp3(input, engine);
    expect(mp3).not.toBe(input);
    expect(mp3.type).toBe(MP3_MIME_TYPE);
    expect(mp3.type).not.toBe(input.type);
  });

  it("propagates encoder failures cleanly", async () => {
    const engine: Mp3EncodeEngine = {
      convert: async () => {
        throw new Error("wasm boom");
      },
    };
    await expect(
      encodeRecordingToMp3(new Blob(["raw"], { type: "audio/webm" }), engine),
    ).rejects.toMatchObject({
      code: "ENCODE_FAILED",
    } satisfies Partial<VoicePackEncodeError>);
  });

  it("rejects empty convert output and empty input", async () => {
    await expect(
      encodeRecordingToMp3(new Blob([], { type: "audio/webm" }), {
        convert: async () => new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      encodeRecordingToMp3(new Blob(["raw"], { type: "audio/webm" }), {
        convert: async () => new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: "EMPTY_OUTPUT" });
  });

  it("caps default MediaBunny conversion trim at the shared 5-second maximum", () => {
    const trim = voicePackMp3ConversionTrim();
    expect(trim.end).toBe(MAX_RECORDING_DURATION_MS / 1000);
    expect(trim.end).toBe(5);
  });
});

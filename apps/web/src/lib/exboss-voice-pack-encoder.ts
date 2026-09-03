import { bytesToMpegBlob, toUint8Array } from "./exboss-voice-pack-binary";
import { MAX_RECORDING_DURATION_MS } from "./exboss-voice-pack-recorder";

export type VoicePackEncodeErrorCode = "INVALID_INPUT" | "ENCODE_FAILED" | "EMPTY_OUTPUT";

export class VoicePackEncodeError extends Error {
  readonly code: VoicePackEncodeErrorCode;

  constructor(code: VoicePackEncodeErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "VoicePackEncodeError";
    this.code = code;
  }
}

export const MP3_MIME_TYPE = "audio/mpeg";
export const VOICE_MP3_SAMPLE_RATE_HZ = 22_050;
export const VOICE_MP3_CHANNELS = 1;

/** Hard MP3 output cap in seconds. Matches the recorder timeout; trims late MediaRecorder overruns. */
export function voicePackMp3ConversionTrim(): { end: number } {
  return { end: MAX_RECORDING_DURATION_MS / 1000 };
}

export interface Mp3EncodeEngine {
  convert(input: Blob): Promise<Blob | ArrayBuffer | Uint8Array>;
}

let defaultEnginePromise: Promise<Mp3EncodeEngine> | null = null;

export function resetMp3EncoderForTests(): void {
  defaultEnginePromise = null;
}

export async function encodeRecordingToMp3(
  input: Blob,
  engine?: Mp3EncodeEngine,
): Promise<Blob> {
  if (!isBlobLike(input) || input.size <= 0) {
    throw new VoicePackEncodeError("INVALID_INPUT");
  }
  const converter = engine ?? (await getDefaultEngine());
  let converted: Blob | ArrayBuffer | Uint8Array;
  try {
    converted = await converter.convert(input);
  } catch (error) {
    if (error instanceof VoicePackEncodeError) throw error;
    throw new VoicePackEncodeError("ENCODE_FAILED", { cause: error });
  }
  let bytes: Uint8Array;
  try {
    bytes = await toUint8Array(converted);
  } catch (error) {
    throw new VoicePackEncodeError("ENCODE_FAILED", { cause: error });
  }
  if (bytes.byteLength <= 0) {
    throw new VoicePackEncodeError("EMPTY_OUTPUT");
  }
  return bytesToMpegBlob(bytes, MP3_MIME_TYPE);
}

async function getDefaultEngine(): Promise<Mp3EncodeEngine> {
  defaultEnginePromise ??= loadMediabunnyEngine();
  return defaultEnginePromise;
}

async function loadMediabunnyEngine(): Promise<Mp3EncodeEngine> {
  const [mediabunny, mp3Encoder] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/mp3-encoder"),
  ]);
  if (!(await mediabunny.canEncodeAudio("mp3"))) {
    mp3Encoder.registerMp3Encoder();
  }
  return {
    async convert(input: Blob): Promise<Blob> {
      const source = new mediabunny.BlobSource(input);
      const mediaInput = new mediabunny.Input({
        source,
        formats: mediabunny.ALL_FORMATS,
      });
      const target = new mediabunny.BufferTarget();
      const output = new mediabunny.Output({
        format: new mediabunny.Mp3OutputFormat(),
        target,
      });
      const conversion = await mediabunny.Conversion.init({
        input: mediaInput,
        output,
        video: { discard: true },
        audio: {
          codec: "mp3",
          numberOfChannels: VOICE_MP3_CHANNELS,
          sampleRate: VOICE_MP3_SAMPLE_RATE_HZ,
          quality: new mediabunny.Quality("low"),
          forceTranscode: true,
        },
        trim: voicePackMp3ConversionTrim(),
        tags: {},
        showWarnings: false,
      });
      if (!conversion.isValid) {
        throw new VoicePackEncodeError("ENCODE_FAILED", {
          cause: conversion.discardedTracks,
        });
      }
      await conversion.execute();
      const buffer = target.buffer;
      if (!buffer || buffer.byteLength <= 0) {
        throw new VoicePackEncodeError("EMPTY_OUTPUT");
      }
      return new Blob([buffer], { type: MP3_MIME_TYPE });
    },
  };
}

function isBlobLike(value: unknown): value is Blob {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Blob).size === "number" &&
    typeof (value as Blob).type === "string"
  );
}

import { describe, expect, it } from "vitest";
import { VoicePackEncodeError } from "./exboss-voice-pack-encoder";
import { VoicePackRecordingError } from "./exboss-voice-pack-recorder";
import { voicePackErrorMessage } from "./exboss-voice-pack-ui-errors";

describe("voicePackErrorMessage", () => {
  it("maps recording domain codes to English UI copy", () => {
    expect(voicePackErrorMessage(new VoicePackRecordingError("PERMISSION_DENIED"))).toMatch(
      /permission was denied/i,
    );
    expect(voicePackErrorMessage(new VoicePackRecordingError("NO_MICROPHONE"))).toMatch(
      /No microphone/i,
    );
    expect(
      voicePackErrorMessage(new VoicePackRecordingError("MEDIA_RECORDER_UNAVAILABLE")),
    ).toMatch(/cannot record audio/i);
    expect(voicePackErrorMessage(new VoicePackRecordingError("NO_AUDIO_DATA"))).toMatch(
      /No usable audio/i,
    );
  });

  it("maps encode failures", () => {
    expect(voicePackErrorMessage(new VoicePackEncodeError("ENCODE_FAILED"))).toMatch(
      /MP3 encoding failed/i,
    );
  });
});

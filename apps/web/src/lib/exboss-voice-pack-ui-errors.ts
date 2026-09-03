import { VoicePackEncodeError } from "./exboss-voice-pack-encoder";
import { VoicePackRecordingError } from "./exboss-voice-pack-recorder";

export function voicePackErrorMessage(error: unknown): string {
  if (error instanceof VoicePackRecordingError) {
    switch (error.code) {
      case "PERMISSION_DENIED":
        return "Microphone permission was denied. Allow microphone access and try again.";
      case "NO_MICROPHONE":
        return "No microphone was found. Connect a microphone and try again.";
      case "MEDIA_DEVICES_UNAVAILABLE":
      case "MEDIA_RECORDER_UNAVAILABLE":
        return "This browser cannot record audio. Try a recent Chrome, Firefox, or Edge.";
      case "RECORDER_START_FAILED":
        return "Recording could not start. Check your microphone and try again.";
      case "NO_AUDIO_DATA":
        return "No usable audio was captured. Try recording again.";
      case "ALREADY_RECORDING":
        return "A recording is already in progress.";
      case "NOT_RECORDING":
        return "No recording is active.";
      default:
        return "Recording failed. Please try again.";
    }
  }
  if (error instanceof VoicePackEncodeError) {
    switch (error.code) {
      case "INVALID_INPUT":
      case "EMPTY_OUTPUT":
        return "The recording could not be converted to MP3. Try recording again.";
      case "ENCODE_FAILED":
        return "MP3 encoding failed. Try recording again.";
      default:
        return "Audio processing failed. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

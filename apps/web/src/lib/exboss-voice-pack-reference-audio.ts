import { EXBOSS_VOICE_PACK_PROVENANCE } from "./exboss-voice-pack-manifest";

/** Centralized GitHub raw base for the pinned EXBOSS-ENG Sounds/ directory. */
export const EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL =
  `https://raw.githubusercontent.com/aizuon/EXBOSS/${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}/EXBOSS-ENG/Sounds`;

export function buildExBossEnglishReferenceUrl(filename: string): string {
  const safe = filename.replace(/^\/+/, "");
  const encoded = safe
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL}/${encoded}`;
}

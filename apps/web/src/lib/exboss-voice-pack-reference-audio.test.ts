import { describe, expect, it } from "vitest";
import {
  buildExBossEnglishReferenceUrl,
  EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL,
} from "./exboss-voice-pack-reference-audio";
import { EXBOSS_VOICE_PACK_PROVENANCE } from "./exboss-voice-pack-manifest";

describe("ExBoss English reference audio URLs", () => {
  it("builds URLs from the pinned upstream SHA base", () => {
    expect(EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL).toContain(
      EXBOSS_VOICE_PACK_PROVENANCE.commitSha,
    );
    expect(EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL).toBe(
      `https://raw.githubusercontent.com/aizuon/EXBOSS/${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}/EXBOSS-ENG/Sounds`,
    );
    expect(buildExBossEnglishReferenceUrl("prepare-aoe.ogg")).toBe(
      `${EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL}/prepare-aoe.ogg`,
    );
    expect(buildExBossEnglishReferenceUrl("prepare aoe.ogg")).toBe(
      `${EXBOSS_ENG_REFERENCE_SOUNDS_BASE_URL}/prepare%20aoe.ogg`,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  hasPublishedScore,
  isInitialScoreCalculating,
  resolveCharacterScoreLoadPhase,
  shouldShowPublishedScore,
} from "./characterScoreLoadState";
import type { CharacterProfileView } from "../api/types";

function profile(
  partial: Partial<Pick<CharacterProfileView, "score" | "refreshStatus">>,
): Pick<CharacterProfileView, "score" | "refreshStatus"> {
  return {
    score: partial.score ?? null,
    refreshStatus: partial.refreshStatus ?? "FRESH",
  };
}

describe("characterScoreLoadState", () => {
  it("treats queued characters without a score as calculating", () => {
    expect(isInitialScoreCalculating(profile({ refreshStatus: "QUEUED", score: null }))).toBe(true);
    expect(resolveCharacterScoreLoadPhase({ profile: profile({ refreshStatus: "QUEUED" }) })).toBe(
      "calculating",
    );
  });

  it("keeps an existing score visible during background refresh", () => {
    const scored = profile({
      refreshStatus: "REFRESHING",
      score: { overallScore: 80 } as CharacterProfileView["score"],
    });
    expect(isInitialScoreCalculating(scored)).toBe(false);
    expect(shouldShowPublishedScore(scored)).toBe(true);
    expect(hasPublishedScore(scored)).toBe(true);
    expect(resolveCharacterScoreLoadPhase({ profile: scored })).toBe("ready");
  });

  it("maps terminal failure and timeout without inventing progress", () => {
    expect(
      resolveCharacterScoreLoadPhase({
        profile: profile({ refreshStatus: "FAILED", score: null }),
      }),
    ).toBe("failed");
    expect(
      resolveCharacterScoreLoadPhase({
        profile: profile({ refreshStatus: "QUEUED", score: null }),
        timedOut: true,
      }),
    ).toBe("timed_out");
  });
});

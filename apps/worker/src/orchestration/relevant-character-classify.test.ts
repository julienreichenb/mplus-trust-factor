import { describe, expect, it } from "vitest";
import {
  classifyRelevantCharacterRefresh,
  priorityForRelevantClass,
} from "./relevant-character-classify.js";

const base = {
  scoreTtlSeconds: 604_800,
  failureBackoffSeconds: 3600,
  activeJobStatus: null as const,
  latestJobStatus: null,
  latestJobFinishedAt: null,
  latestJobErrorCode: null,
  contractReasons: [] as string[],
  forceRefresh: false,
  notRefreshEligible: false,
};

describe("classifyRelevantCharacterRefresh", () => {
  it("classifies no score as NEW", () => {
    expect(
      classifyRelevantCharacterRefresh({
        ...base,
        hasPublishedScore: false,
        scoreCalculatedAt: null,
      }),
    ).toBe("NEW");
  });

  it("classifies expired score as STALE", () => {
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(
      classifyRelevantCharacterRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: old,
      }),
    ).toBe("STALE");
  });

  it("classifies fresh score as FRESH", () => {
    expect(
      classifyRelevantCharacterRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: new Date().toISOString(),
      }),
    ).toBe("FRESH");
  });
});

describe("priorityForRelevantClass", () => {
  it("prioritizes NEW over STALE", () => {
    expect(priorityForRelevantClass("NEW")).toBe("normal");
    expect(priorityForRelevantClass("STALE")).toBe("low");
  });
});

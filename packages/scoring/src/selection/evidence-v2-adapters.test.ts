import { describe, expect, it } from "vitest";
import {
  mythicRunToEvidenceCandidateMetadata,
  mythicRunToEvidenceCandidateMetadataList,
} from "./evidence-v2-adapters.js";
import type { MythicRunDTO } from "@mplus/contracts";

function runWithSources(
  sources: MythicRunDTO["sources"],
): MythicRunDTO {
  return {
    id: "r1",
    region: "EU",
    seasonSlug: "blizzard-season-17",
    dungeonSlug: "algethar-academy",
    keyLevel: 22,
    completedAt: "2026-07-26T14:57:56.255Z",
    durationMs: 1_800_000,
    timerMs: null,
    timed: true,
    scoreValue: null,
    canonicalFingerprint: "fp",
    affixes: [],
    participants: [],
    sources,
  };
}

describe("mythicRunToEvidenceCandidateMetadataList", () => {
  it("emits one candidate per distinct WCL reportCode:fightId after fusion", () => {
    const run = runWithSources([
      {
        provider: "WARCRAFT_LOGS",
        externalRunId: "1WKc:1",
        externalUrl: null,
        reportCode: "1WKcCz2BnAQmbhfq",
        fightId: 1,
        revision: 1,
      },
      {
        provider: "WARCRAFT_LOGS",
        externalRunId: "jCWx:1",
        externalUrl: null,
        reportCode: "jCWxQFPV7tHpgXah",
        fightId: 1,
        revision: 1,
      },
      {
        provider: "BLIZZARD",
        externalRunId: "blz",
        externalUrl: null,
        reportCode: null,
        fightId: null,
        revision: null,
      },
    ]);

    const list = mythicRunToEvidenceCandidateMetadataList(run);
    expect(list.map((c) => c.discoveryIdentity.reportCode).sort()).toEqual([
      "1WKcCz2BnAQmbhfq",
      "jCWxQFPV7tHpgXah",
    ]);
    expect(mythicRunToEvidenceCandidateMetadata(run)?.discoveryIdentity.reportCode).toBe(
      "1WKcCz2BnAQmbhfq",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  refreshCharacterDedupeKey,
  analyzeRunDedupeKey,
  recalculateScoreDedupeKey,
  generateAddonExportDedupeKey,
  buildDedupeKey,
} from "./dedupe.js";
import { QUEUE_NAMES } from "@mplus/contracts";

describe("worker dedupe keys", () => {
  it("produces stable refresh character dedupe keys", () => {
    const job = {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Example",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt: "2026-07-20T18:00:00.000Z",
    };
    const a = refreshCharacterDedupeKey(job);
    const b = refreshCharacterDedupeKey({ ...job, name: "example" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differentiates analyze run by analysis version", () => {
    const base = {
      runId: "11111111-1111-1111-1111-111111111111",
      characterId: "22222222-2222-2222-2222-222222222222",
      selectionKind: "LATEST" as const,
      requestedAt: "2026-07-20T18:00:00.000Z",
    };
    const v1 = analyzeRunDedupeKey({ ...base, analysisVersion: "1" });
    const v2 = analyzeRunDedupeKey({ ...base, analysisVersion: "2" });
    expect(v1).not.toBe(v2);
  });

  it("builds unique keys per queue", () => {
    const refresh = buildDedupeKey(QUEUE_NAMES.refreshCharacter, ["EU", "a"]);
    const analyze = buildDedupeKey(QUEUE_NAMES.analyzeRun, ["EU", "a"]);
    expect(refresh).not.toBe(analyze);
  });

  it("dedupes recalculate and addon export jobs", () => {
    const recalc = recalculateScoreDedupeKey({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonId: "22222222-2222-2222-2222-222222222222",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt: "2026-07-20T18:00:00.000Z",
    });
    const addon = generateAddonExportDedupeKey({
      region: "EU",
      seasonId: "22222222-2222-2222-2222-222222222222",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt: "2026-07-20T18:00:00.000Z",
    });
    expect(recalc).toHaveLength(64);
    expect(addon).toHaveLength(64);
    expect(recalc).not.toBe(addon);
  });
});

import { describe, expect, it } from "vitest";
import {
  analyzeRunDedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";

const requestedAt = "2026-01-01T00:00:00.000Z";

describe("dedupe keys", () => {
  it("refreshCharacterDedupeKey is stable for identical payloads", () => {
    const job = {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Examplecharacter",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt,
    };
    expect(refreshCharacterDedupeKey(job)).toBe(refreshCharacterDedupeKey({ ...job }));
  });

  it("refreshCharacterDedupeKey is case-insensitive on name", () => {
    const base = {
      region: "EU",
      realmSlug: "tarren-mill",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt,
    };
    expect(refreshCharacterDedupeKey({ ...base, name: "Examplecharacter" })).toBe(
      refreshCharacterDedupeKey({ ...base, name: "examplecharacter" }),
    );
  });

  it("refreshCharacterDedupeKey differs by forceRefresh", () => {
    const base = {
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Examplecharacter",
      priority: "normal" as const,
      requestedAt,
    };
    expect(refreshCharacterDedupeKey({ ...base, forceRefresh: false })).not.toBe(
      refreshCharacterDedupeKey({ ...base, forceRefresh: true }),
    );
  });

  it("refreshCharacterDedupeKey differs by identity", () => {
    const base = {
      region: "EU",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt,
    };
    expect(
      refreshCharacterDedupeKey({ ...base, realmSlug: "tarren-mill", name: "Examplecharacter" }),
    ).not.toBe(refreshCharacterDedupeKey({ ...base, realmSlug: "silvermoon", name: "Examplecharacter" }));
  });

  it("analyzeRunDedupeKey is stable and unique per run/character/selection", () => {
    const job = {
      runId: "11111111-1111-1111-1111-111111111111",
      characterId: "22222222-2222-2222-2222-222222222222",
      selectionKind: "LATEST" as const,
      analysisVersion: "v1",
      requestedAt,
    };
    expect(analyzeRunDedupeKey(job)).toBe(analyzeRunDedupeKey({ ...job }));
    expect(analyzeRunDedupeKey(job)).not.toBe(analyzeRunDedupeKey({ ...job, selectionKind: "HIGHEST" }));
  });

  it("recalculateScoreDedupeKey is stable and unique per model version", () => {
    const job = {
      characterId: "22222222-2222-2222-2222-222222222222",
      seasonId: "33333333-3333-3333-3333-333333333333",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt,
    };
    expect(recalculateScoreDedupeKey(job)).toBe(recalculateScoreDedupeKey({ ...job }));
    expect(recalculateScoreDedupeKey(job)).not.toBe(
      recalculateScoreDedupeKey({ ...job, scoreModelVersion: 2 }),
    );
  });

  it("generateAddonExportDedupeKey is stable and unique per region/season/model", () => {
    const job = {
      region: "EU",
      seasonId: "33333333-3333-3333-3333-333333333333",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt,
    };
    expect(generateAddonExportDedupeKey(job)).toBe(generateAddonExportDedupeKey({ ...job }));
    expect(generateAddonExportDedupeKey(job)).not.toBe(
      generateAddonExportDedupeKey({ ...job, region: "US" }),
    );
  });
});

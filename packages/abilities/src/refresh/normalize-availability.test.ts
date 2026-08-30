import { describe, expect, it } from "vitest";
import { mergeCandidates, normalizeRecord } from "./normalize.js";
import { membershipFromScope, mergeSimcMembership } from "./extract/simc-availability.js";
import type { ExternalSourceRecord, ExternalSourceSnapshot } from "./types.js";

function snapshotFor(records: ExternalSourceRecord[]): ExternalSourceSnapshot {
  return {
    identity: {
      source: "SIMULATIONCRAFT",
      datasetKind: "PINNED",
      sourceVersion: "test",
      sourceRevision: "abc",
      retrievedAt: "2026-08-16T12:00:00.000Z",
      captureProvenance: "SYNTHETIC_CONTRACT",
    },
    inventories: [],
    records,
  };
}

function baseRecord(overrides: Partial<ExternalSourceRecord> = {}): ExternalSourceRecord {
  return {
    spellId: 101545,
    name: "Flying Serpent Kick",
    classSlug: "monk",
    specSlugs: ["windwalker"],
    raceSlugs: [],
    cooldownSeconds: 15,
    catalogRelevant: true,
    ...overrides,
  };
}

describe("normalize availability from SimC membership", () => {
  it("derives BASELINE from class and spec membership", () => {
    const candidate = normalizeRecord(
      snapshotFor([
        baseRecord({
          simcMembership: mergeSimcMembership(
            membershipFromScope("class_spell"),
            membershipFromScope("spec_spell"),
          ),
        }),
      ]),
      baseRecord({
        simcMembership: mergeSimcMembership(
          membershipFromScope("class_spell"),
          membershipFromScope("spec_spell"),
        ),
      }),
    );
    expect(candidate.availability).toBe("BASELINE");
  });

  it("prefers TALENT when class and talent_spell memberships merge", () => {
    const classCandidate = normalizeRecord(
      snapshotFor([baseRecord({ spellId: 113656, name: "Fists of Fury", simcMembership: membershipFromScope("class_spell") })]),
      baseRecord({ spellId: 113656, name: "Fists of Fury", simcMembership: membershipFromScope("class_spell") }),
    );
    const talentCandidate = normalizeRecord(
      snapshotFor([baseRecord({ spellId: 113656, name: "Fists of Fury", simcMembership: membershipFromScope("talent_spell") })]),
      baseRecord({ spellId: 113656, name: "Fists of Fury", simcMembership: membershipFromScope("talent_spell") }),
    );
    const merged = mergeCandidates([classCandidate, talentCandidate])[0]!;
    expect(merged.availability).toBe("TALENT");
    expect(merged.simcMembership).toEqual(
      mergeSimcMembership(membershipFromScope("class_spell"), membershipFromScope("talent_spell")),
    );
  });
});

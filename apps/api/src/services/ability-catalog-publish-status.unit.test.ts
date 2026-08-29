import { describe, expect, it } from "vitest";
import {
  assertHasPublishableChanges,
  filterDraftRefsNotSuppressedByTombstone,
  resolvePublishStatusFromPending,
} from "./ability-catalog-publish-service.js";

describe("resolvePublishStatusFromPending", () => {
  it("returns NO_CHANGES when there are no publishable changes or blockers", () => {
    expect(
      resolvePublishStatusFromPending({
        blockingIssues: [],
        hasPublishableChanges: false,
        unclassifiedCandidateCount: 0,
      }),
    ).toBe("NO_CHANGES");
  });

  it("returns NEEDS_CLASSIFICATION when only unclassified candidates remain", () => {
    expect(
      resolvePublishStatusFromPending({
        blockingIssues: [],
        hasPublishableChanges: false,
        unclassifiedCandidateCount: 3,
      }),
    ).toBe("NEEDS_CLASSIFICATION");
  });

  it("returns READY when publishable changes exist", () => {
    expect(
      resolvePublishStatusFromPending({
        blockingIssues: [],
        hasPublishableChanges: true,
        unclassifiedCandidateCount: 0,
      }),
    ).toBe("READY");
  });

  it("returns BLOCKED when blocking issues exist even with publishable changes", () => {
    expect(
      resolvePublishStatusFromPending({
        blockingIssues: [{ code: "INCOMPLETE_ACCEPTED_DRAFT", message: "needs metadata" }],
        hasPublishableChanges: true,
        unclassifiedCandidateCount: 2,
      }),
    ).toBe("BLOCKED");
  });
});

describe("assertHasPublishableChanges", () => {
  it("throws NO_PENDING_CHANGES when nothing is publishable", () => {
    expect(() => assertHasPublishableChanges(false)).toThrowError(
      expect.objectContaining({ code: "NO_PENDING_CHANGES" }),
    );
  });

  it("does not throw when publishable changes exist", () => {
    expect(() => assertHasPublishableChanges(true)).not.toThrow();
  });
});

describe("filterDraftRefsNotSuppressedByTombstone", () => {
  it("suppresses included drafts when durable exclusion targets the same key", () => {
    const refs = [{ draftRuleId: "draft-1", draftVersion: 1 }];
    const keyById = new Map([["draft-1", "death-knight.refresh.death-coil"]]);
    const suppressed = new Set(["death-knight.refresh.death-coil"]);

    expect(filterDraftRefsNotSuppressedByTombstone(refs, keyById, suppressed)).toEqual([]);
  });

  it("suppresses included drafts when confirmed removal targets the same key", () => {
    const refs = [{ draftRuleId: "draft-2", draftVersion: 1 }];
    const keyById = new Map([["draft-2", "death-knight.battle-rez.raise-ally"]]);
    const suppressed = new Set(["death-knight.battle-rez.raise-ally"]);

    expect(filterDraftRefsNotSuppressedByTombstone(refs, keyById, suppressed)).toEqual([]);
  });

  it("keeps unrelated included drafts", () => {
    const refs = [
      { draftRuleId: "draft-3", draftVersion: 1 },
      { draftRuleId: "draft-4", draftVersion: 1 },
    ];
    const keyById = new Map([
      ["draft-3", "death-knight.refresh.death-coil"],
      ["draft-4", "priest.shadow.vampiric-embrace-15286"],
    ]);
    const suppressed = new Set(["death-knight.refresh.death-coil"]);

    expect(filterDraftRefsNotSuppressedByTombstone(refs, keyById, suppressed)).toEqual([
      { draftRuleId: "draft-4", draftVersion: 1 },
    ]);
  });
});

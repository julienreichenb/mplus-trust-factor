/**
 * Canonical capability-package supersession head selection (provider-free).
 */
import { describe, expect, it } from "vitest";
import {
  PackageSupersessionGraphError,
  resolveSupersedesCompatibilityKey,
  selectCanonicalCompatiblePackageHead,
  selectCurrentCompatiblePackageRow,
} from "./repositories/capability-evidence-package-repository.js";

function row(input: {
  key: string;
  supersedes?: string | null;
  updatedAt: string;
  createdAt?: string;
  id?: string;
  reportCode?: string;
  fightId?: number;
  reportRevision?: number;
}) {
  return {
    id: input.id,
    compatibilityKey: input.key,
    supersedesCompatibilityKey: input.supersedes ?? null,
    updatedAt: new Date(input.updatedAt),
    createdAt: new Date(input.createdAt ?? input.updatedAt),
    reportCode: input.reportCode ?? "RycgPJ9rjxT6v1Bw",
    fightId: input.fightId ?? 17,
    reportRevision: input.reportRevision ?? 11,
  };
}

describe("selectCanonicalCompatiblePackageHead", () => {
  it("returns the sole package when it has no successor", () => {
    const alone = row({
      key: "only",
      updatedAt: "2026-08-05T21:00:00.000Z",
    });
    const selected = selectCanonicalCompatiblePackageHead([alone]);
    expect(selected.head.compatibilityKey).toBe("only");
    expect(selected.supersededKeys).toEqual([]);
    expect(selectCurrentCompatiblePackageRow([alone])?.compatibilityKey).toBe("only");
  });

  it("returns the successor and excludes the retained prior package", () => {
    const prior = row({
      id: "old",
      key: "old-key",
      updatedAt: "2026-08-05T21:00:00.000Z",
    });
    const next = row({
      id: "new",
      key: "new-key",
      supersedes: "old-key",
      updatedAt: "2026-08-06T14:00:00.000Z",
    });
    const selected = selectCanonicalCompatiblePackageHead([prior, next]);
    expect(selected.head.compatibilityKey).toBe("new-key");
    expect(selected.supersededKeys).toEqual(["old-key"]);
    expect(prior.supersedesCompatibilityKey).toBeNull();
  });

  it("fails closed when multiple unsuperseded heads exist", () => {
    expect(() =>
      selectCanonicalCompatiblePackageHead([
        row({ key: "a", updatedAt: "2026-08-05T21:00:00.000Z" }),
        row({ key: "b", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]),
    ).toThrow(PackageSupersessionGraphError);
    try {
      selectCanonicalCompatiblePackageHead([
        row({ key: "a", updatedAt: "2026-08-05T21:00:00.000Z" }),
        row({ key: "b", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSupersessionGraphError);
      expect((error as PackageSupersessionGraphError).code).toBe(
        "PACKAGE_SUPERSESSION_MULTIPLE_HEADS",
      );
    }
  });

  it("fails closed on cyclic supersession", () => {
    expect(() =>
      selectCanonicalCompatiblePackageHead([
        row({ key: "a", supersedes: "b", updatedAt: "2026-08-05T21:00:00.000Z" }),
        row({ key: "b", supersedes: "a", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]),
    ).toThrow(PackageSupersessionGraphError);
    try {
      selectCanonicalCompatiblePackageHead([
        row({ key: "a", supersedes: "b", updatedAt: "2026-08-05T21:00:00.000Z" }),
        row({ key: "b", supersedes: "a", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]);
    } catch (error) {
      expect((error as PackageSupersessionGraphError).code).toBe(
        "PACKAGE_SUPERSESSION_CYCLE",
      );
    }
  });

  it("fails closed on self-supersession without a unique peer", () => {
    expect(() =>
      selectCanonicalCompatiblePackageHead([
        row({ key: "solo", supersedes: "solo", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]),
    ).toThrow(PackageSupersessionGraphError);
    try {
      selectCanonicalCompatiblePackageHead([
        row({ key: "solo", supersedes: "solo", updatedAt: "2026-08-06T14:00:00.000Z" }),
      ]);
    } catch (error) {
      expect((error as PackageSupersessionGraphError).code).toBe(
        "PACKAGE_SELF_SUPERSESSION",
      );
    }
  });

  it("rejects a successor candidate from another source fight", () => {
    expect(() =>
      selectCanonicalCompatiblePackageHead([
        row({
          key: "a",
          updatedAt: "2026-08-05T21:00:00.000Z",
          reportCode: "RycgPJ9rjxT6v1Bw",
          fightId: 17,
        }),
        row({
          key: "b",
          supersedes: "a",
          updatedAt: "2026-08-06T14:00:00.000Z",
          reportCode: "RycgPJ9rjxT6v1Bw",
          fightId: 18,
        }),
      ]),
    ).toThrow(PackageSupersessionGraphError);
    try {
      selectCanonicalCompatiblePackageHead([
        row({
          key: "a",
          updatedAt: "2026-08-05T21:00:00.000Z",
          fightId: 17,
        }),
        row({
          key: "b",
          supersedes: "a",
          updatedAt: "2026-08-06T14:00:00.000Z",
          fightId: 18,
        }),
      ]);
    } catch (error) {
      expect((error as PackageSupersessionGraphError).code).toBe(
        "PACKAGE_SUPERSESSION_SOURCE_MISMATCH",
      );
    }
  });

  it("resolves the real canary partial-state self-supersession shape", () => {
    const oldKey =
      "wcl-capability-evidence|RycgPJ9rjxT6v1Bw|r11|f17|PACKAGE|caps:cb591fc3f416a243|actors:d7ea61681b2e66a3|abilities:37003bce15ac1660|catalog:12.0.0/midnight-season-1|capability-acquisition-plan-v1|wcl-graphql-v2-events|PRODUCTION_CAPABILITY_ACQUISITION";
    const newKey =
      "wcl-capability-evidence|RycgPJ9rjxT6v1Bw|r11|f17|PACKAGE|caps:cb591fc3f416a243|actors:57061ae89d4459a9|abilities:37003bce15ac1660|catalog:12.0.0/midnight-season-1|capability-acquisition-plan-v1|wcl-graphql-v2-events|PRODUCTION_CAPABILITY_ACQUISITION";
    const prior = row({
      id: "69fd239c-11f3-4d5e-9e1e-b723104bd56b",
      key: oldKey,
      updatedAt: "2026-08-05T21:39:01.999Z",
      createdAt: "2026-08-05T21:39:01.999Z",
    });
    // Corrupt write: supersedesCompatibilityKey accidentally equals own key.
    const corruptedSuccessor = row({
      id: "6a207360-9bd6-403c-a936-4cce599bdc33",
      key: newKey,
      supersedes: newKey,
      updatedAt: "2026-08-06T14:28:15.636Z",
      createdAt: "2026-08-06T14:09:08.969Z",
    });
    const selected = selectCanonicalCompatiblePackageHead([prior, corruptedSuccessor]);
    expect(selected.head.id).toBe("6a207360-9bd6-403c-a936-4cce599bdc33");
    expect(selected.head.compatibilityKey).toBe(newKey);
    expect(selected.supersededKeys).toEqual([oldKey]);
    expect(selected.repairedSelfSupersession).toBe(true);
  });
});

describe("resolveSupersedesCompatibilityKey", () => {
  it("keeps a valid prior key and never writes self-supersession", () => {
    expect(
      resolveSupersedesCompatibilityKey({
        packageCompatibilityKey: "new-key",
        requestedSupersedesCompatibilityKey: "old-key",
        peerCompatibilityKeys: ["old-key", "new-key"],
      }),
    ).toBe("old-key");

    expect(
      resolveSupersedesCompatibilityKey({
        packageCompatibilityKey: "new-key",
        requestedSupersedesCompatibilityKey: "new-key",
        peerCompatibilityKeys: ["old-key", "new-key"],
      }),
    ).toBe("old-key");

    expect(
      resolveSupersedesCompatibilityKey({
        packageCompatibilityKey: "solo",
        requestedSupersedesCompatibilityKey: "solo",
        peerCompatibilityKeys: ["solo"],
      }),
    ).toBeNull();
  });
});

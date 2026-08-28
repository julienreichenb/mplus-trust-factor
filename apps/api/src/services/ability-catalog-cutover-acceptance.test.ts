/**
 * Phase 3B.6 — production cutover acceptance.
 * Racial: frozen digests with Shadowmeld activations (extracted from local WclRunRaw/digest evidence).
 * Trust: normal scoreCharacter path under STATIC vs explicit Bootstrap RELEASE pin.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  createStaticAbilityCatalogContext,
} from "@mplus/abilities";
import {
  compileBootstrapRelease0,
  createReleaseAbilityCatalogContext,
} from "@mplus/abilities/release";
import {
  assertParticipantScoringDigestV1,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import { replayCorpusItems } from "./ability-catalog-replay-engine.js";
import type { AbilityCatalogReplayCorpusSelectionMeta } from "./ability-catalog-replay-types.js";
import type { ReplayCorpusCandidate } from "./ability-catalog-replay-corpus.js";

const BOOTSTRAP_RELEASE_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";
const BOOTSTRAP_DIGEST =
  "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761";
const BOOTSTRAP_KEY = "wow-unknown-static/catalog-v1/fe8c9a03";
const SHADOWMELD = 58984;

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/ability-catalog-racial-cutover.json",
);

type RacialFixture = {
  count: number;
  digests: unknown[];
  racialActivationCounts: Array<{
    reportCode: string;
    racialDefensive: number;
    racialOffensive: number;
  }>;
};

function loadRacialDigests(): ParticipantScoringDigestV1[] {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as RacialFixture;
  expect(raw.count).toBeGreaterThan(0);
  return raw.digests.map((d) => assertParticipantScoringDigestV1(d));
}

function toItem(digest: ParticipantScoringDigestV1, id: string): ReplayCorpusCandidate {
  return {
    digestRowId: id,
    digest,
    classSlugNorm: digest.classSlug,
    specSlugNorm: digest.specSlug,
    role: digest.role,
    coverageStatus: "AVAILABLE_NATIVE_V4",
  };
}

function emptyCorpusMeta(selected: number): AbilityCatalogReplayCorpusSelectionMeta {
  return {
    maxPerSpec: 3,
    maxTotal: 120,
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    availableCount: selected,
    selectedCount: selected,
    unsupportedSchemaCount: 0,
    corruptCount: 0,
    expectedSpecCount: 40,
    nativeV4SpecCount: selected,
    derivedSpecCount: 0,
    missingSpecCount: 40 - selected,
    corpusCoveragePass: false,
    coverage: {
      classes: { available: [], selected: [], missing: [] },
      specs: {
        available: [],
        selected: [],
        missing: [],
        expected: [],
        nativeV4: [],
        derived: [],
      },
      perSpecStatus: [],
      roles: {
        available: [],
        selected: [],
        missing: [],
        diversity: [],
      },
      racialEvidenceSelected: selected,
      offensiveCooldownEvidenceSelected: 0,
      defensiveCooldownEvidenceSelected: selected,
      utilityInterruptEvidenceSelected: 0,
      unknownSpellIdEvidenceSelected: 0,
      sparseAbilityEvidenceSelected: 0,
      aliasSpellIdEvidenceSelected: 0,
    },
    note: "Phase 3B.6 racial cutover fixture corpus",
  };
}

describe("Phase 3B.6 racial STATIC vs Bootstrap (frozen evidence)", () => {
  const bootstrap = compileBootstrapRelease0();
  const staticCtx = createStaticAbilityCatalogContext();
  const releaseCtx = createReleaseAbilityCatalogContext({
    artifact: bootstrap.artifact,
    releaseId: BOOTSTRAP_RELEASE_ID,
  });

  it("fixture digests contain Shadowmeld racial activations", () => {
    const digests = loadRacialDigests();
    const racialSpellHits = digests.flatMap((d) =>
      d.survival.personalDefensiveActivations
        .filter(
          (a) =>
            a.primarySpellId === SHADOWMELD ||
            a.abilityKey.includes("shared.racial") ||
            (a.observedSpellIds ?? []).includes(SHADOWMELD),
        )
        .map((a) => a.primarySpellId),
    );
    expect(racialSpellHits.length).toBeGreaterThan(0);
    expect(racialSpellHits.every((id) => id === SHADOWMELD)).toBe(true);
  });

  it("racial spell resolution is identical STATIC vs Bootstrap", () => {
    const digests = loadRacialDigests();
    for (const digest of digests) {
      const left = staticCtx.resolveBySpellId({
        spellId: SHADOWMELD,
        classSlug: digest.classSlug,
        specSlug: digest.specSlug,
      });
      const right = releaseCtx.resolveBySpellId({
        spellId: SHADOWMELD,
        classSlug: digest.classSlug,
        specSlug: digest.specSlug,
      });
      expect(left.status).toBe("matched");
      expect(right.status).toBe("matched");
      if (left.status === "matched" && right.status === "matched") {
        expect(left.rule.canonicalKey).toBe("shared.racial.shadowmeld");
        expect(right.rule.canonicalKey).toBe(left.rule.canonicalKey);
        expect(right.rule.spellIds).toEqual(left.rule.spellIds);
        expect(right.rule.category).toBe(left.rule.category);
      }
    }
  });

  it("STATIC vs Bootstrap replay: zero catalog-dependent score delta, zero unexplained errors", () => {
    const digests = loadRacialDigests();
    const report = replayCorpusItems({
      items: digests.map((d, i) => toItem(d, `racial-${i}`)),
      baseCatalog: staticCtx,
      candidateCatalog: releaseCtx,
      corpusMeta: emptyCorpusMeta(digests.length),
      corpusDigest: createHash("sha256")
        .update(`racial-cutover|${digests.length}`)
        .digest("hex"),
      baseMeta: {
        kind: "STATIC",
        releaseId: null,
        releaseKey: null,
        contentDigest: null,
        catalogVersion: CURRENT_CATALOG_VERSION_ID,
      },
      candidateMeta: {
        releaseId: BOOTSTRAP_RELEASE_ID,
        releaseKey: BOOTSTRAP_KEY,
        contentDigest: BOOTSTRAP_DIGEST,
      },
      releaseDiff: { kind: "BOOTSTRAP", entries: [] },
      expectZeroImpact: true,
    });
    expect(report.status).toBe("PASSED");
    expect(report.summary.changedAnalyses).toBe(0);
    expect(report.summary.unresolvedFailures).toBe(0);
    expect(report.summary.utilityChanged).toBe(0);
    expect(report.summary.survivalChanged).toBe(0);
  });
});

describe("Phase 3B.6 Bootstrap identity", () => {
  it("compiled Bootstrap matches accepted contentDigest", () => {
    const bootstrap = compileBootstrapRelease0();
    expect(bootstrap.artifact.contentDigest).toBe(BOOTSTRAP_DIGEST);
    expect(bootstrap.artifact.releaseKey).toBe(BOOTSTRAP_KEY);
    expect(bootstrap.parity.overall).toBe("PASS");
  });
});

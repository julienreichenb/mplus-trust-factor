/**
 * Deterministic identity redaction for public-safe Phase 2 artifacts.
 */

import { createHash } from "node:crypto";
import type {
  BoostShadowBacktestReportV1,
  BoostShadowFeatureRowV1,
} from "./types.js";

function stableAlias(prefix: string, id: string, salt: string): string {
  const digest = createHash("sha256").update(`${salt}|${id}`).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}

function redactFacts(facts: BoostShadowFeatureRowV1["facts"], salt: string) {
  return {
    ...facts,
    subjectCharacterId: stableAlias("subj", facts.subjectCharacterId, salt),
    diagnostics: facts.diagnostics ? { ...facts.diagnostics } : facts.diagnostics,
  };
}

function redactRow(row: BoostShadowFeatureRowV1, salt: string): BoostShadowFeatureRowV1 {
  return {
    ...row,
    memberId: stableAlias("member", row.memberId, salt),
    characterId: stableAlias("char", row.characterId, salt),
    facts: redactFacts(row.facts, salt),
    productionAuthenticity: {
      ...row.productionAuthenticity,
      snapshotId: row.productionAuthenticity.snapshotId
        ? stableAlias("snap", row.productionAuthenticity.snapshotId, salt)
        : null,
    },
  };
}

/**
 * Public-safe report: remove character names, realms, Battle.net IDs,
 * ownership evidence, provider keys, teammate identities.
 */
export function anonymizeBacktestReport(
  report: BoostShadowBacktestReportV1,
): BoostShadowBacktestReportV1 {
  const salt = `${report.cohort.cohortId}|${report.generatedAt}`;
  const ordered = [...report.rows].sort((a, b) => a.memberId.localeCompare(b.memberId));
  const idMap = new Map(
    ordered.map((row) => [row.memberId, stableAlias("member", row.memberId, salt)]),
  );
  const remap = (id: string) => idMap.get(id) ?? stableAlias("member", id, salt);

  const rows = ordered.map((row) => redactRow(row, salt));

  const assignments = report.analysis.splitProvenance.assignments.map((a) => ({
    ...a,
    memberId: remap(a.memberId),
    characterId: stableAlias("char", a.characterId, salt),
    teammateCohortFingerprint: a.teammateCohortFingerprint
      ? stableAlias("cohort", a.teammateCohortFingerprint, salt)
      : null,
  }));

  const publicSafe: BoostShadowBacktestReportV1 = {
    ...report,
    rows,
    analysis: {
      ...report.analysis,
      splitProvenance: {
        ...report.analysis.splitProvenance,
        assignments,
      },
    },
  };

  assertNoIdentityLeakage(publicSafe);
  return publicSafe;
}

export function assertNoIdentityLeakage(report: BoostShadowBacktestReportV1): void {
  const blob = JSON.stringify(report);
  // Field-level checks — avoid false positives on isolation.verifiedOwnershipUsage.
  if (/"displayName"\s*:/.test(blob)) {
    throw new Error("Public-safe report must not include displayName");
  }
  if (/"providerCharacterKey"\s*:/.test(blob)) {
    throw new Error("Public-safe report must not include providerCharacterKey");
  }
  if (/"battleNetAccountId"\s*:/.test(blob) || /"battletag"\s*:/i.test(blob)) {
    throw new Error("Public-safe report must not include Battle.net identifiers");
  }
  if (/"ownershipEvidence"\s*:/.test(blob) || /"ownershipId"\s*:/.test(blob)) {
    throw new Error("Public-safe report must not include ownership evidence");
  }
  if (/"realm"\s*:/.test(blob) || /"realmSlug"\s*:/.test(blob)) {
    throw new Error("Public-safe report must not include realm identity fields");
  }
  // Teammate canonical keys must not appear as array payloads in diagnostics.
  if (/"teammateIds"\s*:/.test(blob) || /"teammateNames"\s*:/.test(blob)) {
    throw new Error("Public-safe report must not include teammate identity lists");
  }
  for (const row of report.rows) {
    if (!row.memberId.startsWith("member_") || !row.characterId.startsWith("char_")) {
      throw new Error("Public-safe row ids must use deterministic redacted aliases");
    }
  }
}

import { isAcceptableSimcSourceRevision } from "../extract/simc-revision.js";
import type {
  AbilitySpellBindingCandidate,
  ExternalSourceRecord,
  ExternalSourceSnapshot,
  ScopedInventory,
} from "../types.js";

export const SIMC_SPELLQUERY_EXPORT_SCHEMA = "simc-spellquery-export-v1" as const;

export interface SimcSpellQueryBinding {
  spellId: number;
  role: AbilitySpellBindingCandidate["role"];
  evidence?: string;
}

export interface SimcSpellQuerySpell {
  spellId: number;
  name: string;
  classSlug?: string | null;
  specSlugs?: string[];
  raceSlugs?: string[];
  cooldownSeconds?: number | null;
  charges?: number | null;
  stacks?: number | null;
  isPassive?: boolean | null;
  catalogRelevant?: boolean;
  bindings?: SimcSpellQueryBinding[];
  proposedCanonicalKey?: string;
  notes?: string[];
}

export interface SimcSpellQueryExport {
  schemaVersion: typeof SIMC_SPELLQUERY_EXPORT_SCHEMA;
  simcCommitSha: string;
  simcBranch?: string;
  extractorVersion: string;
  retrievedAt: string;
  sourceVersion?: string;
  gameVersion?: string;
  validFromBuild?: string;
  validToBuild?: string;
  seasonSlug?: string;
  datasetKind?: "FIXTURE" | "PINNED";
  inventories: ScopedInventory[];
  spells: SimcSpellQuerySpell[];
  binaryIdentity?: {
    applicationVersion: string | null;
    wowBuild: string | null;
    gitRevision: string | null;
    dataMode: "LIVE" | "PTR" | "UNKNOWN";
    executablePath: string;
    binaryReportedRevision?: string | null;
    resolvedFullRevision?: string | null;
    revisionPrecision?: "FULL_SHA" | "PREFIX" | "UNKNOWN";
  };
  extractionStats?: {
    processCount: number;
    durationMs: number;
    rawXmlBytes: number;
  };
}

/**
 * SimulationCraft shadow adapter.
 * Imports a versioned SpellQuery-compatible export. Does not parse SimC C++.
 * Live extraction (pinned simc binary / SpellQuery) is an external tooling step.
 */
export function importSimcSpellQuerySnapshot(file: SimcSpellQueryExport): ExternalSourceSnapshot {
  if (file.schemaVersion !== SIMC_SPELLQUERY_EXPORT_SCHEMA) {
    throw new Error(`Unsupported SimC export schema ${file.schemaVersion}`);
  }
  if (!isAcceptableSimcSourceRevision(file.simcCommitSha)) {
    throw new Error(
      "SimC snapshot must include a git commit SHA (40 hex) or honest binary-reported prefix (7-39 hex)",
    );
  }

  const records: ExternalSourceRecord[] = file.spells.map((s) => ({
    spellId: s.spellId,
    name: s.name,
    classSlug: s.classSlug ?? null,
    specSlugs: s.specSlugs ?? [],
    raceSlugs: s.raceSlugs ?? [],
    cooldownSeconds: s.cooldownSeconds ?? null,
    charges: s.charges ?? null,
    stacks: s.stacks ?? null,
    isPassive: s.isPassive ?? null,
    catalogRelevant: s.catalogRelevant ?? s.isPassive === false,
    proposedCanonicalKey: s.proposedCanonicalKey,
    notes: s.notes,
    bindings: s.bindings?.map((b) => ({
      spellId: b.spellId,
      role: b.role,
      source: "SIMULATIONCRAFT" as const,
      certainty: "unverified" as const,
      evidence: b.evidence ?? "simc-spellquery-export",
    })),
  }));

  return {
    identity: {
      source: "SIMULATIONCRAFT",
      datasetKind: file.datasetKind ?? "PINNED",
      sourceVersion: file.sourceVersion ?? file.extractorVersion,
      sourceRevision: file.simcCommitSha,
      retrievedAt: file.retrievedAt,
      validFromBuild: file.validFromBuild,
      validToBuild: file.validToBuild,
      seasonSlug: file.seasonSlug,
      captureProvenance: file.datasetKind === "FIXTURE" ? "SYNTHETIC_CONTRACT" : "REAL_CAPTURE",
      applicationVersion: file.binaryIdentity?.applicationVersion ?? null,
      dataMode: file.binaryIdentity?.dataMode ?? null,
      revisionPrecision: file.binaryIdentity?.revisionPrecision ?? null,
      binaryReportedRevision:
        file.binaryIdentity?.binaryReportedRevision ?? file.binaryIdentity?.gitRevision ?? null,
      resolvedFullRevision: file.binaryIdentity?.resolvedFullRevision ?? null,
    },
    simulationCraft: {
      gitCommitSha: file.simcCommitSha,
      branch: file.simcBranch,
      extractorVersion: file.extractorVersion,
      applicationVersion: file.binaryIdentity?.applicationVersion,
      wowBuild: file.binaryIdentity?.wowBuild,
      gitRevision: file.binaryIdentity?.gitRevision,
      dataMode: file.binaryIdentity?.dataMode,
      executablePath: file.binaryIdentity?.executablePath,
      binaryReportedRevision:
        file.binaryIdentity?.binaryReportedRevision ?? file.binaryIdentity?.gitRevision ?? null,
      resolvedFullRevision: file.binaryIdentity?.resolvedFullRevision ?? null,
      revisionPrecision: file.binaryIdentity?.revisionPrecision,
    },
    inventories: file.inventories.map((inv) => ({
      ...inv,
      claimsCompleteToolkit: false,
      queryClaim: inv.queryClaim ?? (inv.completeness === "COMPLETE" ? "COMPLETE_FOR_QUERY" : "NONE"),
    })),
    records,
  };
}

export function createSimcRefreshAdapter(options: {
  snapshot: SimcSpellQueryExport;
}): { loadSnapshot: () => ExternalSourceSnapshot } {
  return {
    loadSnapshot: () => importSimcSpellQuerySnapshot(options.snapshot),
  };
}

import { assertSnapshotIdentity, isForbiddenMutableIdentity } from "./snapshot-identity.js";
import { isAcceptableSimcSourceRevision } from "./extract/simc-revision.js";
import {
  isKnownRetailClassSlug,
  isKnownRetailRaceSlug,
  isKnownRetailSpec,
  isRetailStaticNamespace,
} from "./topology.js";
import type {
  AbilitySpellBindingCandidate,
  CatalogRefreshValidationReport,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
  RefreshValidationIssue,
} from "./types.js";

function issue(
  severity: RefreshValidationIssue["severity"],
  code: string,
  message: string,
  extra?: Partial<RefreshValidationIssue>,
): RefreshValidationIssue {
  return { severity, code, message, ...extra };
}

export function validateRefreshSnapshots(
  snapshots: ExternalSourceSnapshot[],
): CatalogRefreshValidationReport {
  const errors: RefreshValidationIssue[] = [];
  const warnings: RefreshValidationIssue[] = [];

  for (const snap of snapshots) {
    for (const msg of assertSnapshotIdentity(snap.identity)) {
      errors.push(issue("error", "MALFORMED_SNAPSHOT_IDENTITY", msg));
    }
    if (snap.identity.source === "BLIZZARD") {
      const ns = snap.blizzard?.namespace;
      if (!ns || !isRetailStaticNamespace(ns)) {
        errors.push(
          issue(
            "error",
            "NON_RETAIL_OR_INVALID_NAMESPACE",
            `Blizzard namespace must be a Retail static-* pin, got ${ns ?? "missing"}`,
          ),
        );
      }
    }
    if (snap.identity.source === "SIMULATIONCRAFT") {
      const sha = snap.simulationCraft?.gitCommitSha ?? snap.identity.sourceRevision;
      if (!isAcceptableSimcSourceRevision(sha)) {
        errors.push(
          issue(
            "error",
            "MALFORMED_SNAPSHOT_IDENTITY",
            "SimC snapshot missing usable commit SHA or binary-reported prefix",
          ),
        );
      }
      if (snap.simulationCraft?.branch && isForbiddenMutableIdentity(snap.simulationCraft.branch) && !sha) {
        errors.push(issue("error", "MALFORMED_SNAPSHOT_IDENTITY", "SimC branch cannot be the sole identity"));
      }
    }
    for (const rec of snap.records) {
      if (!Number.isInteger(rec.spellId) || rec.spellId <= 0) {
        errors.push(issue("error", "INVALID_SPELL_ID", `Invalid spell ID ${rec.spellId}`, { spellId: rec.spellId }));
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function bindingOwnerKey(binding: AbilitySpellBindingCandidate): string {
  return `${binding.spellId}:${binding.role}`;
}

export function validateRefreshCandidates(
  candidates: ExternalAbilityCandidate[],
): CatalogRefreshValidationReport {
  const errors: RefreshValidationIssue[] = [];
  const warnings: RefreshValidationIssue[] = [];
  const keys = new Set<string>();
  const bindingOwners = new Map<string, string>();

  for (const c of candidates) {
    if (!c.candidateKey) {
      errors.push(issue("error", "EMPTY_CANDIDATE_KEY", "Candidate missing candidateKey"));
      continue;
    }
    if (keys.has(c.candidateKey)) {
      errors.push(
        issue("error", "DUPLICATE_CANDIDATE_IDENTITY", `Duplicate candidateKey ${c.candidateKey}`, {
          candidateKey: c.candidateKey,
        }),
      );
    }
    keys.add(c.candidateKey);

    if (!Number.isInteger(c.primarySpellId) || c.primarySpellId <= 0) {
      errors.push(
        issue("error", "INVALID_SPELL_ID", `Invalid primarySpellId ${c.primarySpellId}`, {
          candidateKey: c.candidateKey,
          spellId: c.primarySpellId,
        }),
      );
    }
    if (c.classSlug && !isKnownRetailClassSlug(c.classSlug)) {
      errors.push(
        issue("error", "UNKNOWN_RETAIL_CLASS", `Unknown Retail class ${c.classSlug}`, {
          candidateKey: c.candidateKey,
        }),
      );
    }
    for (const spec of c.specSlugs) {
      if (!c.classSlug) continue;
      if (c.ownershipKind === "PET_TALENT_TREE" || c.ownershipKind === "PSEUDO_SPEC") continue;
      if (!isKnownRetailSpec(c.classSlug, spec)) {
        warnings.push(
          issue(
            "warning",
            "UNKNOWN_TO_CURRENT_TOPOLOGY",
            `External spec ${c.classSlug}/${spec} is unknown to the local Retail matrix`,
            { candidateKey: c.candidateKey },
          ),
        );
      }
    }
    for (const race of c.raceSlugs) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(race)) {
        errors.push(
          issue("error", "INVALID_RACE_APPLICABILITY", `Malformed race slug ${race}`, {
            candidateKey: c.candidateKey,
          }),
        );
        continue;
      }
      if (!isKnownRetailRaceSlug(race)) {
        warnings.push(
          issue(
            "warning",
            "UNKNOWN_TO_CURRENT_TOPOLOGY",
            `External race ${race} is unknown to the local Retail race table`,
            { candidateKey: c.candidateKey },
          ),
        );
      }
    }
    if (c.sourceObservations.length === 0) {
      errors.push(
        issue("error", "IMPOSSIBLE_SOURCE_PROVENANCE", "Candidate has no source observations", {
          candidateKey: c.candidateKey,
        }),
      );
    }
    if (c.certainty === "supported" && c.sourceObservations.every((o) => o.state === "NOT_OBSERVED")) {
      errors.push(
        issue("error", "IMPOSSIBLE_SOURCE_PROVENANCE", "supported certainty without observations", {
          candidateKey: c.candidateKey,
        }),
      );
    }
    for (const b of c.bindings) {
      if (!Number.isInteger(b.spellId) || b.spellId <= 0) {
        errors.push(
          issue("error", "INVALID_SPELL_ID", `Invalid binding spell ID ${b.spellId}`, {
            candidateKey: c.candidateKey,
            spellId: b.spellId,
          }),
        );
      }
      const ownerKey = bindingOwnerKey(b);
      const prev = bindingOwners.get(ownerKey);
      if (prev && prev !== c.candidateKey && b.role === "PRIMARY_ACTIVATION") {
        errors.push(
          issue(
            "error",
            "CONFLICTING_TYPED_BINDING_OWNERSHIP",
            `PRIMARY_ACTIVATION ${b.spellId} claimed by ${prev} and ${c.candidateKey}`,
            { candidateKey: c.candidateKey, spellId: b.spellId },
          ),
        );
      } else if (b.role === "PRIMARY_ACTIVATION") {
        bindingOwners.set(ownerKey, c.candidateKey);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function mergeValidation(
  ...reports: CatalogRefreshValidationReport[]
): CatalogRefreshValidationReport {
  const errors = reports.flatMap((r) => r.errors);
  const warnings = reports.flatMap((r) => r.warnings);
  return { valid: errors.length === 0, errors, warnings };
}

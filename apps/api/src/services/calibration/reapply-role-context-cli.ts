/**
 * Re-apply role-context exclusion rules onto an existing resolved.v1.json
 * without provider calls or DB access. Preserves intake.v1.json untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCohortIntake } from "./intake.js";
import { validateSeasonMetaPolicy } from "./meta-policy.js";
import {
  resolveIntakeMember,
  toStrictManifestMember,
  type BlizzardProfileEnrichment,
  type PersistedCharacterLookup,
  type ResolvedMember,
  type ExclusionRecord,
} from "./resolve-member.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "@mplus/scoring";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const COHORT_DIR = resolve(ROOT, "doc/scoring/cohorts/agent11-2026-08-01");
const POLICY_PATH = resolve(ROOT, "doc/scoring/meta-policies/midnight-season-1.meta.v1.json");

export async function main(): Promise<number> {
  const intake = validateCohortIntake(
    JSON.parse(readFileSync(resolve(COHORT_DIR, "intake.v1.json"), "utf8")),
  );
  const policy = validateSeasonMetaPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")));
  if (!intake.ok || !intake.intake || !policy.ok || !policy.policy) {
    console.error("validation failed", intake.errors, policy.errors);
    return 1;
  }

  const prior = JSON.parse(readFileSync(resolve(COHORT_DIR, "resolved.v1.json"), "utf8")) as {
    members: Array<ResolvedMember & { provenance?: Record<string, unknown> }>;
  };
  const byId = new Map(prior.members.map((m) => [m.id, m]));
  const nowIso = new Date().toISOString();
  const resolvedMembers: ResolvedMember[] = [];
  const exclusions: ExclusionRecord[] = [];

  for (const member of intake.intake.members) {
    const prev = byId.get(member.id);
    const blizzard: BlizzardProfileEnrichment | null = prev
      ? {
          blizzardCharacterId: prev.blizzardCharacterId,
          classSlug: prev.classSlug,
          specSlug: prev.specSlug,
          role:
            typeof prev.provenance?.activeProfileRole === "string"
              ? (prev.provenance.activeProfileRole as "DPS" | "TANK" | "HEALER")
              : prev.roleMismatch && prev.providedRole
                ? // recover active role from mismatch: if provided was kept as resolvedRole, use matrix from class/spec
                  null
                : (prev.resolvedRole as "DPS" | "TANK" | "HEALER" | null),
          level:
            typeof prev.provenance?.blizzardLevel === "number" ? prev.provenance.blizzardLevel : null,
          faction:
            typeof prev.provenance?.blizzardFaction === "string"
              ? prev.provenance.blizzardFaction
              : null,
          displayName: prev.character,
          realmSlug: prev.realm,
        }
      : null;

    // Prefer stored active profile role from provenance; else derive from class/spec on prior row.
    if (blizzard && !blizzard.role && prev?.classSlug && prev.specSlug) {
      const { resolveRoleFromClassSpec } = await import("./resolve-member.js");
      blizzard.role = resolveRoleFromClassSpec(prev.classSlug, prev.specSlug);
    }
    // If prior had roleMismatch with providedRole kept on resolvedRole, active role is class/spec role.
    if (blizzard && prev?.roleMismatch && prev.providedRole && prev.classSlug && prev.specSlug) {
      const { resolveRoleFromClassSpec } = await import("./resolve-member.js");
      blizzard.role = resolveRoleFromClassSpec(prev.classSlug, prev.specSlug);
    }

    const persisted: PersistedCharacterLookup | null = prev?.characterId
      ? {
          characterId: prev.characterId,
          blizzardCharacterId: prev.blizzardCharacterId,
          role: (prev.resolvedRole as "DPS" | "TANK" | "HEALER" | null) ?? null,
          classSlug: prev.classSlug,
          specSlug: prev.specSlug,
          level: null,
          faction: null,
          lastPublicRefreshAt: null,
          snapshotIds: prev.snapshotIds ?? [],
          incompleteBootstrap: false,
        }
      : null;

    const { resolved, exclusion } = resolveIntakeMember({
      member,
      policy: policy.policy,
      persisted,
      blizzard,
      nowIso,
      myzouthRecoveryComplete: false,
      petbearRoleContextsProvenDistinct: false,
      roleContextProvenAtCutoff: false,
    });

    // Preserve Blizzard metadata fields from prior enrichment.
    if (prev) {
      resolved.classSlug = prev.classSlug;
      resolved.specSlug = prev.specSlug;
      resolved.blizzardCharacterId = prev.blizzardCharacterId;
      if (prev.identityResolutionSource !== "unresolved") {
        resolved.identityResolutionSource = prev.identityResolutionSource;
        resolved.identityResolvedAt = prev.identityResolvedAt ?? nowIso;
      }
    }

    resolvedMembers.push(resolved);
    if (exclusion) exclusions.push(exclusion);
  }

  const manifestMembers = [];
  for (const r of resolvedMembers) {
    const m = toStrictManifestMember(r);
    if (m.ok) manifestMembers.push(m.member);
  }

  const resolvedDoc = {
    schemaVersion: "agent11-resolved-v1",
    cohortId: intake.intake.cohortId,
    generatedAt: nowIso,
    metaPolicyId: policy.policy.policyId,
    metaPolicyEvaluatedAt: policy.policy.evaluatedAt,
    policySeasonSlug: policy.policy.seasonSlug,
    reappliedRoleContextRulesAt: nowIso,
    evidenceDatabaseConfigured: false,
    liveBlizzard: false,
    dryRun: false,
    members: resolvedMembers,
  };

  writeFileSync(resolve(COHORT_DIR, "resolved.v1.json"), JSON.stringify(resolvedDoc, null, 2));
  writeFileSync(
    resolve(COHORT_DIR, "exclusions.v1.json"),
    JSON.stringify(
      {
        schemaVersion: "agent11-exclusions-v1",
        cohortId: intake.intake.cohortId,
        generatedAt: nowIso,
        exclusions,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    resolve(COHORT_DIR, "manifest.v1.json"),
    JSON.stringify(
      {
        schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
        cohortId: `${intake.intake.cohortId}-strict`,
        description:
          "Strict CohortManifest 1.0.0 generated from Agent 11 resolved intake (expert labels preserved).",
        createdAt: intake.intake.createdAt,
        members: manifestMembers,
        notes: `Reapplied role-context rules ${nowIso}; excluded ${exclusions.length} members`,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        excluded: exclusions.map((e) => ({ memberId: e.memberId, reason: e.reason })),
        manifestCount: manifestMembers.length,
      },
      null,
      2,
    ),
  );
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/calibration/reapply-role-context-cli.ts");
  }
}

if (isMain()) {
  main().then((code) => process.exit(code));
}

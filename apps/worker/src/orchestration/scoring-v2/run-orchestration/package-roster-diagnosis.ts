/**
 * Pure helpers for diagnosing / superseding an incorrect capability package
 * without mutating or deleting the prior row.
 */
export type PackageRosterDiagnosis =
  | {
      status: "COMPATIBLE";
      packageActorIds: number[];
      expectedRosterActorIds: number[];
      targetActorId: number;
    }
  | {
      status: "INCOMPATIBLE_TARGET_EXCLUDED";
      packageActorIds: number[];
      expectedRosterActorIds: number[];
      targetActorId: number;
      reason: string;
    }
  | {
      status: "INCOMPATIBLE_ROSTER_MISMATCH";
      packageActorIds: number[];
      expectedRosterActorIds: number[];
      targetActorId: number | null;
      reason: string;
    }
  | {
      status: "TARGET_ACTOR_UNKNOWN";
      packageActorIds: number[];
      expectedRosterActorIds: number[];
      reason: string;
    };

function sortedUnique(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
}

function sameActorSet(a: readonly number[], b: readonly number[]): boolean {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  if (left.length !== right.length) return false;
  return left.every((id, i) => id === right[i]);
}

/**
 * Diagnose whether a persisted package's friendly actors match the fight roster
 * and include the stable target actor.
 */
export function diagnosePackageRosterCompatibility(input: {
  packageActorIds: readonly number[];
  expectedFightRosterActorIds: readonly number[];
  targetActorId: number | null;
}): PackageRosterDiagnosis {
  const packageActorIds = sortedUnique(input.packageActorIds);
  const expectedRosterActorIds = sortedUnique(input.expectedFightRosterActorIds);

  if (input.targetActorId == null) {
    return {
      status: "TARGET_ACTOR_UNKNOWN",
      packageActorIds,
      expectedRosterActorIds,
      reason: "stable_identity_could_not_resolve_target_actor_on_roster",
    };
  }

  if (!packageActorIds.includes(input.targetActorId)) {
    return {
      status: "INCOMPATIBLE_TARGET_EXCLUDED",
      packageActorIds,
      expectedRosterActorIds,
      targetActorId: input.targetActorId,
      reason: `package_actors_exclude_target:${input.targetActorId}`,
    };
  }

  if (
    expectedRosterActorIds.length > 0 &&
    !sameActorSet(packageActorIds, expectedRosterActorIds)
  ) {
    return {
      status: "INCOMPATIBLE_ROSTER_MISMATCH",
      packageActorIds,
      expectedRosterActorIds,
      targetActorId: input.targetActorId,
      reason: "package_actor_set_differs_from_fight_roster",
    };
  }

  return {
    status: "COMPATIBLE",
    packageActorIds,
    expectedRosterActorIds,
    targetActorId: input.targetActorId,
  };
}

export function isPackageRosterIncompatible(
  diagnosis: PackageRosterDiagnosis,
): boolean {
  return (
    diagnosis.status === "INCOMPATIBLE_TARGET_EXCLUDED" ||
    diagnosis.status === "INCOMPATIBLE_ROSTER_MISMATCH"
  );
}

import { clamp01 } from "../math.js";
import {
  CONCENTRATION_CORE_MAX,
  CONCENTRATION_MIN_OVERLAP_MEMBERS,
  MIN_USABLE_HIGH_KEY_RUNS,
} from "./constants.js";
import {
  isUsableTeammateIdentity,
  resolveCanonicalTeammateIdentity,
} from "./identity.js";
import type { BoostShadowRunInput, FeatureComputeResult } from "./types.js";

interface RosterCore {
  memberKeys: string[];
  overlapCount: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Overlap of the same roster core across most high-key progression.
 * Incomplete rosters lower coverage; small samples omit.
 */
export function computeHighKeyGroupConcentration(args: {
  highKeyRuns: BoostShadowRunInput[];
  subjectCharacterId: string;
}): FeatureComputeResult {
  if (args.highKeyRuns.length < MIN_USABLE_HIGH_KEY_RUNS) {
    return { status: "omitted", reasonCode: "INSUFFICIENT_HIGH_KEYS" };
  }

  const rosters: Array<{ runId: string; members: string[]; hasAmbiguous: boolean }> = [];
  let incomplete = 0;

  for (const run of args.highKeyRuns) {
    const members: string[] = [];
    let ambiguous = false;
    for (const p of run.participants) {
      if (p.isTargetCharacter || p.characterId === args.subjectCharacterId) continue;
      const identity = resolveCanonicalTeammateIdentity(p);
      if (!isUsableTeammateIdentity(identity)) {
        ambiguous = true;
        continue;
      }
      members.push(identity.canonicalKey);
    }
    const unique = [...new Set(members)];
    if (unique.length < CONCENTRATION_MIN_OVERLAP_MEMBERS) {
      incomplete += 1;
      continue;
    }
    rosters.push({ runId: run.runId, members: unique, hasAmbiguous: ambiguous });
  }

  if (rosters.length < MIN_USABLE_HIGH_KEY_RUNS) {
    return {
      status: "omitted",
      reasonCode: incomplete > 0 ? "INCOMPLETE_ROSTERS" : "INSUFFICIENT_HIGH_KEYS",
    };
  }

  // Count co-occurrence of teammate pairs across high keys; expand to cores.
  const pairCounts = new Map<string, { count: number; members: [string, string] }>();
  for (const roster of rosters) {
    const m = roster.members;
    for (let i = 0; i < m.length; i += 1) {
      for (let j = i + 1; j < m.length; j += 1) {
        const key = pairKey(m[i]!, m[j]!);
        const prev = pairCounts.get(key);
        if (prev) prev.count += 1;
        else pairCounts.set(key, { count: 1, members: [m[i]!, m[j]!] });
      }
    }
  }

  let bestCore: RosterCore | null = null;
  for (const { count, members } of pairCounts.values()) {
    if (count < 2) continue;
    // Grow core with members that co-appear on the same runs as this pair.
    const coreSet = new Set(members);
    for (const roster of rosters) {
      if (!members.every((id) => roster.members.includes(id))) continue;
      for (const id of roster.members) {
        if (coreSet.size >= CONCENTRATION_CORE_MAX) break;
        // Add if this id co-occurs with the core on >= half of the pair's overlapping runs.
        coreSet.add(id);
      }
    }

    const coreMembers = [...coreSet].slice(0, CONCENTRATION_CORE_MAX);
    if (coreMembers.length < CONCENTRATION_MIN_OVERLAP_MEMBERS) continue;

    let overlapCount = 0;
    for (const roster of rosters) {
      const hits = coreMembers.filter((id) => roster.members.includes(id)).length;
      if (hits >= CONCENTRATION_MIN_OVERLAP_MEMBERS) overlapCount += 1;
    }

    if (!bestCore || overlapCount > bestCore.overlapCount) {
      bestCore = { memberKeys: coreMembers, overlapCount };
    }
  }

  const highKeyCoreOverlapFraction =
    bestCore && rosters.length > 0 ? bestCore.overlapCount / rosters.length : 0;

  const coverage = rosters.length / args.highKeyRuns.length;
  const ambiguousPenalty = rosters.some((r) => r.hasAmbiguous) ? 0.1 : 0;
  const value = clamp01(highKeyCoreOverlapFraction);
  const confidence = clamp01(0.35 + 0.5 * coverage - ambiguousPenalty);

  return {
    status: "computed",
    evidence: {
      value,
      confidence,
      sampleSize: rosters.length,
      coverage,
    },
    diagnostics: { highKeyCoreOverlapFraction },
  };
}

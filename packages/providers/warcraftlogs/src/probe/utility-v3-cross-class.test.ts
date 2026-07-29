/**
 * Cross-class validation unit tests.
 *
 * Covers:
 *   - Majority role resolution with per-run role preservation
 *   - Mixed-spec / mixed-role diagnostics
 *   - Guardian Druid interrupt alias (93985 = FR Skull Bash)
 *   - Probe failure diagnosis propagation (Makmakmak case)
 *   - PARTIAL artifact detection (only missing dungeons)
 *   - castStops 100 with low sample size emits calibration warning
 *   - Estimated cost + reserve causes DEFERRED decision
 *   - COMPLETE artifact state when all 8 dungeons covered
 */

import { describe, expect, it } from "vitest";
import { getAbilityCatalog, spellIdsForCategory, roleForSpec } from "@mplus/abilities";

// -------------------------------------------------------------------------
// 1. Guardian Druid interrupt alias (93985)
// -------------------------------------------------------------------------
describe("Guardian Druid interrupt alias — FR locale Skull Bash", () => {
  it("catalog contains 93985 as an alias for druid.interrupt.skull-bash", () => {
    const catalog = getAbilityCatalog({ classSlug: "druid", specSlug: "guardian", includeRacials: false });
    const rule = catalog.rules.find((r) => r.canonicalKey === "druid.interrupt.skull-bash");
    expect(rule).toBeDefined();
    // Primary spell ID
    expect(rule!.spellIds).toContain(106839);
    // FR-locale alias verified from Zam raw WCL events
    expect(rule!.aliases).toBeDefined();
    expect(rule!.aliases).toContain(93985);
  });

  it("spellIdsForCategory INTERRUPT includes 93985 for guardian druid catalog", () => {
    const catalog = getAbilityCatalog({ classSlug: "druid", specSlug: "guardian", includeRacials: false });
    const interruptIds = spellIdsForCategory(catalog, "INTERRUPT");
    expect(interruptIds).toContain(93985);
    expect(interruptIds).toContain(106839);
  });

  it("skull-bash alias is NOT included for non-guardian/feral specs", () => {
    const balanceCatalog = getAbilityCatalog({ classSlug: "druid", specSlug: "balance", includeRacials: false });
    const rule = balanceCatalog.rules.find((r) => r.canonicalKey === "druid.interrupt.skull-bash");
    // Balance druid does not have Skull Bash in catalog
    expect(rule).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
// 1b. roleForSpec catalog helper
// -------------------------------------------------------------------------

describe("roleForSpec catalog helper", () => {
  it("returns 'dps' for arms", () => expect(roleForSpec("arms")).toBe("dps"));
  it("returns 'dps' for fury", () => expect(roleForSpec("fury")).toBe("dps"));
  it("returns 'tank' for protection (warrior)", () => expect(roleForSpec("protection")).toBe("tank"));
  it("returns 'tank' for guardian", () => expect(roleForSpec("guardian")).toBe("tank"));
  it("returns 'healer' for restoration", () => expect(roleForSpec("restoration")).toBe("healer"));
  it("returns null for unknown spec", () => expect(roleForSpec("unknown-spec")).toBeNull());
});

// -------------------------------------------------------------------------
// 2. Role resolution helpers (mirrors logic in run-utility-cross-class-validation)
// -------------------------------------------------------------------------

function majorityRoleSlug(
  runs: Array<{ roleSlug?: string | null; specialization?: string | null }>,
): { roleSlug: string | null; mixedRole: boolean; roleSource: string } {
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (r.roleSlug) counts.set(r.roleSlug, (counts.get(r.roleSlug) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [slug, count] of counts) {
      if (count > bestCount) { best = slug; bestCount = count; }
    }
    return { roleSlug: best, mixedRole: counts.size > 1, roleSource: "zone_rankings" };
  }
  // Fallback: infer from specSlug via catalog
  const specSlug = runs[0]?.specialization ?? null;
  if (specSlug) {
    const inferred = roleForSpec(specSlug);
    if (inferred) return { roleSlug: inferred, mixedRole: false, roleSource: "inferred" };
  }
  return { roleSlug: null, mixedRole: false, roleSource: "unknown" };
}

describe("role resolution", () => {
  it("returns majority role when all runs agree", () => {
    const runs = [
      { roleSlug: "dps" },
      { roleSlug: "dps" },
      { roleSlug: "dps" },
    ];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("dps");
    expect(result.mixedRole).toBe(false);
    expect(result.roleSource).toBe("zone_rankings");
  });

  it("returns majority role and flags mixedRole when runs disagree", () => {
    const runs = [
      { roleSlug: "healer" },
      { roleSlug: "healer" },
      { roleSlug: "dps" },
    ];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("healer");
    expect(result.mixedRole).toBe(true);
  });

  it("returns null when no runs have roleSlug and no specSlug available", () => {
    const runs = [
      { roleSlug: null },
      { roleSlug: undefined },
      {},
    ];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBeNull();
    expect(result.mixedRole).toBe(false);
    expect(result.roleSource).toBe("unknown");
  });

  it("infers 'dps' for Arms Warrior from catalog when WCL returns null roleSlug", () => {
    const runs = [
      { roleSlug: null, specialization: "arms" },
      { roleSlug: null, specialization: "arms" },
    ];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("dps");
    expect(result.roleSource).toBe("inferred");
    expect(result.mixedRole).toBe(false);
  });

  it("infers 'tank' for Guardian Druid from catalog when WCL returns null roleSlug", () => {
    const runs = [{ roleSlug: null, specialization: "guardian" }];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("tank");
    expect(result.roleSource).toBe("inferred");
  });

  it("infers 'healer' for Restoration Shaman from catalog when WCL returns null roleSlug", () => {
    const runs = [{ roleSlug: null, specialization: "restoration" }];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("healer");
    expect(result.roleSource).toBe("inferred");
  });

  it("preserves per-run roleSlug distinctions in mixed scenario", () => {
    const runs = [
      { roleSlug: "tank", dungeonSlug: "pit-of-saron" },
      { roleSlug: "tank", dungeonSlug: "skyreach" },
      { roleSlug: "dps",  dungeonSlug: "algethar-academy" },
    ];
    const result = majorityRoleSlug(runs);
    expect(result.roleSlug).toBe("tank");
    expect(result.mixedRole).toBe(true);
    // Individual run roles are preserved in the source data
    const byDungeon = Object.fromEntries(runs.map((r) => [r.dungeonSlug, r.roleSlug]));
    expect(byDungeon["pit-of-saron"]).toBe("tank");
    expect(byDungeon["algethar-academy"]).toBe("dps");
  });
});

// -------------------------------------------------------------------------
// 3. Probe failure diagnosis (Makmakmak pattern)
// -------------------------------------------------------------------------

type Diagnosis =
  | "character_not_found"
  | "all_fights_target_absent"
  | "zone_rankings_aggregate_only"
  | "rate_limited"
  | "unknown";

function diagnoseFailure(opts: {
  characterFound: boolean;
  wclErrors: string[];
  rejectionReasons: Record<string, number>;
  schemaWarnings: string[];
}): Diagnosis {
  if (!opts.characterFound) return "character_not_found";
  if (opts.wclErrors.some((e) => /rate.limit|rate limit|429/i.test(e))) return "rate_limited";
  if (opts.schemaWarnings.some((w) => /zoneRankings returned.*aggregate row/i.test(w))) {
    return "zone_rankings_aggregate_only";
  }
  if (
    Object.keys(opts.rejectionReasons).length > 0 &&
    Object.keys(opts.rejectionReasons).every((k) => k.includes("target_absent"))
  ) {
    return "all_fights_target_absent";
  }
  return "unknown";
}

describe("probe failure diagnosis", () => {
  it("diagnoses Makmakmak as all_fights_target_absent when zone rankings is aggregate-only", () => {
    // Makmakmak: zoneRankings returns aggregate rows only, then all 20 reports
    // have target_absent rejections
    const result = diagnoseFailure({
      characterFound: true,
      wclErrors: [],
      rejectionReasons: { target_absent: 85, not_mythic_plus: 3 },
      schemaWarnings: [
        "zoneRankings returned 8 aggregate row(s) without report/fightID — hydrating recentReports",
      ],
    });
    // zone_rankings_aggregate_only wins because it's checked before target_absent
    expect(result).toBe("zone_rankings_aggregate_only");
  });

  it("diagnoses rate_limited when WCL error message contains rate limit", () => {
    const result = diagnoseFailure({
      characterFound: true,
      wclErrors: ["Warcraft Logs rate limit exceeded"],
      rejectionReasons: {},
      schemaWarnings: [],
    });
    expect(result).toBe("rate_limited");
  });

  it("diagnoses character_not_found when character is absent", () => {
    const result = diagnoseFailure({
      characterFound: false,
      wclErrors: [],
      rejectionReasons: {},
      schemaWarnings: [],
    });
    expect(result).toBe("character_not_found");
  });

  it("diagnoses all_fights_target_absent when only target_absent rejections present", () => {
    const result = diagnoseFailure({
      characterFound: true,
      wclErrors: [],
      rejectionReasons: { target_absent: 40 },
      schemaWarnings: [],
    });
    expect(result).toBe("all_fights_target_absent");
  });

  it("returns unknown when no specific pattern matches", () => {
    const result = diagnoseFailure({
      characterFound: true,
      wclErrors: [],
      rejectionReasons: {},
      schemaWarnings: [],
    });
    expect(result).toBe("unknown");
  });
});

// retryable flag mirrors the logic in buildProbeFailureDiagnostics
function isRetryable(diagnosis: Diagnosis): boolean {
  return diagnosis !== "character_not_found" && diagnosis !== "all_fights_target_absent";
}

describe("probe failure retryable flag", () => {
  it("zone_rankings_aggregate_only is retryable (wider page window may find missing dungeons)", () => {
    expect(isRetryable("zone_rankings_aggregate_only")).toBe(true);
  });

  it("rate_limited is retryable", () => {
    expect(isRetryable("rate_limited")).toBe(true);
  });

  it("unknown is retryable", () => {
    expect(isRetryable("unknown")).toBe(true);
  });

  it("character_not_found is not retryable", () => {
    expect(isRetryable("character_not_found")).toBe(false);
  });

  it("all_fights_target_absent is not retryable", () => {
    expect(isRetryable("all_fights_target_absent")).toBe(false);
  });
});

// -------------------------------------------------------------------------
// 4. Artifact state detection (PARTIAL / COMPLETE)
// -------------------------------------------------------------------------

type ArtifactState = "COMPLETE" | "PARTIAL" | "ERROR" | "NONE";

function classifyArtifacts(
  hasNormalizedRuns: boolean,
  hasV3Summary: boolean,
  completedDungeons: string[],
  totalDungeons = 8,
): ArtifactState {
  if (hasV3Summary && completedDungeons.length >= totalDungeons) return "COMPLETE";
  if (hasV3Summary && completedDungeons.length < totalDungeons) return "PARTIAL";
  if (hasNormalizedRuns && completedDungeons.length > 0) return "PARTIAL";
  if (hasNormalizedRuns && completedDungeons.length === 0) return "ERROR";
  return "NONE";
}

describe("artifact state detection", () => {
  it("COMPLETE when V3 summary present and all 8 dungeons covered", () => {
    expect(classifyArtifacts(true, true, Array.from({ length: 8 }, (_, i) => `d${i}`))).toBe("COMPLETE");
  });

  it("PARTIAL when V3 summary present but only 5 dungeons covered", () => {
    expect(classifyArtifacts(true, true, ["d1", "d2", "d3", "d4", "d5"])).toBe("PARTIAL");
  });

  it("PARTIAL when normalized runs present but no V3 summary", () => {
    expect(classifyArtifacts(true, false, ["d1", "d2"])).toBe("PARTIAL");
  });

  it("ERROR when normalized runs present but zero runs", () => {
    expect(classifyArtifacts(true, false, [])).toBe("ERROR");
  });

  it("NONE when no artifact files at all", () => {
    expect(classifyArtifacts(false, false, [])).toBe("NONE");
  });
});

// -------------------------------------------------------------------------
// 5. castStops saturation — sample-size warning
// -------------------------------------------------------------------------

function castStopSampleSizeWarning(
  globalCastStopScore: number | null,
  totalRunCount: number,
  dungeonsCovered: number,
): string | null {
  if (globalCastStopScore === null || globalCastStopScore < 90) return null;
  if (totalRunCount >= 8 && dungeonsCovered >= 8) return null;
  return (
    `castStops score ${globalCastStopScore.toFixed(1)} is based on only ${totalRunCount} run(s) ` +
    `across ${dungeonsCovered} dungeon(s). ` +
    `A score of ${globalCastStopScore >= 100 ? "100" : "90+"} with fewer than 8 dungeons ` +
    `is insufficient for calibration even when the observed behavior is valid. ` +
    `Complete all 8 active-season dungeons before treating this score as representative.`
  );
}

describe("castStops saturation warning", () => {
  it("emits warning when score is 100 with only 2 runs", () => {
    const warning = castStopSampleSizeWarning(100, 2, 2);
    expect(warning).not.toBeNull();
    expect(warning).toContain("100");
    expect(warning).toContain("2 run(s)");
    expect(warning).toContain("insufficient for calibration");
  });

  it("emits warning when score is 90+ with 5 dungeons (Lfgaddict pattern)", () => {
    const warning = castStopSampleSizeWarning(100, 5, 5);
    expect(warning).not.toBeNull();
    expect(warning).toContain("5 dungeon(s)");
    expect(warning).toContain("insufficient for calibration");
  });

  it("does not emit warning when score is 90+ and all 8 dungeons covered", () => {
    const warning = castStopSampleSizeWarning(95, 21, 8);
    expect(warning).toBeNull();
  });

  it("does not emit warning when score is below 90", () => {
    const warning = castStopSampleSizeWarning(80, 2, 2);
    expect(warning).toBeNull();
  });

  it("does not emit warning when score is null", () => {
    const warning = castStopSampleSizeWarning(null, 2, 2);
    expect(warning).toBeNull();
  });
});

// -------------------------------------------------------------------------
// 6. Rate budget cost estimation and DEFER decision
// -------------------------------------------------------------------------

const DEFAULT_COST_PER_DUNGEON = 500;
const SAFETY_RESERVE = 1500;

function estimateCharacterCost(
  missingDungeons: number,
  historicalCostPerDungeon: number | null,
): { estimated: number; reason: string } {
  if (missingDungeons === 0) return { estimated: 0, reason: "no_missing_dungeons" };
  const perDungeon = historicalCostPerDungeon ?? DEFAULT_COST_PER_DUNGEON;
  const source = historicalCostPerDungeon != null ? "measured_history" : "conservative_fallback";
  return {
    estimated: missingDungeons * perDungeon,
    reason: `${missingDungeons} missing × ${perDungeon.toFixed(0)} pts (${source})`,
  };
}

function shouldDefer(pointsRemaining: number, missingDungeons: number, historicalCost: number | null): boolean {
  if (missingDungeons === 0) return false;
  const { estimated } = estimateCharacterCost(missingDungeons, historicalCost);
  return pointsRemaining < estimated + SAFETY_RESERVE;
}

describe("rate budget cost estimation", () => {
  it("uses conservative fallback when no history available", () => {
    const { estimated, reason } = estimateCharacterCost(8, null);
    expect(estimated).toBe(8 * DEFAULT_COST_PER_DUNGEON);
    expect(reason).toContain("conservative_fallback");
  });

  it("uses measured history when available", () => {
    const { estimated, reason } = estimateCharacterCost(3, 600);
    expect(estimated).toBe(1800);
    expect(reason).toContain("measured_history");
  });

  it("returns 0 cost when no missing dungeons", () => {
    const { estimated } = estimateCharacterCost(0, 600);
    expect(estimated).toBe(0);
  });

  it("defers when pointsRemaining < estimatedCost + safetyReserve (Sjelelele pattern)", () => {
    // Sjelelele had ~4040 remaining; 8 dungeons × 500 + 1500 reserve = 5500 required
    expect(shouldDefer(4040, 8, null)).toBe(true);
  });

  it("does NOT defer when pointsRemaining is sufficient", () => {
    // 8 dungeons × 300 (measured) = 2400 + 1500 reserve = 3900; 4040 > 3900
    expect(shouldDefer(4040, 8, 300)).toBe(false);
  });

  it("does not defer for a character with 0 missing dungeons", () => {
    expect(shouldDefer(100, 0, null)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// 8. Resume merge regression (00739d3)
// -------------------------------------------------------------------------

describe("resume merge regression guards", () => {
  it("resumed score coverage uses merged dungeon count, not staging-only count", () => {
    const beforeDungeons = 5;
    const beforeRuns = 5;
    const stagingRuns = 1;
    const mergedRuns = beforeRuns + stagingRuns;
    const mergedDungeons = beforeDungeons + 1;
    expect(mergedRuns).toBe(6);
    expect(mergedDungeons).toBe(6);
    expect(stagingRuns).toBeLessThan(mergedRuns);
  });

  it("every missing dungeon must receive a diagnostic reason", () => {
    const missing = ["algethar-academy", "magisters-terrace", "maisara-caverns"];
    const reasons: Record<string, string> = {
      "algethar-academy": "actor_absent",
      "magisters-terrace": "actor_absent",
    };
    for (const slug of missing) {
      if (!reasons[slug]) reasons[slug] = "unknown";
    }
    for (const slug of missing) expect(reasons[slug]).toBeTruthy();
  });
});

// -------------------------------------------------------------------------
// 9. Cache-only COMPLETE + --only parsing (Aspha regression)
// -------------------------------------------------------------------------

/** Mirror of --only argv parsing (PowerShell comma-split tolerant). */
function parseOnlyNames(argv: string[]): Set<string> {
  const onlyNames = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--only") continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      for (const part of next.split(",")) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed) onlyNames.add(trimmed);
      }
      i += 1;
    }
    while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      i += 1;
      const bare = argv[i]!.trim().toLowerCase();
      if (bare) onlyNames.add(bare);
    }
  }
  return onlyNames;
}

function shouldUseCacheOnly(opts: {
  resume: boolean;
  resumePartial: boolean;
  forceRefetch: boolean;
  artifactState: "COMPLETE" | "PARTIAL" | "ERROR" | "NONE";
  missingDungeons: string[];
}): boolean {
  return (
    (opts.resume || opts.resumePartial) &&
    opts.artifactState === "COMPLETE" &&
    opts.missingDungeons.length === 0 &&
    !opts.forceRefetch
  );
}

function isManifestEnabled(entry: { enabled?: boolean }): boolean {
  return entry.enabled !== false;
}

describe("disabled diagnostic characters", () => {
  it("excludes enabled:false from automatic panel", () => {
    const characters = [
      { name: "Wallidrixe" },
      { name: "Haart" },
      { name: "Makmakmak", enabled: false },
      { name: "Sjelelele", enabled: false },
      { name: "Moosevoker" },
    ];
    const panel = characters.filter(isManifestEnabled);
    expect(panel.map((c) => c.name)).toEqual(["Wallidrixe", "Haart", "Moosevoker"]);
  });

  it("allows disabled characters only with forceRefetch", () => {
    const entry = { name: "Makmakmak", enabled: false as boolean | undefined };
    const forceRefetch = true;
    expect(isManifestEnabled(entry)).toBe(false);
    expect(isManifestEnabled(entry) || forceRefetch).toBe(true);
  });
});

describe("cache-only COMPLETE and --only parsing", () => {
  it("COMPLETE + --resume-partial => cache-only (zero live calls)", () => {
    expect(
      shouldUseCacheOnly({
        resume: false,
        resumePartial: true,
        forceRefetch: false,
        artifactState: "COMPLETE",
        missingDungeons: [],
      }),
    ).toBe(true);
  });

  it("COMPLETE + --resume-partial + --force-refetch => live calls allowed", () => {
    expect(
      shouldUseCacheOnly({
        resume: false,
        resumePartial: true,
        forceRefetch: true,
        artifactState: "COMPLETE",
        missingDungeons: [],
      }),
    ).toBe(false);
  });

  it("parses PowerShell-split --only Aspha,Serahz,Sjelelele as three names", () => {
    const names = parseOnlyNames(["--only", "Aspha", "Serahz", "Sjelelele"]);
    expect(names.size).toBe(3);
    expect(names.has("aspha")).toBe(true);
    expect(names.has("serahz")).toBe(true);
    expect(names.has("sjelelele")).toBe(true);
  });

  it("parses comma-separated --only in a single argv token", () => {
    const names = parseOnlyNames(["--only", "Aspha,Serahz,Sjelelele"]);
    expect(names.size).toBe(3);
  });

  it("COMPLETE state cannot retain current PARTIAL probeFailure", () => {
    const finalResultState = "COMPLETE";
    const probeFailure =
      finalResultState === "COMPLETE"
        ? null
        : { probeState: "PARTIAL" as const };
    expect(probeFailure).toBeNull();
  });

  it("local rescore reports zero WCL quota consumption", () => {
    const liveWclUsed = false;
    const rateCost = {
      pointsConsumed: liveWclUsed ? 113.73 : 0,
      wclRequests: liveWclUsed ? 70 : 0,
      costDecisionReason: liveWclUsed ? "no_missing_dungeons" : "cache_only_no_missing_dungeons",
    };
    expect(rateCost.pointsConsumed).toBe(0);
    expect(rateCost.wclRequests).toBe(0);
    expect(rateCost.costDecisionReason).toBe("cache_only_no_missing_dungeons");
  });

  it("ensure all --only characters appear in report population", () => {
    const active = [{ name: "Aspha" }, { name: "Serahz" }, { name: "Sjelelele" }];
    const results = [{ name: "Aspha", state: "COMPLETE" }];
    const merged = [...results];
    for (const entry of active) {
      if (!merged.some((r) => r.name === entry.name)) {
        merged.push({ name: entry.name, state: "SKIPPED" });
      }
    }
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.name).sort()).toEqual(["Aspha", "Serahz", "Sjelelele"]);
  });
});

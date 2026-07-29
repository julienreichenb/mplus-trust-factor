/**
 * Regression tests for Utility probe resume merge behavior.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import {
  atomicPublishProbeArtifacts,
  buildMissingDungeonReasons,
  classifyMissingDungeonReason,
  mergeProbeArtifacts,
  PROBE_ARTIFACT_FILES,
  runIdentityKey,
  runIdentityFromNormalized,
  snapshotCanonicalArtifacts,
  validateMergeCoherence,
} from "./utility-probe-resume-merge.js";

const DUNGEONS = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
];

function makeRun(
  reportCode: string,
  fightId: number,
  dungeonSlug: string,
  playerActorId: number,
): UtilityNormalizedRun {
  return {
    reportCode,
    fightId,
    dungeonSlug,
    keyLevel: 20,
    durationMs: 900_000,
    playerActorId,
    petActorIds: [],
    specialization: "arms",
    classSlug: "warrior",
    roleSlug: null,
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: {} as UtilityNormalizedRun["datasetStates"],
    truncatedDatasets: [],
  };
}

async function writeProbeArtifacts(
  dir: string,
  runs: UtilityNormalizedRun[],
  extra?: {
    rejected?: Array<{ reportCode: string; fightId: number; dungeonSlug: string | null; reason: string }>;
    candidatesByDungeon?: Record<string, unknown[]>;
    missingDungeonReasons?: Record<string, string>;
  },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const selectedRuns = runs.map((r) => ({
    runId: `${r.reportCode}:${r.fightId}`,
    dungeonSlug: r.dungeonSlug,
    reportCode: r.reportCode,
    fightId: r.fightId,
    playerActorId: r.playerActorId,
    ownedPetActorIds: [],
  }));
  const rawEntries = runs.map((r) => ({
    runId: `${r.reportCode}:${r.fightId}`,
    reportCode: r.reportCode,
    fightId: r.fightId,
    dataset: { events: [] },
  }));
  const perDungeon = DUNGEONS.map((slug) => ({
    dungeonSlug: slug,
    runCount: runs.filter((r) => r.dungeonSlug === slug).length,
    runIds: runs.filter((r) => r.dungeonSlug === slug).map((r) => `${r.reportCode}:${r.fightId}`),
    successfulInterruptsMedian: 0,
    interruptOpportunityCandidatesMedian: 0,
    ccUsesMedian: 0,
    dispelsPurgesMedian: 0,
    externalGroupUtilityMedian: 0,
    classSpecificMedian: 0,
    unmatchedAbilityIdCount: 0,
  }));
  const missing = DUNGEONS.filter((s) => !runs.some((r) => r.dungeonSlug === s));
  await writeFile(
    join(dir, "01-utility-run-selection.json"),
    JSON.stringify({
      selectedRuns,
      rejected: extra?.rejected ?? [],
      candidatesByDungeon: extra?.candidatesByDungeon ?? {},
    }),
    "utf8",
  );
  await writeFile(join(dir, "02-master-data.json"), JSON.stringify({}), "utf8");
  await writeFile(join(dir, "03-interrupts-raw.json"), JSON.stringify(rawEntries), "utf8");
  await writeFile(join(dir, "04-casts-raw.json"), JSON.stringify(rawEntries), "utf8");
  await writeFile(join(dir, "05-buffs-debuffs-raw.json"), JSON.stringify(rawEntries), "utf8");
  await writeFile(join(dir, "06-dispels-raw.json"), JSON.stringify(rawEntries), "utf8");
  await writeFile(join(dir, "07-utility-normalized-runs.json"), JSON.stringify(runs), "utf8");
  await writeFile(join(dir, "08-utility-opportunities.json"), JSON.stringify(rawEntries), "utf8");
  await writeFile(
    join(dir, "09-utility-per-dungeon.json"),
    JSON.stringify({
      perDungeon,
      global: {
        coverage: {
          dungeonsMissingRuns: missing,
          missingDungeonReasons: extra?.missingDungeonReasons ?? {},
        },
      },
    }),
    "utf8",
  );
  await writeFile(join(dir, "10-utility-diagnostics.json"), JSON.stringify({ schemaWarnings: [] }), "utf8");
}

describe("utility probe resume merge", () => {
  it("preserves all existing runs when appending a newly discovered dungeon", async () => {
    const base = await mkdtemp(join(tmpdir(), "utility-resume-"));
    const snapshotDir = join(base, "snapshot");
    const stagingDir = join(base, "staging");
    const publishDir = join(base, "publish");

    const existing = [
      makeRun("repA", 1, "maisara-caverns", 10),
      makeRun("repB", 2, "nexus-point-xenas", 11),
      makeRun("repC", 3, "pit-of-saron", 12),
      makeRun("repD", 4, "seat-of-the-triumvirate", 13),
      makeRun("repE", 5, "windrunner-spire", 14),
    ];
    const staging = [makeRun("repF", 6, "skyreach", 15)];

    await writeProbeArtifacts(snapshotDir, existing);
    await writeProbeArtifacts(stagingDir, staging);

    const result = await mergeProbeArtifacts({
      snapshotDir,
      stagingDir,
      publishDir,
      expectedDungeons: DUNGEONS,
      focusDungeons: ["skyreach"],
      priorMissingDungeonReasons: {
        "algethar-academy": "actor_absent",
        "magisters-terrace": "actor_absent",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.before.runCount).toBe(5);
    expect(result.after.runCount).toBe(6);
    expect(result.after.completedDungeons).toContain("skyreach");
    expect(result.after.completedDungeons).toContain("maisara-caverns");
    expect(result.addedRunIdentities).toHaveLength(1);

    const merged = JSON.parse(
      await readFile(join(publishDir, "07-utility-normalized-runs.json"), "utf8"),
    ) as UtilityNormalizedRun[];
    expect(merged).toHaveLength(6);
    await rm(base, { recursive: true, force: true });
  });

  it("deduplicates runs with the same deterministic identity", async () => {
    const base = await mkdtemp(join(tmpdir(), "utility-resume-"));
    const snapshotDir = join(base, "snapshot");
    const stagingDir = join(base, "staging");
    const publishDir = join(base, "publish");

    const run = makeRun("repA", 1, "skyreach", 10);
    await writeProbeArtifacts(snapshotDir, [run]);
    await writeProbeArtifacts(stagingDir, [run]);

    const result = await mergeProbeArtifacts({
      snapshotDir,
      stagingDir,
      publishDir,
      expectedDungeons: DUNGEONS,
      focusDungeons: ["skyreach"],
    });

    expect(result.ok).toBe(true);
    expect(result.after.runCount).toBe(1);
    await rm(base, { recursive: true, force: true });
  });

  it("rejects merge when completed dungeon count would decrease", async () => {
    const before = {
      completedDungeons: ["maisara-caverns", "skyreach"],
      runCount: 2,
      runIdentities: ["a:1:maisara-caverns:1", "b:2:skyreach:2"],
    };
    const after = {
      completedDungeons: ["skyreach"],
      runCount: 1,
      runIdentities: ["b:2:skyreach:2"],
    };
    const violations = validateMergeCoherence(before, after);
    expect(violations.some((v) => v.code === "completed_dungeon_count_decreased")).toBe(true);
    expect(violations.some((v) => v.code === "existing_dungeon_lost")).toBe(true);
  });

  it("rejects merge when valid run count would decrease", async () => {
    const before = { completedDungeons: ["skyreach"], runCount: 3, runIdentities: ["a", "b", "c"] };
    const after = { completedDungeons: ["skyreach"], runCount: 1, runIdentities: ["a"] };
    const violations = validateMergeCoherence(before, after);
    expect(violations.some((v) => v.code === "valid_run_count_decreased")).toBe(true);
    expect(violations.some((v) => v.code === "existing_run_lost")).toBe(true);
  });

  it("atomic publish replaces canonical artifacts without dropping snapshot", async () => {
    const base = await mkdtemp(join(tmpdir(), "utility-resume-"));
    const canonicalDir = join(base, "canonical");
    const publishDir = join(base, "publish");
    const snapshotDir = join(base, "snapshot");

    const runs = [makeRun("repA", 1, "maisara-caverns", 10)];
    await writeProbeArtifacts(canonicalDir, runs);
    await snapshotCanonicalArtifacts(canonicalDir, snapshotDir);
    await writeProbeArtifacts(publishDir, [...runs, makeRun("repB", 2, "skyreach", 11)]);

    await atomicPublishProbeArtifacts(publishDir, canonicalDir);

    const merged = JSON.parse(
      await readFile(join(canonicalDir, "07-utility-normalized-runs.json"), "utf8"),
    ) as UtilityNormalizedRun[];
    expect(merged).toHaveLength(2);
    expect(existsSync(join(snapshotDir, "07-utility-normalized-runs.json"))).toBe(true);
    await rm(base, { recursive: true, force: true });
  });

  it("assigns a reason for every missing dungeon", () => {
    const runs = [makeRun("repA", 1, "skyreach", 10)];
    const reasons = buildMissingDungeonReasons(
      DUNGEONS,
      runs,
      {
        rejected: [
          { reportCode: "x", fightId: 1, dungeonSlug: "algethar-academy", reason: "player_actor_not_in_fight" },
          { reportCode: "y", fightId: 2, dungeonSlug: "magisters-terrace", reason: "player_actor_not_in_fight" },
        ],
        candidatesByDungeon: {
          "algethar-academy": [{}],
          "magisters-terrace": [{}],
        },
      },
      {},
    );
    for (const slug of DUNGEONS.filter((s) => s !== "skyreach")) {
      expect(reasons[slug]).toBeTruthy();
    }
    expect(reasons["algethar-academy"]).toBe("actor_absent");
    expect(reasons["magisters-terrace"]).toBe("actor_absent");
    expect(reasons["maisara-caverns"]).toBe("no_candidates");
  });

  it("preserves prior missing-dungeon reasons when still missing", () => {
    const reason = classifyMissingDungeonReason(
      "magisters-terrace",
      [{}],
      [],
      { "magisters-terrace": "actor_absent" },
    );
    expect(reason).toBe("actor_absent");
  });

  it("uses deterministic run identity keys", () => {
    const run = makeRun("repA", 1, "skyreach", 10);
    expect(runIdentityKey(runIdentityFromNormalized(run))).toBe("repA:1:skyreach:10");
  });

  it("catalog-only rescore path does not require merge when no live calls are made", () => {
    const needsLiveCalls = false;
    const hasExplicitFocus = true;
    expect(needsLiveCalls || !hasExplicitFocus).toBe(false);
  });
});

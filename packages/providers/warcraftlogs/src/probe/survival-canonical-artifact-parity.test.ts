import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  buildCanonicalSurvivalAnalysis,
  collectCanonicalHealthSnapshots,
  emptySurvivalCanonicalDatasets,
} from "../analysis/survival-canonical-analysis.js";
import { analyzeSurvivalRunDetailed } from "../analysis/survival-run-analysis.js";
import { enrichSurvivalCalibrationRun } from "./survival-calibration-logic.js";
import { normalizeSurvivalDataset } from "./survival-probe-logic.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";
import { hardenMaxHpResolution } from "./survival-v1_1_1-maxhp.js";

const ARTIFACT_DIR = resolve(
  process.cwd(),
  "raw-artifacts/wcl-probe-survival-v1_1/eu-archimonde-wallidrixe/raw-include-resources",
);

const MAX_HP_JSON = resolve(
  process.cwd(),
  "raw-artifacts/wcl-probe-survival-v1_1/eu-archimonde-wallidrixe/12-max-hp-resolution.json",
);

type DiscoveryDataset = {
  dataType: string;
  state: string;
  events?: Array<Record<string, unknown>>;
  rawPages?: Array<{
    rawResponseData?: {
      reportData?: {
        report?: {
          events?: { data?: Array<Record<string, unknown>> };
          playerDetails?: unknown;
        };
      };
    } | null;
  }>;
};

type IncludeResourcesArtifact = {
  runId: string;
  datasets: DiscoveryDataset[];
};

function eventsFromDataset(ds: DiscoveryDataset | undefined): Array<Record<string, unknown>> {
  if (!ds) return [];
  if (Array.isArray(ds.events) && ds.events.length > 0) return ds.events;
  const out: Array<Record<string, unknown>> = [];
  for (const page of ds.rawPages ?? []) {
    const data = page.rawResponseData?.reportData?.report?.events?.data;
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

function resolvePlayerActorId(
  events: Array<Record<string, unknown>>,
  playerName: string,
): number | null {
  const needle = playerName.toLowerCase();
  for (const event of events) {
    for (const key of ["target", "source"] as const) {
      const actor = event[key] as { id?: number; name?: string } | undefined;
      if (actor?.name?.toLowerCase() === needle && typeof actor.id === "number") {
        return actor.id;
      }
    }
  }
  return null;
}

describe("canonical max-HP snapshot sources (offline artifacts)", () => {
  it("skips when raw-include-resources artifacts are absent", ({ skip }) => {
    if (!existsSync(ARTIFACT_DIR)) skip();
    expect(existsSync(ARTIFACT_DIR)).toBe(true);
  });

  it("resolves max HP from DamageTaken/Healing/Deaths/playerDetails for every captured fight", ({
    skip,
  }) => {
    if (!existsSync(ARTIFACT_DIR)) skip();

    const expected = existsSync(MAX_HP_JSON)
      ? (JSON.parse(readFileSync(MAX_HP_JSON, "utf8")) as Array<{
          runId: string;
          maxHp: number | null;
        }>)
      : [];
    const expectedByRun = new Map(expected.map((r) => [r.runId, r.maxHp]));

    const files = readdirSync(ARTIFACT_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    let resolved = 0;
    for (const file of files) {
      const artifact = JSON.parse(
        readFileSync(resolve(ARTIFACT_DIR, file), "utf8"),
      ) as IncludeResourcesArtifact;
      const byType = Object.fromEntries(
        artifact.datasets.map((d) => [d.dataType, d]),
      ) as Record<string, DiscoveryDataset>;

      const damageEvents = eventsFromDataset(byType.DamageTaken);
      const healingEvents = eventsFromDataset(byType.Healing);
      const deathsEvents = eventsFromDataset(byType.Deaths);
      const playerActorId = resolvePlayerActorId(
        [...damageEvents, ...healingEvents],
        "Wallidrixe",
      );
      expect(playerActorId, `actor for ${file}`).not.toBeNull();

      const playerDetailsRaw =
        byType.playerDetails?.rawPages?.[0]?.rawResponseData ??
        byType.playerDetails?.events?.[0] ??
        null;

      const { snapshots, snapshotSourceCounts } = collectCanonicalHealthSnapshots({
        playerActorId: playerActorId!,
        playerName: "Wallidrixe",
        damageTakenEvents: damageEvents,
        healingEvents,
        deathsEvents,
        combatantInfoEvents: [],
        playerDetailsRaw,
      });

      expect(
        snapshotSourceCounts.DamageTaken +
          snapshotSourceCounts.Healing +
          snapshotSourceCounts.Deaths +
          snapshotSourceCounts.playerDetails,
        `no HP sources for ${file}`,
      ).toBeGreaterThan(0);

      const hardened = hardenMaxHpResolution(snapshots, {
        playerActorId: playerActorId!,
      });
      if (hardened.baselineMaxHp != null) resolved += 1;

      const expectedMax = expectedByRun.get(artifact.runId);
      if (expectedMax != null) {
        expect(hardened.baselineMaxHp).toBe(expectedMax);
      } else {
        expect(
          hardened.baselineMaxHp,
          `unresolved without reason for ${file}: ${hardened.resolutionFailureReason}`,
        ).not.toBeNull();
      }
    }

    expect(resolved).toBe(files.length);
  });

  it("probe normalize+score and production canonical path deep-equal on one artifact", ({
    skip,
  }) => {
    if (!existsSync(ARTIFACT_DIR)) skip();
    const sample = resolve(ARTIFACT_DIR, "rmd1P7KygazYHVD3_4.json");
    if (!existsSync(sample)) skip();

    const artifact = JSON.parse(readFileSync(sample, "utf8")) as IncludeResourcesArtifact;
    const byType = Object.fromEntries(
      artifact.datasets.map((d) => [d.dataType, d]),
    ) as Record<string, DiscoveryDataset>;
    const damageEvents = eventsFromDataset(byType.DamageTaken);
    const healingEvents = eventsFromDataset(byType.Healing);
    const deathsEvents = eventsFromDataset(byType.Deaths);
    const playerActorId = resolvePlayerActorId(damageEvents, "Wallidrixe")!;
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });

    const { snapshots } = collectCanonicalHealthSnapshots({
      playerActorId,
      playerName: "Wallidrixe",
      damageTakenEvents: damageEvents,
      healingEvents,
      deathsEvents,
      playerDetailsRaw: byType.playerDetails?.rawPages?.[0]?.rawResponseData ?? null,
    });

    const datasets = emptySurvivalCanonicalDatasets();
    for (const t of SURVIVAL_EVENT_TYPES) {
      const src =
        t === "DamageTaken"
          ? damageEvents
          : t === "Healing"
            ? healingEvents
            : t === "Deaths"
              ? deathsEvents
              : [];
      datasets[t] = {
        ...datasets[t],
        state: "OK",
        events: src,
      };
    }

    const production = buildCanonicalSurvivalAnalysis({
      characterId: "char-1",
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      reportCode: "rmd1P7KygazYHVD3",
      fightId: 4,
      reportRevision: 1,
      dungeonSlug: "magisters-terrace",
      keyLevel: 22,
      playerActorId,
      ownedPetActorIds: [],
      fightStartTime: 0,
      fightEndTime: 2_000_000,
      datasets,
      snapshots,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      eventPagesComplete: true,
    });

    const normalized = normalizeSurvivalDataset({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      probedAt: "2026-07-28T00:00:00.000Z",
      candidate: {
        reportCode: "rmd1P7KygazYHVD3",
        fightId: 4,
        encounterId: 0,
        dungeonSlug: "magisters-terrace",
        keyLevel: 22,
        score: null,
        durationMs: 2_000_000,
        startTimeMs: 0,
        completedAt: null,
        specSlug: "demonology",
        roleSlug: null,
        rank: 0,
      },
      wclCharacterId: 0,
      wclCanonicalId: 0,
      playerActorId,
      ownedPetActorIds: [],
      fightStartTime: 0,
      fightEndTime: 2_000_000,
      keyLevel: 22,
      encounterId: null,
      encounterName: null,
      eventDatasets: datasets,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
    });
    const run = enrichSurvivalCalibrationRun({
      normalized,
      timed: null,
      depleted: null,
      completed: null,
      score: null,
      missingDatasets: [],
    });
    const probe = analyzeSurvivalRunDetailed({
      characterId: "char-1",
      reportRevision: 1,
      run,
      snapshots,
      catalog,
      classSlug: "warlock",
      eventPagesComplete: true,
    });

    expect(probe.summary.behavioralSurvivalScore).toEqual(
      production.summary.behavioralSurvivalScore,
    );
    expect(probe.summary.componentScores).toEqual(production.summary.componentScores);
    expect(probe.summary.defensiveCounts).toEqual(production.summary.defensiveCounts);
    expect(probe.summary.recoveryCounts).toEqual(production.summary.recoveryCounts);
    expect(probe.maxHpResolution.baselineMaxHp).toEqual(
      production.maxHpResolution.baselineMaxHp,
    );
    expect(probe.maxHpResolution.baselineMaxHp).toBe(531300);
  });
});

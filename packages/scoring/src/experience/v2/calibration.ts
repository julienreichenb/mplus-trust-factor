import { computeExperienceV2, type ExperienceV2RunInput } from "./compute.js";
import type { ExperienceHistoryProvenance } from "./constants.js";

export interface CalibrationProfile {
  id: string;
  label: string;
  expectedDungeonCount: number;
  selectedRuns: ExperienceV2RunInput[];
  seasonRuns: ExperienceV2RunInput[];
  priorSeasonCount: number;
  /** Defaults to RIO depth (1). Use 3 when simulating durable local multi-season history. */
  priorSeasonSourceDepth?: number;
  observedAt: string;
  provenance: ExperienceHistoryProvenance;
}

function dungeonRun(
  slug: string,
  keyLevel: number,
  completedAt: string,
): ExperienceV2RunInput {
  return { dungeonSlug: slug, keyLevel, completedAt };
}

const NOW = "2026-07-29T12:00:00.000Z";
const RECENT = "2026-07-20T12:00:00.000Z";
const STALE = "2026-04-01T12:00:00.000Z";

/** Offline calibration panel — synthetic archetypes, not named-character tuning. */
export const EXPERIENCE_V2_CALIBRATION_PANEL: CalibrationProfile[] = [
  {
    id: "new-character",
    label: "New character with little history",
    expectedDungeonCount: 8,
    selectedRuns: [],
    seasonRuns: [],
    priorSeasonCount: 0,
    observedAt: NOW,
    provenance: "CONFIRMED_ABSENCE",
  },
  {
    id: "active-current",
    label: "Active current-season character",
    expectedDungeonCount: 8,
    selectedRuns: Array.from({ length: 8 }, (_, i) =>
      dungeonRun(`dungeon-${i + 1}`, 10 + (i % 3), RECENT),
    ),
    seasonRuns: Array.from({ length: 16 }, (_, i) =>
      dungeonRun(`dungeon-${(i % 8) + 1}`, 8 + (i % 5), RECENT),
    ),
    priorSeasonCount: 1,
    priorSeasonSourceDepth: 1,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
  {
    id: "multi-season",
    label: "Long-term multi-season character",
    expectedDungeonCount: 8,
    selectedRuns: Array.from({ length: 8 }, (_, i) =>
      dungeonRun(`dungeon-${i + 1}`, [5, 8, 10, 12, 14, 15, 11, 7][i]!, RECENT),
    ),
    seasonRuns: Array.from({ length: 20 }, (_, i) =>
      dungeonRun(`dungeon-${(i % 8) + 1}`, 8 + (i % 8), RECENT),
    ),
    // Durable local prior seasons (3) — not RIO-only depth.
    priorSeasonCount: 3,
    priorSeasonSourceDepth: 3,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
  {
    id: "returning-veteran",
    label: "Returning veteran (stale current season)",
    expectedDungeonCount: 8,
    selectedRuns: [
      dungeonRun("dungeon-1", 11, STALE),
      dungeonRun("dungeon-2", 10, STALE),
      dungeonRun("dungeon-3", 12, STALE),
    ],
    seasonRuns: [
      dungeonRun("dungeon-1", 11, STALE),
      dungeonRun("dungeon-2", 10, STALE),
      dungeonRun("dungeon-3", 12, STALE),
    ],
    priorSeasonCount: 3,
    priorSeasonSourceDepth: 3,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
  {
    id: "many-low-keys",
    label: "Many low keys",
    expectedDungeonCount: 8,
    selectedRuns: Array.from({ length: 8 }, (_, i) =>
      dungeonRun(`dungeon-${i + 1}`, 4, RECENT),
    ),
    seasonRuns: Array.from({ length: 40 }, (_, i) =>
      dungeonRun(`dungeon-${(i % 8) + 1}`, 3 + (i % 2), RECENT),
    ),
    priorSeasonCount: 0,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
  {
    id: "fewer-high-keys",
    label: "Fewer high keys",
    expectedDungeonCount: 8,
    selectedRuns: [
      dungeonRun("dungeon-1", 15, RECENT),
      dungeonRun("dungeon-2", 14, RECENT),
      dungeonRun("dungeon-3", 16, RECENT),
    ],
    seasonRuns: [
      dungeonRun("dungeon-1", 15, RECENT),
      dungeonRun("dungeon-2", 14, RECENT),
      dungeonRun("dungeon-3", 16, RECENT),
      dungeonRun("dungeon-1", 14, RECENT),
    ],
    priorSeasonCount: 1,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
  {
    id: "incomplete-provider",
    label: "Incomplete provider data",
    expectedDungeonCount: 8,
    selectedRuns: [
      dungeonRun("dungeon-1", 10, RECENT),
      dungeonRun("dungeon-2", 9, RECENT),
    ],
    seasonRuns: [
      dungeonRun("dungeon-1", 10, RECENT),
      dungeonRun("dungeon-2", 9, RECENT),
    ],
    priorSeasonCount: 0,
    observedAt: NOW,
    provenance: "PARTIAL_SOURCES",
  },
  {
    id: "provider-failure-lkg",
    label: "Provider failure (use last-known-good externally)",
    expectedDungeonCount: 8,
    selectedRuns: [],
    seasonRuns: [],
    priorSeasonCount: 0,
    observedAt: NOW,
    provenance: "PROVIDER_FAILURE",
  },
  {
    id: "spam-one-dungeon",
    label: "Raw spam in one dungeon",
    expectedDungeonCount: 8,
    selectedRuns: [dungeonRun("dungeon-1", 10, RECENT)],
    seasonRuns: Array.from({ length: 80 }, () => dungeonRun("dungeon-1", 10, RECENT)),
    priorSeasonCount: 0,
    observedAt: NOW,
    provenance: "HAS_HISTORY",
  },
];

export function runCalibrationPanel(): Array<{
  id: string;
  label: string;
  rawScore: number;
  evidence: ReturnType<typeof computeExperienceV2>["evidence"];
  provenance: ExperienceHistoryProvenance;
  components: Array<{ metricKey: string; normalizedValue: number; confidence: number }>;
}> {
  return EXPERIENCE_V2_CALIBRATION_PANEL.map((profile) => {
    const result = computeExperienceV2(profile);
    return {
      id: profile.id,
      label: profile.label,
      rawScore: result.rawScore,
      evidence: result.evidence,
      provenance: result.provenance,
      components: result.components.map((c) => ({
        metricKey: c.metricKey,
        normalizedValue: c.normalizedValue,
        confidence: c.confidence,
      })),
    };
  });
}

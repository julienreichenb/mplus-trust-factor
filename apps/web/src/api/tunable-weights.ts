/**
 * Client-side tunable weight helpers (mirrors @mplus/scoring defaults).
 * Server remains authoritative for validation and calculator application.
 */

export const TUNABLE_WEIGHTS_SCHEMA_VERSION = "tunable-weights.1" as const;

export interface TunableWeightsV1 {
  schemaVersion: typeof TUNABLE_WEIGHTS_SCHEMA_VERSION;
  dimensions: {
    performance: number;
    survival: number;
    utility: number;
    experience: number;
  };
  components: {
    performance: {
      phase1: number;
      cooldown: number;
      dungeonPeak: number;
      dungeonFloor: number;
      dungeonConsistency: number;
      profileBestAverage: number;
      profileMedianAverage: number;
    };
    survival: {
      outcome: number;
      defensive: number;
      recovery: number;
    };
    utility: {
      castStops: number;
      support: number;
      strategicCc: number;
    };
    experience: {
      previousSeasonScore: number;
      historicalTitle: number;
      historicalRanking: number;
    };
  };
}

/** Production defaults — must match packages/scoring tunable-weights defaults. */
export const DEFAULT_TUNABLE_WEIGHTS: TunableWeightsV1 = {
  schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
  dimensions: {
    performance: 35,
    survival: 30,
    utility: 25,
    experience: 10,
  },
  components: {
    performance: {
      phase1: 80,
      cooldown: 20,
      dungeonPeak: 40,
      dungeonFloor: 45,
      dungeonConsistency: 15,
      profileBestAverage: 45,
      profileMedianAverage: 55,
    },
    survival: {
      outcome: 55,
      defensive: 30,
      recovery: 15,
    },
    utility: {
      castStops: 45,
      support: 28,
      strategicCc: 27,
    },
    experience: {
      previousSeasonScore: 30,
      historicalTitle: 15,
      historicalRanking: 10,
    },
  },
};

export function createDefaultTunableWeights(): TunableWeightsV1 {
  return structuredClone(DEFAULT_TUNABLE_WEIGHTS);
}

export function effectiveWeightPercent(
  relative: number,
  siblings: Readonly<Record<string, number>>,
): number {
  const total = Object.values(siblings).reduce((sum, v) => sum + v, 0);
  if (!(total > 0) || !(relative >= 0)) return 0;
  return (relative / total) * 100;
}

export function formatEffectivePercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveTunableWeightsFromConfig(config: unknown): TunableWeightsV1 {
  if (!isRecord(config) || config.tunableWeights == null) {
    return createDefaultTunableWeights();
  }
  const raw = config.tunableWeights;
  if (!isRecord(raw) || raw.schemaVersion !== TUNABLE_WEIGHTS_SCHEMA_VERSION) {
    return createDefaultTunableWeights();
  }
  // Trust API validation on save; UI merges shallowly over defaults.
  return {
    ...createDefaultTunableWeights(),
    ...(raw as unknown as TunableWeightsV1),
    schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
    dimensions: {
      ...DEFAULT_TUNABLE_WEIGHTS.dimensions,
      ...(isRecord(raw.dimensions) ? (raw.dimensions as TunableWeightsV1["dimensions"]) : {}),
    },
    components: {
      performance: {
        ...DEFAULT_TUNABLE_WEIGHTS.components.performance,
        ...(isRecord(raw.components) && isRecord(raw.components.performance)
          ? (raw.components.performance as TunableWeightsV1["components"]["performance"])
          : {}),
      },
      survival: {
        ...DEFAULT_TUNABLE_WEIGHTS.components.survival,
        ...(isRecord(raw.components) && isRecord(raw.components.survival)
          ? (raw.components.survival as TunableWeightsV1["components"]["survival"])
          : {}),
      },
      utility: {
        ...DEFAULT_TUNABLE_WEIGHTS.components.utility,
        ...(isRecord(raw.components) && isRecord(raw.components.utility)
          ? (raw.components.utility as TunableWeightsV1["components"]["utility"])
          : {}),
      },
      experience: {
        ...DEFAULT_TUNABLE_WEIGHTS.components.experience,
        ...(isRecord(raw.components) && isRecord(raw.components.experience)
          ? (raw.components.experience as TunableWeightsV1["components"]["experience"])
          : {}),
      },
    },
  };
}

export function validateTunableWeightsClient(weights: TunableWeightsV1): string[] {
  const errors: string[] = [];
  const check = (path: string, value: number) => {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    else if (value < 0) errors.push(`${path} must be ≥ 0`);
  };
  for (const [k, v] of Object.entries(weights.dimensions)) check(`dimensions.${k}`, v);
  if (Object.values(weights.dimensions).reduce((a, b) => a + b, 0) <= 0) {
    errors.push("dimension weights must sum to a positive total");
  }
  const walk = (prefix: string, obj: Record<string, number>) => {
    for (const [k, v] of Object.entries(obj)) check(`${prefix}.${k}`, v);
  };
  walk("performance", weights.components.performance);
  walk("survival", weights.components.survival);
  walk("utility", weights.components.utility);
  walk("experience", weights.components.experience);
  return errors;
}

/** Merge tunableWeights into an existing model config JSON for PUT. */
export function mergeTunableWeightsIntoConfig(
  baseConfig: unknown,
  tunable: TunableWeightsV1,
): Record<string, unknown> {
  // JSON round-trip avoids structuredClone failures on Vue reactive proxies.
  const base = isRecord(baseConfig)
    ? (JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>)
    : {};
  return {
    ...base,
    tunableWeights: JSON.parse(JSON.stringify(tunable)) as TunableWeightsV1,
  };
}

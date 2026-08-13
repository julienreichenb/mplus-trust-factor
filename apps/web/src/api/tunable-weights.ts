/**
 * Client-side tunable weight helpers (mirrors @mplus/scoring defaults).
 * Server remains authoritative for validation and calculator application.
 */

export const TUNABLE_WEIGHTS_SCHEMA_VERSION = "tunable-weights.2" as const;
export const TUNABLE_WEIGHTS_LEGACY_SCHEMA_VERSION = "tunable-weights.1" as const;

export interface TunableWeights {
  schemaVersion: typeof TUNABLE_WEIGHTS_SCHEMA_VERSION;
  dimensions: {
    performance: number;
    survival: number;
    utility: number;
    experience: number;
  };
  components: {
    performance: {
      parse: {
        bestAverage: number;
        medianAverage: number;
      };
      roles: {
        dps: {
          damageParse: number;
          cooldown: number;
        };
        tank: {
          damageParse: number;
        };
        healer: {
          healingParse: number;
          damageParse: number;
        };
      };
    };
    survival: {
      outcome: number;
      defensive: number;
      recovery: number;
    };
    utility: {
      interrupt: number;
      crowdControl: number;
      dispelPurge: number;
      groupSupport: number;
      movement: number;
      combatRes: number;
      bloodlust: number;
    };
    experience: {
      previousSeasonScore: number;
      historicalTitle: number;
      historicalRanking: number;
    };
  };
}

/** @deprecated Prefer TunableWeights */
export type TunableWeightsV1 = TunableWeights;

/** Production defaults — must match packages/scoring tunable-weights defaults. */
export const DEFAULT_TUNABLE_WEIGHTS: TunableWeights = {
  schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
  dimensions: {
    performance: 35,
    survival: 30,
    utility: 25,
    experience: 10,
  },
  components: {
    performance: {
      parse: {
        bestAverage: 45,
        medianAverage: 55,
      },
      roles: {
        dps: {
          damageParse: 80,
          cooldown: 20,
        },
        tank: {
          damageParse: 100,
        },
        healer: {
          healingParse: 65,
          damageParse: 35,
        },
      },
    },
    survival: {
      outcome: 55,
      defensive: 30,
      recovery: 15,
    },
    utility: {
      interrupt: 28,
      crowdControl: 18,
      dispelPurge: 16,
      groupSupport: 18,
      movement: 10,
      combatRes: 5,
      bloodlust: 5,
    },
    experience: {
      previousSeasonScore: 30,
      historicalTitle: 15,
      historicalRanking: 10,
    },
  },
};

export function createDefaultTunableWeights(): TunableWeights {
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

function normalizeUtilityClient(
  raw: Record<string, unknown>,
  defaults: TunableWeights["components"]["utility"],
): TunableWeights["components"]["utility"] {
  if (typeof raw.interrupt === "number") {
    return { ...defaults, ...(raw as TunableWeights["components"]["utility"]) };
  }
  if (typeof raw.castStops === "number") {
    const support = typeof raw.support === "number" ? raw.support : 28;
    const strategicCc = typeof raw.strategicCc === "number" ? raw.strategicCc : 27;
    return {
      interrupt: raw.castStops,
      crowdControl: strategicCc,
      dispelPurge: support * 0.4,
      groupSupport: support * 0.4,
      movement: support * 0.12,
      combatRes: support * 0.04,
      bloodlust: support * 0.04,
    };
  }
  return { ...defaults };
}

function convertLegacyPerformance(raw: Record<string, unknown>): TunableWeights["components"]["performance"] {
  const phase1 = typeof raw.phase1 === "number" ? raw.phase1 : 80;
  const cooldown = typeof raw.cooldown === "number" ? raw.cooldown : 20;
  const best =
    typeof raw.profileBestAverage === "number" ? raw.profileBestAverage : 45;
  const median =
    typeof raw.profileMedianAverage === "number" ? raw.profileMedianAverage : 55;
  return {
    parse: { bestAverage: best, medianAverage: median },
    roles: {
      dps: { damageParse: phase1, cooldown },
      tank: { damageParse: 100 },
      healer: { healingParse: 65, damageParse: 35 },
    },
  };
}

export function resolveTunableWeightsFromConfig(config: unknown): TunableWeights {
  if (!isRecord(config) || config.tunableWeights == null) {
    return createDefaultTunableWeights();
  }
  const raw = config.tunableWeights;
  if (
    !isRecord(raw) ||
    (raw.schemaVersion !== TUNABLE_WEIGHTS_SCHEMA_VERSION &&
      raw.schemaVersion !== TUNABLE_WEIGHTS_LEGACY_SCHEMA_VERSION)
  ) {
    return createDefaultTunableWeights();
  }

  const defaults = createDefaultTunableWeights();
  const dimensions = {
    ...defaults.dimensions,
    ...(isRecord(raw.dimensions) ? (raw.dimensions as TunableWeights["dimensions"]) : {}),
  };

  let performance = defaults.components.performance;
  if (isRecord(raw.components) && isRecord(raw.components.performance)) {
    const perf = raw.components.performance;
    if (isRecord(perf.parse) && isRecord(perf.roles)) {
      performance = {
        parse: {
          ...defaults.components.performance.parse,
          ...(perf.parse as TunableWeights["components"]["performance"]["parse"]),
        },
        roles: {
          dps: {
            ...defaults.components.performance.roles.dps,
            ...(isRecord(perf.roles) && isRecord(perf.roles.dps)
              ? (perf.roles.dps as TunableWeights["components"]["performance"]["roles"]["dps"])
              : {}),
          },
          tank: {
            ...defaults.components.performance.roles.tank,
            ...(isRecord(perf.roles) && isRecord(perf.roles.tank)
              ? (perf.roles.tank as TunableWeights["components"]["performance"]["roles"]["tank"])
              : {}),
          },
          healer: {
            ...defaults.components.performance.roles.healer,
            ...(isRecord(perf.roles) && isRecord(perf.roles.healer)
              ? (perf.roles.healer as TunableWeights["components"]["performance"]["roles"]["healer"])
              : {}),
          },
        },
      };
    } else if (typeof perf.phase1 === "number") {
      performance = convertLegacyPerformance(perf);
    }
  }

  return {
    schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
    dimensions,
    components: {
      performance,
      survival: {
        ...defaults.components.survival,
        ...(isRecord(raw.components) && isRecord(raw.components.survival)
          ? (raw.components.survival as TunableWeights["components"]["survival"])
          : {}),
      },
      utility: normalizeUtilityClient(
        isRecord(raw.components) && isRecord(raw.components.utility)
          ? raw.components.utility
          : {},
        defaults.components.utility,
      ),
      experience: {
        ...defaults.components.experience,
        ...(isRecord(raw.components) && isRecord(raw.components.experience)
          ? (raw.components.experience as TunableWeights["components"]["experience"])
          : {}),
      },
    },
  };
}

export function validateTunableWeightsClient(weights: TunableWeights): string[] {
  const errors: string[] = [];
  const check = (path: string, value: number) => {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    else if (value < 0) errors.push(`${path} must be ≥ 0`);
  };
  for (const [k, v] of Object.entries(weights.dimensions)) check(`dimensions.${k}`, v);
  if (Object.values(weights.dimensions).reduce((a, b) => a + b, 0) <= 0) {
    errors.push("dimension weights must sum to a positive total");
  }
  const parse = weights.components.performance.parse;
  check("performance.parse.bestAverage", parse.bestAverage);
  check("performance.parse.medianAverage", parse.medianAverage);
  if (parse.bestAverage + parse.medianAverage <= 0) {
    errors.push("performance parse weights must sum to a positive total");
  }
  const dps = weights.components.performance.roles.dps;
  check("performance.roles.dps.damageParse", dps.damageParse);
  check("performance.roles.dps.cooldown", dps.cooldown);
  if (dps.damageParse + dps.cooldown <= 0) {
    errors.push("performance DPS weights must sum to a positive total");
  }
  check(
    "performance.roles.tank.damageParse",
    weights.components.performance.roles.tank.damageParse,
  );
  const healer = weights.components.performance.roles.healer;
  check("performance.roles.healer.healingParse", healer.healingParse);
  check("performance.roles.healer.damageParse", healer.damageParse);
  if (healer.healingParse + healer.damageParse <= 0) {
    errors.push("performance healer weights must sum to a positive total");
  }
  const walk = (prefix: string, obj: Record<string, number>) => {
    for (const [k, v] of Object.entries(obj)) check(`${prefix}.${k}`, v);
  };
  walk("survival", weights.components.survival);
  walk("utility", weights.components.utility);
  walk("experience", weights.components.experience);
  return errors;
}

/** Merge tunableWeights into an existing model config JSON for PUT. */
export function mergeTunableWeightsIntoConfig(
  baseConfig: unknown,
  tunable: TunableWeights,
): Record<string, unknown> {
  // JSON round-trip avoids structuredClone failures on Vue reactive proxies.
  const base = isRecord(baseConfig)
    ? (JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>)
    : {};
  return {
    ...base,
    tunableWeights: JSON.parse(JSON.stringify(tunable)) as TunableWeights,
  };
}

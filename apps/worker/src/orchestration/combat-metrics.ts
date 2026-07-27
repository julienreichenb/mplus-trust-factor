import type { MetricObservationDTO } from "@mplus/contracts";
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function coverageRatio(facts: RunCombatFacts): number {
  const flags = Object.values(facts.coverage);
  if (flags.length === 0) return 0;
  return flags.filter(Boolean).length / flags.length;
}

/** Derives survival/utility metric observations from normalized WCL combat facts. */
export function extractMetricsFromCombatFacts(
  facts: RunCombatFacts,
  observedAt: string,
): MetricObservationDTO[] {
  const targetId = facts.targetSourceId;
  const deaths = facts.deaths.filter((event) => event.targetId === targetId).length;
  const interruptsSucceeded = facts.interrupts.filter((event) => event.sourceId === targetId).length;
  const interruptsObserved = facts.interrupts.length;
  const dispelsSucceeded = facts.dispels.filter((event) => event.sourceId === targetId).length;
  const coverage = coverageRatio(facts);

  const observations: MetricObservationDTO[] = [
    {
      metricKey: "survival.death_rate",
      dimension: "SURVIVAL",
      rawValue: deaths,
      normalizedValue: clamp01(1 - deaths / 5) * 100,
      confidence: facts.coverage.deaths ? 0.75 : 0.35,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: { present: deaths >= 0 ? 1 : 0, expected: 1, ratio: facts.coverage.deaths ? 1 : 0 },
      context: {
        reportCode: facts.reportCode,
        fightId: facts.fightId,
        revision: facts.revision,
        limitations: facts.limitations.notes,
      },
    },
    {
      metricKey: "utility.interrupts",
      dimension: "UTILITY",
      rawValue: interruptsSucceeded,
      normalizedValue:
        interruptsObserved > 0 ? clamp01(interruptsSucceeded / interruptsObserved) * 100 : null,
      confidence: facts.coverage.interrupts ? 0.7 : 0.25,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: { present: interruptsObserved, expected: Math.max(interruptsObserved, 1), ratio: coverage },
      context: { interruptsObserved, interruptsSucceeded },
    },
    {
      metricKey: "utility.dispels",
      dimension: "UTILITY",
      rawValue: dispelsSucceeded,
      normalizedValue: dispelsSucceeded > 0 ? clamp01(dispelsSucceeded / 10) * 100 : null,
      confidence: facts.coverage.dispels ? 0.65 : 0.2,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: { present: dispelsSucceeded, expected: 1, ratio: facts.coverage.dispels ? 1 : 0 },
      context: { dispelsSucceeded },
    },
  ];

  return observations;
}

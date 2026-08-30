import { describe, expect, it } from "vitest";
import { getAllRegisteredRules } from "../registry.js";
import type { ExternalAbilityCandidate } from "./types.js";
import { matchCandidatesToCurrent } from "./match.js";

function racialCandidate(
  overrides: Partial<ExternalAbilityCandidate> &
    Pick<ExternalAbilityCandidate, "candidateKey" | "primarySpellId" | "name">,
): ExternalAbilityCandidate {
  const { primarySpellId, name, raceSlugs = ["human"], candidateKey, ...rest } = overrides;
  return {
    candidateKey,
    name,
    primarySpellId,
    classSlug: null,
    specSlugs: [],
    raceSlugs,
    bindings: [
      {
        spellId: primarySpellId,
        role: "PRIMARY_ACTIVATION",
        source: "SIMULATIONCRAFT",
        certainty: "unverified",
      },
    ],
    sourceObservations: [],
    eligibilityState: "STRONG_REVIEW_CANDIDATE",
    eligibilityReasons: [],
    catalogRelevance: "ACTIVE_CANDIDATE",
    certainty: "unverified",
    ownershipKind: "PLAYABLE_RACE",
    notes: [],
    cooldownSeconds: 300,
    charges: null,
    stacks: null,
    isPassive: false,
    category: "UNKNOWN",
    ...rest,
  };
}

describe("matchCandidatesToCurrent", () => {
  it("pairs alliance Heroism alias after Horde Bloodlust primary consumed the rule", () => {
    const rules = getAllRegisteredRules();
    const bloodlustCandidate = racialCandidate({
      candidateKey: "shared.racial.bloodlust",
      name: "Bloodlust",
      primarySpellId: 2825,
      raceSlugs: ["orc"],
    });
    const heroismCandidate = racialCandidate({
      candidateKey: "shared.racial.heroism",
      name: "Heroism",
      primarySpellId: 32182,
      raceSlugs: ["human"],
    });
    const result = matchCandidatesToCurrent([bloodlustCandidate, heroismCandidate], rules);
    expect(result.unmatchedCandidates).toHaveLength(0);
    expect(result.pairs.map((pair) => pair.current.canonicalKey)).toEqual([
      "shaman.bloodlust.bloodlust",
      "shaman.bloodlust.bloodlust",
    ]);
  });
});

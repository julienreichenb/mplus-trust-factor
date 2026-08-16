import { describe, expect, it } from "vitest";
import { assessBoostSuspicionV1 } from "./assess.js";
import { BOOST_ASSESSMENT_ISOLATION, BOOST_ASSESSMENT_POLICY } from "./index.js";
import type { BoostDungeonContext, BoostPeerParse, BoostRunInput, SeasonHighKeyContext } from "./types.js";
import type { BoostRunParticipantInput } from "./identity.js";

const EXCEPTIONAL: SeasonHighKeyContext = {
  available: true,
  contextRevisionId: "rev-1",
  contextRevisionKey: "rev-1",
  distributionSnapshotId: "dist-1",
  p99KeyThreshold: 16,
  p999KeyThreshold: 18,
  appliedAnchorPercentileLabel: "P99.9",
  subjectMedianTimedKey: 19,
  subjectMedianKeyPercentileBps: 9990,
  subjectMedianKeyPercentileLabel: "P99.9",
  timedRunCountUsedForMedian: 8,
  exceptionalOperatingLevel: true,
  canonicalSelectionComplete: true,
};

const ORDINARY: SeasonHighKeyContext = {
  ...EXCEPTIONAL,
  appliedAnchorPercentileLabel: "P75",
  subjectMedianTimedKey: 12,
  subjectMedianKeyPercentileBps: 7500,
  subjectMedianKeyPercentileLabel: "P75",
  exceptionalOperatingLevel: false,
};

function teammate(id: string): BoostRunParticipantInput {
  return {
    characterId: id,
    providerCharacterKey: id,
    regionCode: "EU",
    realmSlug: "realm",
    displayName: id,
    isTargetCharacter: false,
  };
}

function subject(): BoostRunParticipantInput {
  return {
    characterId: "subject",
    providerCharacterKey: "subject",
    regionCode: "EU",
    realmSlug: "realm",
    displayName: "Subject",
    isTargetCharacter: true,
  };
}

function peerParses(ids: string[], keyParse: number): BoostPeerParse[] {
  return ids.map((id) => ({
    identityKey: `cid:${id}`,
    displayName: id,
    keyParse,
    role: "DPS",
  }));
}

function run(opts: {
  id: string;
  parse?: number | null;
  deaths?: number | null;
  peerParses?: BoostPeerParse[];
  dungeon?: string;
  slotIndex?: number;
  mates?: BoostRunParticipantInput[];
  completedAt?: string;
  key?: number;
}): BoostRunInput {
  const mates = opts.mates ?? [teammate("a"), teammate("b")];
  return {
    runId: opts.id,
    seasonId: "season-1",
    dungeonSlug: opts.dungeon ?? "dungeon",
    dungeonName: opts.dungeon ?? "Dungeon",
    keyLevel: opts.key ?? 19,
    timed: true,
    completedAt: opts.completedAt ?? "2026-08-01T00:00:00.000Z",
    subjectKeyParse: opts.parse ?? null,
    parseSemantic: opts.parse != null ? "BRACKET_PERCENT" : "UNAVAILABLE",
    deathCount: opts.deaths ?? 0,
    survivalAvailable: true,
    peerKeyParses: opts.peerParses ?? peerParses(["a", "b"], 90),
    participants: [subject(), ...mates],
    slotIndex: opts.slotIndex ?? 0,
  };
}

function sixteen(modify: (i: number) => Partial<Parameters<typeof run>[0]> = () => ({})): BoostRunInput[] {
  return Array.from({ length: 16 }, (_, i) =>
    run({
      id: `r${i}`,
      parse: 90,
      deaths: 0,
      dungeon: `d${i % 8}`,
      slotIndex: i < 8 ? 0 : 1,
      ...modify(i),
    }),
  );
}

function dungeonContexts(opts?: {
  unverifiable?: string[];
  clustered?: boolean;
}): BoostDungeonContext[] {
  const unverifiable = new Set(opts?.unverifiable ?? []);
  return Array.from({ length: 8 }, (_, i) => {
    const slug = `d${i}`;
    const hour = opts?.clustered ? i : i * 80;
    return {
      dungeonSlug: slug,
      blizzardBestKeyLevel: unverifiable.has(slug) ? 23 : 21,
      blizzardBestCompletedAt: `2026-08-01T${String(hour % 24).padStart(2, "0")}:00:00.000Z`,
      blizzardBestMythicRunId: `m${i}`,
      publicAnalysableBestKeyLevel: unverifiable.has(slug) ? 21 : 21,
      publicAnalysableCode: unverifiable.has(slug) ? null : `code${i}`,
      publicAnalysableFightId: unverifiable.has(slug) ? null : 1,
      topPublicEvidenceAvailable: !unverifiable.has(slug),
      keyLevelVerificationGap: unverifiable.has(slug) ? 2 : 0,
    };
  });
}

function assess(
  runs: BoostRunInput[],
  context: SeasonHighKeyContext = EXCEPTIONAL,
  contexts?: BoostDungeonContext[],
) {
  return assessBoostSuspicionV1({
    subjectCharacterId: "subject",
    seasonId: "season-1",
    calculatedAt: "2026-08-15T00:00:00.000Z",
    runs,
    seasonHighKeyContext: context,
    dungeonContexts: contexts,
  });
}

const CARRY_PEERS = ["Metashift", "Lildwarfy", "Shalidk"];

describe("boost assessment V2 synthetic matrix", () => {
  it("CASE A obvious carry is HIGH", () => {
    const mates = CARRY_PEERS.map(teammate);
    const runs = sixteen((i) => {
      const primaryRed = i < 5;
      return {
        parse: primaryRed ? 10 : i >= 8 ? 70 : 80,
        peerParses: peerParses(CARRY_PEERS, primaryRed ? 90 : 75),
        mates,
        deaths: primaryRed ? 3 : 0,
      };
    });
    const result = assess(runs);
    expect(result.suspicionBand).toBe("HIGH");
    expect(result.signals.some((s) => s.code === "HIGH_KEY_PERFORMANCE_MISMATCH" && s.contribution > 0)).toBe(
      false,
    );
  });

  it("CASE B small recurrent differences stay LOW on peer gap", () => {
    const runs = sixteen((i) => ({
      parse: i < 8 ? 82 : 80,
      peerParses: peerParses(["a", "b"], i < 8 ? 90 : 85),
    }));
    const result = assess(runs);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.contribution).toBeLessThan(8);
    expect(result.suspicionBand).toBe("LOW");
  });

  it("CASE C primary green / secondary red is not strong carry", () => {
    const runs = sixteen((i) =>
      i < 8
        ? { parse: 90, peerParses: peerParses(["a", "b"], 60) }
        : { parse: 30, peerParses: peerParses(["a", "b"], 80) },
    );
    const result = assess(runs);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.contribution).toBeLessThan(10);
    expect(result.suspicionScore ?? 0).toBeLessThan(BOOST_ASSESSMENT_POLICY.bands.elevatedMin);
  });

  it("CASE D primary red / secondary green remains strong red", () => {
    const runs = sixteen((i) =>
      i < 8
        ? { parse: 10, peerParses: peerParses(["a", "b"], 90) }
        : { parse: 90, peerParses: peerParses(["a", "b"], 60) },
    );
    const result = assess(runs);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.contribution).toBeGreaterThan(30);
    expect(result.suspicionBand).toBe("HIGH");
  });

  it("CASE E missing logs only is NOT HIGH", () => {
    const runs = sixteen((_i) => ({ parse: 92, peerParses: peerParses(["a", "b"], 70), deaths: 0 }));
    const result = assess(runs, EXCEPTIONAL, dungeonContexts({ unverifiable: ["d0", "d1", "d2", "d3"] }));
    expect(result.suspicionBand).not.toBe("HIGH");
    expect(result.suspicionScore ?? 0).toBeLessThan(BOOST_ASSESSMENT_POLICY.bands.highMin);
    const missing = result.signals.find((s) => s.code === "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE")!;
    expect(missing.contribution).toBeGreaterThan(0);
    expect(result.sample.analyzedRuns.filter((r) => r.dungeonSlug === "d0").every((r) => r.usedInBoostSample === false)).toBe(
      true,
    );
  });

  it("CASE F opaque suspicious profile is at least ELEVATED", () => {
    const clustered = dungeonContexts({
      unverifiable: ["d0", "d1", "d2"],
      clustered: true,
    });
    for (const c of clustered) {
      c.blizzardBestCompletedAt = "2026-08-01T12:00:00.000Z";
    }
    clustered[1]!.blizzardBestCompletedAt = "2026-08-01T18:00:00.000Z";
    clustered[2]!.blizzardBestCompletedAt = "2026-08-02T08:00:00.000Z";
    clustered[3]!.blizzardBestCompletedAt = "2026-08-02T10:00:00.000Z";
    clustered[4]!.blizzardBestCompletedAt = "2026-08-02T11:00:00.000Z";
    const runs = sixteen((i) => ({
      parse: i < 8 && i >= 3 ? 40 : 70,
      peerParses: peerParses(["a", "b"], i < 8 && i >= 3 ? 80 : 72),
      deaths: i < 8 && i >= 3 ? 3 : 1,
    }));
    const result = assess(runs, EXCEPTIONAL, clustered);
    expect(result.suspicionScore ?? 0).toBeGreaterThanOrEqual(BOOST_ASSESSMENT_POLICY.bands.elevatedMin);
  });

  it("CASE G legitimate top push group stays LOW", () => {
    const mates = CARRY_PEERS.map(teammate);
    const clustered = dungeonContexts({ clustered: true });
    for (const c of clustered) c.blizzardBestCompletedAt = "2026-08-01T12:00:00.000Z";
    const runs = sixteen(() => ({
      parse: 92,
      peerParses: peerParses(CARRY_PEERS, 88),
      mates,
      deaths: 0,
    }));
    const result = assess(runs, EXCEPTIONAL, clustered);
    expect(result.suspicionBand).toBe("LOW");
    const cohort = result.signals.find((s) => s.code === "RECURRENT_STRONG_PEER_COHORT")!;
    expect(cohort.contribution).toBe(0);
  });

  it("CASE H ordinary player with missing logs is not a published LOW conviction", () => {
    const result = assess(sixteen(), ORDINARY, dungeonContexts({ unverifiable: ["d0", "d1"] }));
    expect(result.primaryEvidenceAvailable).toBe(false);
    expect(result.suspicionScore).toBeNull();
    expect(result.suspicionBand).toBeNull();
  });

  it("CASE I four extreme PRIMARY gaps are not averaged down", () => {
    const runs = sixteen((i) =>
      i < 4
        ? { parse: 8, peerParses: peerParses(["a", "b"], 92) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.evidence.extremePrimaryDungeonCount).toBe(4);
    expect(gap.contribution).toBeGreaterThan(35);
    expect(result.suspicionBand).toBe("HIGH");
  });

  it("missing primary does not promote secondary weight", () => {
    const runs = sixteen((i) => ({ slotIndex: i < 8 ? 0 : 1 }));
    const rows = assess(runs).sample.analyzedRuns;
    expect(rows.filter((r) => r.dungeonSlotRole === "SECONDARY").every((r) => r.dungeonSlotWeight === 0.25)).toBe(
      true,
    );
  });

  it("detector never mutates CharacterScore-shaped input", () => {
    const score = { composite: 77, contextualScore: 81, performance: 70, grade: "A" };
    const frozen = { ...score };
    assess(sixteen());
    expect(score).toEqual(frozen);
    expect(BOOST_ASSESSMENT_ISOLATION.altersCharacterScore).toBe(false);
  });

  it("fingerprint includes blizzard highest-run comparison", () => {
    const a = assess(sixteen(), EXCEPTIONAL, dungeonContexts());
    const b = assess(sixteen(), EXCEPTIONAL, dungeonContexts({ unverifiable: ["d0"] }));
    expect(a.evidenceFingerprint).not.toBe(b.evidenceFingerprint);
  });
});

describe("boost assessment V2.1 recurrent peer-gap matrix", () => {
  it("A: one extreme PRIMARY gap among neutrals is not automatically HIGH", () => {
    const runs = sixteen((i) =>
      i === 0
        ? { parse: 8, peerParses: peerParses(["a", "b"], 92) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("B: three moderate negative PRIMARY gaps stay below HIGH", () => {
    const runs = sixteen((i) =>
      i < 3
        ? { parse: 55, peerParses: peerParses(["a", "b"], 85) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    expect(result.suspicionBand).not.toBe("HIGH");
    expect(result.suspicionScore ?? 0).toBeLessThan(BOOST_ASSESSMENT_POLICY.bands.highMin);
  });

  it("C: five severe negative PRIMARY gaps across distinct dungeons are HIGH", () => {
    const runs = sixteen((i) =>
      i < 5
        ? { parse: 35, peerParses: peerParses(["a", "b"], 80) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    expect(result.suspicionBand).toBe("HIGH");
  });

  it("D: six very severe negative PRIMARY gaps are HIGH", () => {
    const runs = sixteen((i) =>
      i < 6
        ? { parse: 20, peerParses: peerParses(["a", "b"], 85) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    expect(result.suspicionBand).toBe("HIGH");
    expect(result.suspicionScore ?? 0).toBeGreaterThanOrEqual(BOOST_ASSESSMENT_POLICY.bands.highMin);
  });

  it("E: strong player matching peers stays LOW", () => {
    const result = assess(sixteen(() => ({ parse: 88, peerParses: peerParses(["a", "b"], 86) })));
    expect(result.suspicionBand).toBe("LOW");
  });

  it("F: subject outperforming peers does not red-escalate", () => {
    const result = assess(sixteen(() => ({ parse: 92, peerParses: peerParses(["a", "b"], 60) })));
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.contribution).toBe(0);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("G: recurrent same cohort with equal performance is not HIGH", () => {
    const mates = CARRY_PEERS.map(teammate);
    const runs = sixteen(() => ({
      parse: 88,
      peerParses: peerParses(CARRY_PEERS, 87),
      mates,
    }));
    const result = assess(runs);
    expect(result.suspicionBand).not.toBe("HIGH");
    const cohort = result.signals.find((s) => s.code === "RECURRENT_STRONG_PEER_COHORT")!;
    expect(cohort.contribution).toBe(0);
  });

  it("H: missing top evidence only is not HIGH", () => {
    const runs = sixteen((_i) => ({ parse: 90, peerParses: peerParses(["a", "b"], 88), deaths: 0 }));
    const result = assess(runs, EXCEPTIONAL, dungeonContexts({ unverifiable: ["d0", "d1", "d2"] }));
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("I: severe recurring peer gaps with no deaths can still be HIGH", () => {
    const runs = sixteen((i) =>
      i < 5
        ? { parse: 12, peerParses: peerParses(["a", "b"], 70), deaths: 0 }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78), deaths: 0 },
    );
    const result = assess(runs);
    expect(result.suspicionBand).toBe("HIGH");
    const survival = result.signals.find((s) => s.code === "HIGH_KEY_SURVIVAL_MISMATCH")!;
    expect(survival.contribution).toBeLessThan(2);
  });

  it("J: severe recurring peer gaps with no temporal burst can still be HIGH", () => {
    const contexts = dungeonContexts();
    for (let i = 0; i < contexts.length; i++) {
      contexts[i]!.blizzardBestCompletedAt = `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`;
    }
    const runs = sixteen((i) =>
      i < 5 ? { parse: 18, peerParses: peerParses(["a", "b"], 75) } : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs, EXCEPTIONAL, contexts);
    expect(result.suspicionBand).toBe("HIGH");
    const temporal = result.signals.find((s) => s.code === "HIGHEST_RUN_TEMPORAL_CLUSTER")!;
    expect(temporal.contribution).toBe(0);
  });

  it("signed extreme does not require subject<=20 and peers>=80", () => {
    const runs = sixteen((i) =>
      i < 4
        ? { parse: 35, peerParses: peerParses(["a", "b"], 88) }
        : { parse: 80, peerParses: peerParses(["a", "b"], 78) },
    );
    const result = assess(runs);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.evidence.extremePrimaryCount).toBe(4);
    expect(result.suspicionBand).toBe("HIGH");
  });
});

function sixDungeonContexts(): BoostDungeonContext[] {
  return Array.from({ length: 6 }, (_, i) => ({
    dungeonSlug: `d${i}`,
    blizzardBestKeyLevel: 21,
    blizzardBestCompletedAt: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
    blizzardBestMythicRunId: `m${i}`,
    publicAnalysableBestKeyLevel: 21,
    publicAnalysableCode: `code${i}`,
    publicAnalysableFightId: 1,
    topPublicEvidenceAvailable: true,
    keyLevelVerificationGap: 0,
  }));
}

function fromPrimaryDeltas(deltas: number[]): ReturnType<typeof assess> {
  const runs: BoostRunInput[] = [];
  for (let i = 0; i < deltas.length; i++) {
    const peer = 80;
    const subject = peer + deltas[i]!;
    runs.push(
      run({
        id: `p${i}`,
        parse: subject,
        peerParses: peerParses(["a", "b"], peer),
        dungeon: `d${i}`,
        slotIndex: 0,
      }),
    );
    runs.push(
      run({
        id: `s${i}`,
        parse: peer,
        peerParses: peerParses(["a", "b"], peer),
        dungeon: `d${i}`,
        slotIndex: 1,
      }),
    );
  }
  return assess(runs, EXCEPTIONAL, sixDungeonContexts());
}

describe("boost assessment legitimate-shape false-positive audit", () => {
  it("A: near-median deltas must not HIGH", () => {
    const result = fromPrimaryDeltas([-10, 8, -4, 2, -7, 5]);
    expect(result.suspicionBand).not.toBe("HIGH");
    expect(result.suspicionBand).toBe("LOW");
  });

  it("B: one catastrophic outlier must not HIGH", () => {
    const result = fromPrimaryDeltas([-65, -5, 2, -8, 3, -4]);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("C: two very bad runs otherwise normal must not HIGH", () => {
    const result = fromPrimaryDeltas([-55, -45, -5, 5, -8, 0]);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("D: four modest deficits must not automatically HIGH", () => {
    const result = fromPrimaryDeltas([-25, -27, -28, -26, -5, 0]);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("E: three severe + three normal must not HIGH from count=3 alone", () => {
    const result = fromPrimaryDeltas([-45, -44, -42, -5, 0, 5]);
    expect(result.suspicionBand).not.toBe("HIGH");
  });

  it("F: systematic severe PRIMARY gaps are HIGH", () => {
    const result = fromPrimaryDeltas([-45, -48, -50, -42, -35, -5]);
    expect(result.suspicionBand).toBe("HIGH");
  });

  it("G: systematic extreme PRIMARY gaps are HIGH", () => {
    const result = fromPrimaryDeltas([-60, -55, -70, -50, -65, -40]);
    expect(result.suspicionBand).toBe("HIGH");
  });

  it("H: consistent outperformance does not red-escalate", () => {
    const result = fromPrimaryDeltas([25, 18, 30, 12, 22, 40]);
    const gap = result.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP")!;
    expect(gap.contribution).toBe(0);
    expect(result.suspicionBand).not.toBe("HIGH");
  });
});


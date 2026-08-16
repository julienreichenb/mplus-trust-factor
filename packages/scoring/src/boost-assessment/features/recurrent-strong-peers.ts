import { computeTrueMedian } from "../../context/median.js";
import { clamp01 } from "../../math.js";
import { analysableRuns } from "../dungeon-filter.js";
import {
  BOOST_ASSESSMENT_POLICY,
  classifyPeerGap,
  dungeonRunSlotWeight,
  isRedPeerClass,
  normalizeRate,
} from "../policy.js";
import { peerMedianKeyParse, subjectKeyParse } from "../sample.js";
import type { BoostDungeonContext, BoostFeatureComputeResult, BoostRunInput } from "../types.js";

interface PeerAgg {
  identityKey: string;
  displayName: string | null;
  appearances: number;
  materialGapAppearances: number;
  weightedMaterialGapAppearances: number;
  weightedAppearances: number;
  dungeons: Set<string>;
  peerParses: number[];
  subjectParsesOnSameRuns: number[];
  advantages: number[];
}

export function computeRecurrentStrongPeerCohort(args: {
  sampleRuns: BoostRunInput[];
  subjectCharacterId: string;
  peerGapComputed: boolean;
  materialPeerGapRunCount: number;
  weightedMaterialGapWeight: number;
  dungeonContexts?: BoostDungeonContext[];
}): BoostFeatureComputeResult {
  const n = args.sampleRuns.length;
  if (n < BOOST_ASSESSMENT_POLICY.minUsableSampleRuns) {
    return {
      status: "unavailable",
      reasonCode: "INSUFFICIENT_SAMPLE",
      summary: "Not enough timed runs to assess recurring stronger peers.",
      publicEvidence: { boostSampleSize: n },
    };
  }
  if (
    !args.peerGapComputed ||
    args.weightedMaterialGapWeight < BOOST_ASSESSMENT_POLICY.minSharedGapRunsForCohort
  ) {
    return {
      status: "unavailable",
      reasonCode: args.peerGapComputed ? "NO_MATERIAL_PEER_GAP" : "MISSING_PEER_PARSE_DATA",
      summary:
        "Recurring teammates only corroborate when the subject is repeatedly below them on analysable runs.",
      publicEvidence: {
        boostSampleSize: n,
        materialPeerGapRunCount: args.materialPeerGapRunCount,
        weightedMaterialGapWeight: Number(args.weightedMaterialGapWeight.toFixed(4)),
      },
    };
  }

  const byPeer = new Map<string, PeerAgg>();
  let weightedGapRuns = 0;
  let gapRuns = 0;
  const gapDungeons = new Set<string>();

  for (const run of analysableRuns(args.sampleRuns, args.dungeonContexts)) {
    const subject = subjectKeyParse(run);
    const cls = classifyPeerGap({
      subjectKeyParse: subject,
      peerMedianKeyParse: peerMedianKeyParse(run),
    });
    const isMaterial = isRedPeerClass(cls);
    const weight = dungeonRunSlotWeight(typeof run.slotIndex === "number" ? run.slotIndex : null);
    if (isMaterial) {
      gapRuns += 1;
      weightedGapRuns += weight;
      if (run.dungeonSlug) gapDungeons.add(run.dungeonSlug);
    }

    for (const peer of run.peerKeyParses ?? []) {
      if (!Number.isFinite(peer.keyParse) || subject == null) continue;
      const advantage = peer.keyParse - subject;
      let agg = byPeer.get(peer.identityKey);
      if (!agg) {
        agg = {
          identityKey: peer.identityKey,
          displayName: peer.displayName ?? null,
          appearances: 0,
          materialGapAppearances: 0,
          weightedMaterialGapAppearances: 0,
          weightedAppearances: 0,
          dungeons: new Set(),
          peerParses: [],
          subjectParsesOnSameRuns: [],
          advantages: [],
        };
        byPeer.set(peer.identityKey, agg);
      }
      agg.appearances += 1;
      agg.weightedAppearances += weight;
      if (run.dungeonSlug) agg.dungeons.add(run.dungeonSlug);
      if (isMaterial && advantage >= BOOST_ASSESSMENT_POLICY.materialAbsDelta) {
        agg.materialGapAppearances += 1;
        agg.weightedMaterialGapAppearances += weight;
      }
      agg.peerParses.push(peer.keyParse);
      agg.subjectParsesOnSameRuns.push(subject);
      agg.advantages.push(advantage);
    }
  }

  const identities = [...byPeer.values()]
    .map((agg) => ({
      identityKey: agg.identityKey,
      displayName: agg.displayName,
      appearances: agg.appearances,
      materialGapAppearances: agg.materialGapAppearances,
      weightedAppearances: Number(agg.weightedAppearances.toFixed(4)),
      weightedMaterialGapAppearances: Number(agg.weightedMaterialGapAppearances.toFixed(4)),
      distinctDungeons: agg.dungeons.size,
      medianPeerKeyParse: computeTrueMedian(agg.peerParses),
      medianSubjectKeyParseOnSameRuns: computeTrueMedian(agg.subjectParsesOnSameRuns),
      medianPeerAdvantage: computeTrueMedian(agg.advantages),
    }))
    .filter(
      (p) =>
        p.weightedMaterialGapAppearances >= BOOST_ASSESSMENT_POLICY.minSharedGapRunsForCohort &&
        p.distinctDungeons >= BOOST_ASSESSMENT_POLICY.minCohortDistinctDungeons &&
        (p.medianPeerAdvantage ?? 0) >= BOOST_ASSESSMENT_POLICY.materialAbsDelta,
    )
    .sort((a, b) => b.weightedMaterialGapAppearances - a.weightedMaterialGapAppearances);

  if (identities.length === 0) {
    return {
      status: "computed",
      evidence: { value: 0, confidence: 0.5, sampleSize: gapRuns, coverage: gapRuns / Math.max(1, n) },
      summary: "No recurring teammates are both present and materially stronger than the subject across dungeons.",
      publicEvidence: { boostSampleSize: n, gapRuns, identities: [] },
    };
  }

  const top = identities[0]!;
  const dungeonRate = gapDungeons.size > 0 ? top.distinctDungeons / Math.max(gapDungeons.size, top.distinctDungeons) : 0;
  const appearanceRate = weightedGapRuns > 0 ? top.weightedMaterialGapAppearances / weightedGapRuns : 0;
  const value = clamp01(
    Math.max(
      normalizeRate(appearanceRate, BOOST_ASSESSMENT_POLICY.cohortRateOnset, BOOST_ASSESSMENT_POLICY.cohortRateSaturation),
      normalizeRate(dungeonRate, 0.4, 0.8),
    ),
  );
  const names = identities
    .slice(0, 4)
    .map((p) => p.displayName ?? p.identityKey)
    .join(", ");

  return {
    status: "computed",
    evidence: { value, confidence: clamp01(0.4 + 0.5 * (gapRuns / Math.max(1, n))), sampleSize: gapRuns, coverage: gapRuns / Math.max(1, n) },
    summary:
      value >= 0.35
        ? `The same stronger teammates (${names}) recur across ${top.distinctDungeons} dungeons while outperforming the subject.`
        : "Recurring teammates are present but do not strongly concentrate as a stronger cohort.",
    publicEvidence: {
      boostSampleSize: n,
      gapRuns,
      weightedGapRuns: Number(weightedGapRuns.toFixed(4)),
      gapDungeonCount: gapDungeons.size,
      identities: identities.slice(0, 8),
    },
  };
}

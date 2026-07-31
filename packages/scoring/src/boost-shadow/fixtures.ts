import type {
  BoostShadowRunInput,
  BoostShadowRunParticipantInput,
  BoostShadowRatingSnapshotInput,
  VerifiedOwnershipEvidenceInput,
  BoostFeatureExtractorInput,
} from "./types.js";

const SEASON = "season-tww-3";
const REGION = "region-eu";
const SUBJECT = "char-subject-1";
const T0 = "2026-07-15T12:00:00.000Z";

function teammate(
  id: string,
  rating: number,
  extras: Partial<BoostShadowRunParticipantInput> = {},
): BoostShadowRunParticipantInput {
  return {
    characterId: id,
    regionCode: "eu",
    realmSlug: "tarren-mill",
    displayName: `Teammate${id.slice(-1)}`,
    isTargetCharacter: false,
    mythicRatingAtRun: rating,
    ...extras,
  };
}

function subject(rating: number): BoostShadowRunParticipantInput {
  return {
    characterId: SUBJECT,
    regionCode: "eu",
    realmSlug: "tarren-mill",
    displayName: "Subject",
    isTargetCharacter: true,
    mythicRatingAtRun: rating,
  };
}

function run(args: {
  runId: string;
  keyLevel: number;
  completedAt: string;
  subjectRating: number;
  teammates: Array<{ id: string; rating: number }>;
  timed?: boolean;
  scoreValue?: number;
}): BoostShadowRunInput {
  return {
    runId: args.runId,
    seasonId: SEASON,
    keyLevel: args.keyLevel,
    timed: args.timed ?? true,
    scoreValue: args.scoreValue ?? args.keyLevel * 100,
    completedAt: args.completedAt,
    source: "fixture",
    participants: [
      subject(args.subjectRating),
      ...args.teammates.map((t) => teammate(t.id, t.rating)),
    ],
  };
}

/** Rapid difficulty climb over ~5 days (not farm volume). */
export function fixtureRapidProgression(): BoostFeatureExtractorInput {
  return {
    subjectCharacterId: SUBJECT,
    seasonId: SEASON,
    regionId: REGION,
    calculatedAt: T0,
    runs: [
      run({
        runId: "r1",
        keyLevel: 8,
        completedAt: "2026-07-01T10:00:00.000Z",
        subjectRating: 1800,
        teammates: [
          { id: "char-a", rating: 1850 },
          { id: "char-b", rating: 1820 },
          { id: "char-c", rating: 1810 },
          { id: "char-d", rating: 1805 },
        ],
      }),
      run({
        runId: "r2",
        keyLevel: 10,
        completedAt: "2026-07-02T10:00:00.000Z",
        subjectRating: 1900,
        teammates: [
          { id: "char-a", rating: 2100 },
          { id: "char-b", rating: 2050 },
          { id: "char-c", rating: 2000 },
          { id: "char-d", rating: 1980 },
        ],
      }),
      run({
        runId: "r3",
        keyLevel: 12,
        completedAt: "2026-07-03T10:00:00.000Z",
        subjectRating: 2000,
        teammates: [
          { id: "char-a", rating: 2500 },
          { id: "char-b", rating: 2480 },
          { id: "char-c", rating: 2460 },
          { id: "char-d", rating: 2440 },
        ],
      }),
      run({
        runId: "r4",
        keyLevel: 14,
        completedAt: "2026-07-04T10:00:00.000Z",
        subjectRating: 2100,
        teammates: [
          { id: "char-a", rating: 2800 },
          { id: "char-b", rating: 2780 },
          { id: "char-c", rating: 2760 },
          { id: "char-d", rating: 2740 },
        ],
      }),
      run({
        runId: "r5",
        keyLevel: 16,
        completedAt: "2026-07-05T10:00:00.000Z",
        subjectRating: 2200,
        teammates: [
          { id: "char-a", rating: 3100 },
          { id: "char-b", rating: 3080 },
          { id: "char-c", rating: 3060 },
          { id: "char-d", rating: 3040 },
        ],
      }),
    ],
  };
}

/** Many runs at an already-established key — low velocity, high farm count. */
export function fixtureEstablishedFarmer(): BoostFeatureExtractorInput {
  const teammates = [
    { id: "char-a", rating: 3000 },
    { id: "char-b", rating: 2980 },
    { id: "char-c", rating: 2970 },
    { id: "char-d", rating: 2960 },
  ];
  const runs: BoostShadowRunInput[] = [
    run({
      runId: "base",
      keyLevel: 14,
      completedAt: "2026-06-01T10:00:00.000Z",
      subjectRating: 2800,
      teammates,
    }),
    run({
      runId: "peak",
      keyLevel: 16,
      completedAt: "2026-06-10T10:00:00.000Z",
      subjectRating: 2900,
      teammates,
    }),
  ];
  for (let i = 0; i < 8; i += 1) {
    runs.push(
      run({
        runId: `farm-${i}`,
        keyLevel: 16,
        completedAt: `2026-07-0${(i % 9) + 1}T12:00:00.000Z`,
        subjectRating: 2950,
        teammates,
      }),
    );
  }
  return {
    subjectCharacterId: SUBJECT,
    seasonId: SEASON,
    regionId: REGION,
    calculatedAt: T0,
    runs,
  };
}

/** High time-aligned gaps + repeated stronger cohort + concentrated roster. */
export function fixtureStrongerCohort(): BoostFeatureExtractorInput {
  const strong = [
    { id: "char-carry-1", rating: 3200 },
    { id: "char-carry-2", rating: 3150 },
    { id: "char-carry-3", rating: 3100 },
    { id: "char-carry-4", rating: 3050 },
  ];
  return {
    subjectCharacterId: SUBJECT,
    seasonId: SEASON,
    regionId: REGION,
    calculatedAt: T0,
    runs: [12, 13, 14, 15, 16].map((keyLevel, i) =>
      run({
        runId: `hk-${i}`,
        keyLevel,
        completedAt: `2026-07-0${i + 1}T10:00:00.000Z`,
        subjectRating: 2100,
        teammates: strong,
      }),
    ),
  };
}

/** Stable team with similar ratings — high concentration, low gap. */
export function fixtureStableTeam(): BoostFeatureExtractorInput {
  const peers = [
    { id: "char-peer-1", rating: 2500 },
    { id: "char-peer-2", rating: 2480 },
    { id: "char-peer-3", rating: 2520 },
    { id: "char-peer-4", rating: 2490 },
  ];
  return {
    subjectCharacterId: SUBJECT,
    seasonId: SEASON,
    regionId: REGION,
    calculatedAt: T0,
    runs: [12, 13, 14, 15].map((keyLevel, i) =>
      run({
        runId: `stable-${i}`,
        keyLevel,
        completedAt: `2026-07-0${i + 1}T10:00:00.000Z`,
        subjectRating: 2500,
        teammates: peers,
      }),
    ),
  };
}

/** Runs without subject at-run rating — gap features must omit, not invent. */
export function fixtureMissingSubjectAlignedRating(): BoostFeatureExtractorInput {
  const base = fixtureStrongerCohort();
  return {
    ...base,
    runs: base.runs.map((r) => ({
      ...r,
      participants: r.participants.map((p) =>
        p.isTargetCharacter ? { ...p, mythicRatingAtRun: null } : p,
      ),
    })),
    ratingSnapshots: [],
  };
}

/** Snapshot after the run must not be used for historical gap. */
export function fixtureRejectFutureSnapshot(): {
  input: BoostFeatureExtractorInput;
  snapshots: BoostShadowRatingSnapshotInput[];
} {
  const runs: BoostShadowRunInput[] = [
    {
      runId: "past-run",
      seasonId: SEASON,
      keyLevel: 14,
      timed: true,
      scoreValue: 1400,
      completedAt: "2026-07-01T10:00:00.000Z",
      source: "fixture",
      participants: [
        {
          characterId: SUBJECT,
          regionCode: "eu",
          realmSlug: "tarren-mill",
          isTargetCharacter: true,
          mythicRatingAtRun: null,
        },
        teammate("char-a", 3000),
        teammate("char-b", 2900),
        teammate("char-c", 2800),
        teammate("char-d", 2700),
      ],
    },
    {
      runId: "past-run-2",
      seasonId: SEASON,
      keyLevel: 15,
      timed: true,
      scoreValue: 1500,
      completedAt: "2026-07-02T10:00:00.000Z",
      source: "fixture",
      participants: [
        {
          characterId: SUBJECT,
          regionCode: "eu",
          realmSlug: "tarren-mill",
          isTargetCharacter: true,
          mythicRatingAtRun: null,
        },
        teammate("char-a", 3000),
        teammate("char-b", 2900),
        teammate("char-c", 2800),
        teammate("char-d", 2700),
      ],
    },
    {
      runId: "past-run-3",
      seasonId: SEASON,
      keyLevel: 16,
      timed: true,
      scoreValue: 1600,
      completedAt: "2026-07-03T10:00:00.000Z",
      source: "fixture",
      participants: [
        {
          characterId: SUBJECT,
          regionCode: "eu",
          realmSlug: "tarren-mill",
          isTargetCharacter: true,
          mythicRatingAtRun: null,
        },
        teammate("char-a", 3000),
        teammate("char-b", 2900),
        teammate("char-c", 2800),
        teammate("char-d", 2700),
      ],
    },
  ];

  const snapshots: BoostShadowRatingSnapshotInput[] = [
    {
      characterId: SUBJECT,
      mythicRating: 2800,
      capturedAt: "2026-07-20T10:00:00.000Z",
      seasonId: SEASON,
    },
  ];

  return {
    input: {
      subjectCharacterId: SUBJECT,
      seasonId: SEASON,
      regionId: REGION,
      calculatedAt: T0,
      runs,
      ratingSnapshots: snapshots,
    },
    snapshots,
  };
}

export function fixtureVerifiedAltMitigation(args?: {
  calculatedAt?: string;
  altVerifiedAt?: string;
  altFetchedAt?: string;
  altRating?: number;
  subjectRating?: number;
  includeAlt?: boolean;
  unlinked?: boolean;
  revoked?: boolean;
}): BoostFeatureExtractorInput {
  const calculatedAt = args?.calculatedAt ?? T0;
  const ownership: VerifiedOwnershipEvidenceInput[] = [
    {
      ownershipId: "own-subject",
      battleNetAccountId: "bnet-1",
      characterId: SUBJECT,
      regionId: REGION,
      status: args?.revoked ? "REVOKED" : "CURRENT",
      confidence: "CONFIRMED",
      verifiedAt: "2026-06-01T00:00:00.000Z",
      revokedAt: args?.revoked ? "2026-07-01T00:00:00.000Z" : null,
      accountClaimed: true,
      accountUnlinkedAt: args?.unlinked ? "2026-07-10T00:00:00.000Z" : null,
      currentSeasonMythicRating: args?.subjectRating ?? 2200,
      currentSeasonMythicSeasonId: SEASON,
      currentSeasonMythicFetchedAt: "2026-07-14T00:00:00.000Z",
    },
  ];

  if (args?.includeAlt !== false) {
    ownership.push({
      ownershipId: "own-alt",
      battleNetAccountId: "bnet-1",
      characterId: "char-alt-main",
      regionId: REGION,
      status: "CURRENT",
      confidence: "CONFIRMED",
      verifiedAt: args?.altVerifiedAt ?? "2026-06-01T00:00:00.000Z",
      revokedAt: null,
      accountClaimed: true,
      accountUnlinkedAt: args?.unlinked ? "2026-07-10T00:00:00.000Z" : null,
      currentSeasonMythicRating: args?.altRating ?? 3200,
      currentSeasonMythicSeasonId: SEASON,
      currentSeasonMythicFetchedAt: args?.altFetchedAt ?? "2026-07-14T00:00:00.000Z",
    });
  }

  return {
    ...fixtureStrongerCohort(),
    calculatedAt,
    ownershipEvidence: ownership,
  };
}

/** PIT: ownership learned after T must not mitigate historical sample. */
export function fixturePostHocOwnership(): BoostFeatureExtractorInput {
  return fixtureVerifiedAltMitigation({
    calculatedAt: "2026-07-01T12:00:00.000Z",
    altVerifiedAt: "2026-07-20T00:00:00.000Z",
    altFetchedAt: "2026-07-20T00:00:00.000Z",
  });
}

export const FIXTURE_IDS = {
  SUBJECT,
  SEASON,
  REGION,
  T0,
} as const;

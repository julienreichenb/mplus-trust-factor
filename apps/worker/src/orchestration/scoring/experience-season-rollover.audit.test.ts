/**
 * Agent 02 — provider-free future-season rollover fixtures.
 *
 * Invented IDs/slugs/dates on purpose. Proves the algorithm, not today's live seasons.
 * Do not replace these with Midnight / TWW live constants.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { RaiderIoStaticSeason } from "@mplus/contracts";
import {
  isCanonicalRaiderIoSeasonSlug,
  isRealMythicPlusRaiderIoSeason,
  matchBlizzardSeasonToRaiderIoByDates,
  pickPreviousSeasonByStartTimestamp,
  resetExperienceSeasonBindingEnsureStateForTests,
  resolveRaiderIoCurrentAndPrevious,
  shouldEnsureExperienceSeasonBinding,
  rememberExperienceSeasonBindingEnsured,
} from "./experience-season-bootstrap.js";
import {
  resolvePreviousMythicSeason,
  type ExperienceSeasonBindingCandidate,
} from "./experience-previous-season-evidence.js";

function rioSeason(input: {
  slug: string;
  isCurrent: boolean;
  startsAt: string;
  endsAt?: string | null;
  isMainSeason?: boolean | null;
  blizzardSeasonId?: number | null;
}): RaiderIoStaticSeason {
  return {
    slug: input.slug,
    name: input.slug,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    isCurrent: input.isCurrent,
    isMainSeason: input.isMainSeason ?? null,
    blizzardSeasonId: input.blizzardSeasonId ?? null,
    dungeonSlugs: [],
  };
}

function blizzardCandidate(
  partial: Partial<ExperienceSeasonBindingCandidate> &
    Pick<ExperienceSeasonBindingCandidate, "id" | "slug" | "blizzardSeasonId">,
): ExperienceSeasonBindingCandidate {
  return {
    regionId: "region-future",
    startsAt: null,
    endsAt: null,
    ...partial,
  };
}

describe("Agent 02 future-season real Mythic+ binding (invented IDs)", () => {
  /**
   * Expansion "ZX" seasons — invented, not live Midnight/TWW values.
   * Event season starts AFTER the real previous main season and BEFORE the new current.
   */
  const invented = {
    // Non-adjacent IDs: real previous is 9102, not current-1 (9104).
    currentBlizzardId: 9105,
    previousBlizzardId: 9102,
    skippedGapId: 9100,
    currentSlug: "season-zx-2",
    previousSlug: "season-zx-1",
    eventSlug: "season-zx-1-break-the-meta",
    cutoffsSlug: "season-zx-1-cutoffs",
    prePatchSlug: "season-zx-1-post",
    currentStart: "2031-09-01T04:00:00.000Z",
    previousStart: "2031-03-01T04:00:00.000Z",
    eventStart: "2031-07-15T04:00:00.000Z",
    prePatchStart: "2031-08-20T04:00:00.000Z",
    olderStart: "2030-09-01T04:00:00.000Z",
    // Cross-expansion invented previous.
    priorExpansionSlug: "season-yw-3",
    priorExpansionBlizzardId: 8099,
    priorExpansionStart: "2030-03-01T04:00:00.000Z",
  };

  beforeEach(() => {
    resetExperienceSeasonBindingEnsureStateForTests();
  });

  it("1) same-expansion N→N+1: Blizzard previous is chronological, never id-1", () => {
    const current = blizzardCandidate({
      id: "cur",
      slug: `blizzard-season-${invented.currentBlizzardId}`,
      blizzardSeasonId: invented.currentBlizzardId,
      startsAt: new Date(invented.currentStart),
      endsAt: null,
    });
    const candidates = [
      blizzardCandidate({
        id: "gap",
        slug: `blizzard-season-${invented.skippedGapId}`,
        blizzardSeasonId: invented.skippedGapId,
        startsAt: new Date(invented.olderStart),
        endsAt: new Date(invented.previousStart),
      }),
      blizzardCandidate({
        id: "prev",
        slug: `blizzard-season-${invented.previousBlizzardId}`,
        blizzardSeasonId: invented.previousBlizzardId,
        startsAt: new Date(invented.previousStart),
        endsAt: new Date(invented.currentStart),
      }),
      blizzardCandidate({
        id: "decoy-id-minus-one",
        slug: `blizzard-season-${invented.currentBlizzardId - 1}`,
        blizzardSeasonId: invented.currentBlizzardId - 1,
        startsAt: new Date("2030-12-01T00:00:00.000Z"),
        endsAt: new Date(invented.previousStart),
      }),
      current,
    ];

    const binding = resolvePreviousMythicSeason(current, candidates);
    expect(binding.ok).toBe(true);
    if (!binding.ok) return;
    expect(binding.season.id).toBe("prev");
    expect(binding.season.blizzardSeasonId).toBe(invented.previousBlizzardId);
    expect(binding.season.blizzardSeasonId).not.toBe(invented.currentBlizzardId - 1);

    const byStart = pickPreviousSeasonByStartTimestamp(
      Date.parse(invented.currentStart),
      candidates.map((c) => ({
        id: c.id,
        startTimestamp: c.startsAt?.getTime() ?? null,
        blizzardSeasonId: c.blizzardSeasonId,
      })),
    );
    expect(byStart?.id).toBe("prev");
    expect(byStart?.blizzardSeasonId).toBe(invented.previousBlizzardId);
  });

  it("2) cross-expansion: last season of prior expansion binds via Blizzard id + dates", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(invented.priorExpansionStart),
        endTimestamp: Date.parse(invented.previousStart),
        blizzardSeasonId: invented.priorExpansionBlizzardId,
      },
      [
        rioSeason({
          slug: invented.eventSlug,
          isCurrent: false,
          startsAt: invented.eventStart,
          isMainSeason: false,
          blizzardSeasonId: invented.previousBlizzardId,
        }),
        rioSeason({
          slug: invented.priorExpansionSlug,
          isCurrent: false,
          startsAt: invented.priorExpansionStart,
          endsAt: invented.previousStart,
          isMainSeason: true,
          blizzardSeasonId: invented.priorExpansionBlizzardId,
        }),
        rioSeason({
          slug: invented.previousSlug,
          isCurrent: false,
          startsAt: invented.previousStart,
          isMainSeason: true,
          blizzardSeasonId: invented.previousBlizzardId,
        }),
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe(invented.priorExpansionSlug);
  });

  it("3) inserted Break-the-Meta/event RIO season cannot become previous", () => {
    const seasons = [
      rioSeason({
        slug: invented.currentSlug,
        isCurrent: true,
        startsAt: invented.currentStart,
        isMainSeason: true,
        blizzardSeasonId: invented.currentBlizzardId,
      }),
      rioSeason({
        slug: invented.previousSlug,
        isCurrent: false,
        startsAt: invented.previousStart,
        endsAt: invented.currentStart,
        isMainSeason: true,
        blizzardSeasonId: invented.previousBlizzardId,
      }),
      rioSeason({
        slug: invented.eventSlug,
        isCurrent: false,
        startsAt: invented.eventStart,
        endsAt: "2031-07-22T04:00:00.000Z",
        isMainSeason: false,
        blizzardSeasonId: invented.previousBlizzardId,
      }),
      rioSeason({
        slug: invented.cutoffsSlug,
        isCurrent: false,
        startsAt: invented.previousStart,
        endsAt: invented.currentStart,
        isMainSeason: false,
        blizzardSeasonId: invented.previousBlizzardId,
      }),
    ];

    // Diagnostic: unfiltered chronological previous still picks the event (trap proof).
    const unfiltered = resolveRaiderIoCurrentAndPrevious(seasons, { unfiltered: true });
    expect(unfiltered.ok).toBe(true);
    if (!unfiltered.ok) return;
    expect(unfiltered.previous?.slug).toBe(invented.eventSlug);

    // Experience path: real main seasons only.
    const filtered = resolveRaiderIoCurrentAndPrevious(seasons);
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(filtered.previous?.slug).toBe(invented.previousSlug);

    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(invented.previousStart),
        endTimestamp: Date.parse(invented.currentStart),
        blizzardSeasonId: invented.previousBlizzardId,
      },
      seasons,
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe(invented.previousSlug);
  });

  it("4) pre-patch-like interval: is_main_season true wins even when slug fails regex", () => {
    expect(isCanonicalRaiderIoSeasonSlug(invented.prePatchSlug)).toBe(false);
    const prePatch = rioSeason({
      slug: invented.prePatchSlug,
      isCurrent: false,
      startsAt: invented.prePatchStart,
      isMainSeason: true,
      blizzardSeasonId: invented.previousBlizzardId,
    });
    expect(isRealMythicPlusRaiderIoSeason(prePatch)).toBe(true);

    // When Blizzard id uniquely matches the pre-patch main season, bind it.
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(invented.prePatchStart),
        endTimestamp: Date.parse(invented.currentStart),
        blizzardSeasonId: invented.previousBlizzardId,
      },
      [
        rioSeason({
          slug: invented.previousSlug,
          isCurrent: false,
          startsAt: invented.previousStart,
          isMainSeason: true,
          blizzardSeasonId: 9999, // different Blizzard id
        }),
        prePatch,
        rioSeason({
          slug: invented.eventSlug,
          isCurrent: false,
          startsAt: invented.eventStart,
          isMainSeason: false,
          blizzardSeasonId: invented.previousBlizzardId,
        }),
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe(invented.prePatchSlug);
  });

  it("5) duplicate/tied date candidates fail closed", () => {
    const tieStart = invented.previousStart;
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(tieStart),
        endTimestamp: Date.parse(invented.currentStart),
        // No blizzard id — force date path.
        blizzardSeasonId: null,
      },
      [
        rioSeason({
          slug: "season-zx-1a",
          isCurrent: false,
          startsAt: tieStart,
          isMainSeason: true,
          blizzardSeasonId: 9102,
        }),
        rioSeason({
          slug: "season-zx-1b",
          isCurrent: false,
          startsAt: tieStart,
          isMainSeason: true,
          blizzardSeasonId: 9103,
        }),
      ],
    );
    expect(matched.ok).toBe(false);
    if (matched.ok) return;
    expect(matched.reason).toBe("RIO_DATE_MATCH_AMBIGUOUS_START");

    const prev = pickPreviousSeasonByStartTimestamp(Date.parse(invented.currentStart), [
      { id: "a", startTimestamp: Date.parse(tieStart) },
      { id: "b", startTimestamp: Date.parse(tieStart) },
    ]);
    expect(prev).toBeNull();
  });

  it("6) long-lived worker: authority N→N+1 without restart re-triggers ensure", () => {
    const region = "EU";
    expect(
      shouldEnsureExperienceSeasonBinding({
        regionCode: region,
        currentBlizzardSeasonId: invented.previousBlizzardId,
      }),
    ).toBe(true);

    rememberExperienceSeasonBindingEnsured(region, invented.previousBlizzardId);
    expect(
      shouldEnsureExperienceSeasonBinding({
        regionCode: region,
        currentBlizzardSeasonId: invented.previousBlizzardId,
      }),
    ).toBe(false);

    // Same process, season flips to N+1 — must ensure again (no restart).
    expect(
      shouldEnsureExperienceSeasonBinding({
        regionCode: region,
        currentBlizzardSeasonId: invented.currentBlizzardId,
      }),
    ).toBe(true);

    rememberExperienceSeasonBindingEnsured(region, invented.currentBlizzardId);
    expect(
      shouldEnsureExperienceSeasonBinding({
        regionCode: region,
        currentBlizzardSeasonId: invented.currentBlizzardId,
      }),
    ).toBe(false);
  });

  it("7) selection behavior has no hard-coded live Midnight/TWW IDs or slugs", () => {
    const liveForbidden = [
      17,
      18,
      15,
      "season-mn-1",
      "season-mn-2",
      "season-tww-3",
      "midnight",
    ];
    const source = [
      invented.currentBlizzardId,
      invented.previousBlizzardId,
      invented.currentSlug,
      invented.previousSlug,
      invented.eventSlug,
      invented.priorExpansionSlug,
    ].join("|");
    for (const token of liveForbidden) {
      expect(source.includes(String(token))).toBe(false);
    }
  });

  it("missing isMainSeason fails closed (slug regex is not authority)", () => {
    const seasons = [
      rioSeason({
        slug: invented.currentSlug,
        isCurrent: true,
        startsAt: invented.currentStart,
        isMainSeason: true,
        blizzardSeasonId: invented.currentBlizzardId,
      }),
      rioSeason({
        slug: invented.previousSlug,
        isCurrent: false,
        startsAt: invented.previousStart,
        // omitted → null → not a real season for Experience
        isMainSeason: null,
        blizzardSeasonId: invented.previousBlizzardId,
      }),
      rioSeason({
        slug: invented.eventSlug,
        isCurrent: false,
        startsAt: invented.eventStart,
        isMainSeason: false,
      }),
    ];
    expect(isCanonicalRaiderIoSeasonSlug(invented.previousSlug)).toBe(true);
    expect(isRealMythicPlusRaiderIoSeason(seasons[1]!)).toBe(false);

    const filtered = resolveRaiderIoCurrentAndPrevious(seasons);
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(filtered.previous).toBeNull();
    expect(filtered.previousReason).toBe("RIO_NO_PREVIOUS_SEASON");
  });
});

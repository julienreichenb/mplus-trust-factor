/**
 * Agent 01 — provider-free future-season rollover fixtures.
 *
 * Invented IDs/slugs/dates on purpose. Proves the algorithm, not today's live seasons.
 * Do not replace these with Midnight / TWW live constants.
 */
import { describe, expect, it } from "vitest";
import {
  isCanonicalRaiderIoSeasonSlug,
  matchBlizzardSeasonToRaiderIoByDates,
  pickPreviousSeasonByStartTimestamp,
  resolveRaiderIoCurrentAndPrevious,
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
}): {
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  isCurrent: boolean;
  dungeonSlugs: string[];
} {
  return {
    slug: input.slug,
    name: input.slug,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    isCurrent: input.isCurrent,
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

describe("Agent 01 future-season rollover (invented IDs)", () => {
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
    currentStart: "2031-09-01T04:00:00.000Z",
    previousStart: "2031-03-01T04:00:00.000Z",
    eventStart: "2031-07-15T04:00:00.000Z",
    olderStart: "2030-09-01T04:00:00.000Z",
  };

  it("Blizzard catalog previous is chronological by startsAt, never blizzardSeasonId-1", () => {
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
      // Decoy: blizzardSeasonId === current-1 but starts earlier than real previous.
      // ID arithmetic would pick this; chronological must pick "prev" (9102).
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

  it("Raider.IO event/intermediate season wins chronological previous unless filtered", () => {
    const seasons = [
      rioSeason({
        slug: invented.currentSlug,
        isCurrent: true,
        startsAt: invented.currentStart,
      }),
      rioSeason({
        slug: invented.previousSlug,
        isCurrent: false,
        startsAt: invented.previousStart,
        endsAt: invented.currentStart,
      }),
      rioSeason({
        slug: invented.eventSlug,
        isCurrent: false,
        startsAt: invented.eventStart,
        endsAt: "2031-07-22T04:00:00.000Z",
      }),
      rioSeason({
        slug: invented.cutoffsSlug,
        isCurrent: false,
        startsAt: invented.previousStart,
        endsAt: invented.currentStart,
      }),
    ];

    // Current production helper does NOT filter event seasons.
    const unfiltered = resolveRaiderIoCurrentAndPrevious(seasons);
    expect(unfiltered.ok).toBe(true);
    if (!unfiltered.ok) return;
    expect(unfiltered.current.slug).toBe(invented.currentSlug);
    expect(unfiltered.previous?.slug).toBe(invented.eventSlug);

    // Canonical slug filter (used by Blizzard↔RIO date match) excludes event/cutoffs.
    expect(isCanonicalRaiderIoSeasonSlug(invented.previousSlug)).toBe(true);
    expect(isCanonicalRaiderIoSeasonSlug(invented.eventSlug)).toBe(false);
    expect(isCanonicalRaiderIoSeasonSlug(invented.cutoffsSlug)).toBe(false);

    const filtered = resolveRaiderIoCurrentAndPrevious(
      seasons.filter((s) => isCanonicalRaiderIoSeasonSlug(s.slug)),
    );
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(filtered.previous?.slug).toBe(invented.previousSlug);
  });

  it("Blizzard→RIO date match binds the real previous main season, ignoring event variants", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(invented.previousStart),
        endTimestamp: Date.parse(invented.currentStart),
      },
      [
        rioSeason({
          slug: invented.eventSlug,
          isCurrent: false,
          startsAt: invented.eventStart,
        }),
        rioSeason({
          slug: invented.cutoffsSlug,
          isCurrent: false,
          startsAt: invented.previousStart,
        }),
        rioSeason({
          slug: invented.previousSlug,
          isCurrent: false,
          startsAt: invented.previousStart,
          endsAt: invented.currentStart,
        }),
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe(invented.previousSlug);
  });
});

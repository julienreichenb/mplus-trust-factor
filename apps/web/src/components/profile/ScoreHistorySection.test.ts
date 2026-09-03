import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { CharacterIdentityInput, ScoreSnapshotDTO } from "@mplus/contracts";
import ScoreHistorySection from "./ScoreHistorySection.vue";

const identity: CharacterIdentityInput = {
  region: "US",
  realmSlug: "stormrage",
  name: "TestName",
};

function snapshot(overrides: Partial<ScoreSnapshotDTO>): ScoreSnapshotDTO {
  return {
    calculatedAt: "2026-09-01T12:00:00.000Z",
    seasonSlug: "season-1",
    modelKey: "test-model",
    overallScore: 80,
    scoreContext: { rawScoreBeforeContext: 70 } as ScoreSnapshotDTO["scoreContext"],
    ...overrides,
  } as ScoreSnapshotDTO;
}

describe("ScoreHistorySection", () => {
  it("is collapsed by default and shows empty state", () => {
    const wrapper = mount(ScoreHistorySection, {
      props: { identity, snapshots: [] },
    });

    const details = wrapper.get("details");
    expect(details.attributes("open")).toBeUndefined();
    expect(wrapper.text()).toContain("No score history available.");
  });

  it("renders raw/adjusted points and shows tooltip on focus", async () => {
    const wrapper = mount(ScoreHistorySection, {
      props: {
        identity,
        snapshots: [
          snapshot({
            calculatedAt: "2026-08-31T10:00:00.000Z",
            seasonSlug: "season-1",
            overallScore: 75,
            scoreContext: { rawScoreBeforeContext: 65 } as ScoreSnapshotDTO["scoreContext"],
          }),
        ],
      },
    });

    const adjusted = wrapper.findAll("circle.score-history__point--adjusted");
    expect(adjusted.length).toBe(1);

    await adjusted[0]!.trigger("focus");
    const tooltip = wrapper.find(".score-history__tooltip");
    expect(tooltip.exists()).toBe(true);
    expect(wrapper.text()).toContain("Calculated");
    expect(wrapper.text()).toContain("Raw");
    expect(wrapper.text()).toContain("Adjusted");
  });

  it("handles partially unavailable raw score (tooltip shows Unavailable)", async () => {
    const wrapper = mount(ScoreHistorySection, {
      props: {
        identity,
        snapshots: [
          snapshot({
            calculatedAt: "2026-08-31T10:00:00.000Z",
            seasonSlug: "season-1",
            overallScore: 80,
            scoreContext: { rawScoreBeforeContext: null } as ScoreSnapshotDTO["scoreContext"],
          }),
        ],
      },
    });

    const adjusted = wrapper.findAll("circle.score-history__point--adjusted");
    await adjusted[0]!.trigger("focus");

    const tooltip = wrapper.find(".score-history__tooltip");
    expect(tooltip.exists()).toBe(true);
    expect(tooltip.text()).toContain("Unavailable");
  });

  it("fetches /history when snapshots prop is not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        snapshots: [
          snapshot({
            calculatedAt: "2026-08-31T10:00:00.000Z",
            seasonSlug: "season-1",
            overallScore: 80,
            scoreContext: { rawScoreBeforeContext: 70 } as ScoreSnapshotDTO["scoreContext"],
          }),
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ScoreHistorySection, {
      props: { identity },
    });

    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
    expect(wrapper.findAll("circle.score-history__point--adjusted").length).toBe(1);
  });

  it("refetches history when scoreCalculatedAt changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ snapshots: [snapshot({})] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ScoreHistorySection, {
      props: {
        identity,
        scoreCalculatedAt: "2026-09-01T12:00:00.000Z",
      },
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ scoreCalculatedAt: "2026-09-01T13:00:00.000Z" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale deferred response after identity changes", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snapshots: [
            snapshot({
              calculatedAt: "2026-09-02T10:00:00.000Z",
              overallScore: 91,
              seasonSlug: "season-new",
            }),
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ScoreHistorySection, {
      props: { identity },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      identity: { region: "EU", realmSlug: "archimonde", name: "Other" },
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const freshPoint = wrapper.find("circle.score-history__point--adjusted");
    expect(freshPoint.exists()).toBe(true);
    expect(freshPoint.attributes("aria-label")).toContain("season-new");
    expect(freshPoint.attributes("aria-label")).toContain("91");

    resolveFirst({
      ok: true,
      json: async () => ({
        snapshots: [
          snapshot({
            calculatedAt: "2026-08-01T10:00:00.000Z",
            overallScore: 10,
            seasonSlug: "season-stale",
          }),
        ],
      }),
    });
    await flushPromises();

    const afterStale = wrapper.find("circle.score-history__point--adjusted");
    expect(afterStale.attributes("aria-label")).toContain("season-new");
    expect(afterStale.attributes("aria-label")).toContain("91");
    expect(afterStale.attributes("aria-label")).not.toContain("season-stale");
  });
});


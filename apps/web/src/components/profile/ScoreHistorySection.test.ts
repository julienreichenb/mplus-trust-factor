import { afterEach, describe, expect, it, vi } from "vitest";
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

function mockHistory(snapshots: ScoreSnapshotDTO[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ snapshots }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ScoreHistorySection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is collapsed by default and shows empty state", async () => {
    mockHistory([]);
    const wrapper = mount(ScoreHistorySection, {
      props: { identity },
    });
    await flushPromises();

    const details = wrapper.get("details");
    expect(details.attributes("open")).toBeUndefined();
    expect(wrapper.text()).toContain("No score history available.");
  });

  it("renders raw/adjusted values in the accessible table", async () => {
    mockHistory([
      snapshot({
        calculatedAt: "2026-08-31T10:00:00.000Z",
        seasonSlug: "season-1",
        overallScore: 75,
        scoreContext: { rawScoreBeforeContext: 65 } as ScoreSnapshotDTO["scoreContext"],
      }),
    ]);
    const wrapper = mount(ScoreHistorySection, { props: { identity } });
    await flushPromises();

    const table = wrapper.get("[data-testid='score-history-table']");
    expect(table.text()).toContain("Season 1");
    expect(table.text()).toContain("75.0");
    expect(table.text()).toContain("65.0");
    expect(wrapper.find("[data-testid='score-history-chart']").exists()).toBe(true);
  });

  it("handles partially unavailable raw score", async () => {
    mockHistory([
      snapshot({
        calculatedAt: "2026-08-31T10:00:00.000Z",
        overallScore: 80,
        scoreContext: { rawScoreBeforeContext: null } as ScoreSnapshotDTO["scoreContext"],
      }),
    ]);
    const wrapper = mount(ScoreHistorySection, { props: { identity } });
    await flushPromises();

    const table = wrapper.get("[data-testid='score-history-table']");
    expect(table.text()).toContain("80.0");
    expect(table.text()).toContain("Unavailable");
  });

  it("fetches /history with cache no-store", async () => {
    const fetchMock = mockHistory([
      snapshot({
        calculatedAt: "2026-08-31T10:00:00.000Z",
        overallScore: 80,
        scoreContext: { rawScoreBeforeContext: 70 } as ScoreSnapshotDTO["scoreContext"],
      }),
    ]);
    const wrapper = mount(ScoreHistorySection, { props: { identity } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
    expect(wrapper.get("[data-testid='score-history-table']").text()).toContain("80.0");
  });

  it("refetches history when scoreCalculatedAt changes", async () => {
    const fetchMock = mockHistory([snapshot({})]);
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

    const wrapper = mount(ScoreHistorySection, { props: { identity } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      identity: { region: "EU", realmSlug: "archimonde", name: "Other" },
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const table = wrapper.get("[data-testid='score-history-table']");
    expect(table.text()).toContain("Season New");
    expect(table.text()).toContain("91.0");

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

    expect(table.text()).toContain("Season New");
    expect(table.text()).toContain("91.0");
    expect(table.text()).not.toContain("Season Stale");
    expect(table.text()).not.toContain("10.0");
  });
});

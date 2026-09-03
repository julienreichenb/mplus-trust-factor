import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CharacterScoreLoadingPanel from "./CharacterScoreLoadingPanel.vue";
import type { CharacterProfileView, JobStatusDTO } from "../../api/types";

const profile = {
  displayName: "Newchar",
  realmSlug: "tarren-mill",
  region: "EU",
  classSlug: "mage",
  specSlug: "fire",
  role: "DPS",
} as CharacterProfileView;

describe("CharacterScoreLoadingPanel", () => {
  it("renders calculating skeletons without Unavailable score copy", () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "calculating", profile },
      global: { stubs: { HeroGearPanel: true, HeroTalentPanel: true } },
    });
    expect(wrapper.attributes("data-phase")).toBe("calculating");
    expect(wrapper.text()).toContain("Calculating Trust Score");
    expect(wrapper.find("[data-testid='score-loading-name']").text()).toContain("Newchar");
    expect(wrapper.text()).not.toContain("Unavailable");
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true);
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("shows queue-wait ETA and jobs ahead when available", () => {
    const job = {
      jobId: "j1",
      queue: "refresh-character",
      status: "queued",
      dedupeKey: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      queuePosition: 4,
      estimatedWaitSeconds: 180,
      estimateConfidence: "MEDIUM",
      schedulingState: "RUNNING",
    } as JobStatusDTO;

    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "calculating", profile, job },
      global: { stubs: { HeroGearPanel: true, HeroTalentPanel: true } },
    });
    expect(wrapper.text()).toMatch(/queue wait about 2–5 min/i);
    expect(wrapper.find("[data-testid='score-loading-jobs-ahead']").text()).toMatch(
      /Approximately 4 jobs ahead/i,
    );
  });

  it("renders terminal failure with retry", async () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "failed" },
    });
    expect(wrapper.text()).toContain("Calculation failed");
    await wrapper.get("[data-testid='character-score-loading-retry']").trigger("click");
    expect(wrapper.emitted("retry")).toBeTruthy();
  });

  it("renders timeout with retry", () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "timed_out" },
    });
    expect(wrapper.text()).toContain("timed out");
    expect(wrapper.find("[data-testid='character-score-loading-retry']").exists()).toBe(true);
  });
});

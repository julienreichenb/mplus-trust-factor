import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CharacterRefreshEta from "./CharacterRefreshEta.vue";
import type { JobStatusDTO } from "../../api/types";

function job(partial: Partial<JobStatusDTO> = {}): JobStatusDTO {
  return {
    jobId: "j1",
    queue: "refresh-character",
    status: "queued",
    dedupeKey: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    ...partial,
  };
}

describe("CharacterRefreshEta", () => {
  it("shows queued phase and approximate jobs ahead", () => {
    const wrapper = mount(CharacterRefreshEta, {
      props: {
        refreshStatus: "QUEUED",
        job: job({
          status: "queued",
          queuePosition: 3,
          estimatedWaitSeconds: 300,
          estimateConfidence: "MEDIUM",
          schedulingState: "RUNNING",
          activeRefreshCount: 1,
          effectiveWorkerCapacity: 0,
          observedThroughput: 0.01,
        }),
      },
    });
    expect(wrapper.get("[data-testid='refresh-eta-phase']").text()).toBe("Queued");
    expect(wrapper.get("[data-testid='refresh-eta-jobs-ahead']").text()).toContain("~3");
    expect(wrapper.get("[data-testid='refresh-eta-wait']").text()).toMatch(/2–5 min|2-5 min/);
  });

  it("shows processing for active jobs", () => {
    const wrapper = mount(CharacterRefreshEta, {
      props: {
        refreshStatus: "IN_PROGRESS",
        job: job({
          status: "active",
          queuePosition: 0,
          estimatedWaitSeconds: 0,
          estimateConfidence: "HIGH",
          schedulingState: "RUNNING",
          activeRefreshCount: 1,
          effectiveWorkerCapacity: 0,
        }),
      },
    });
    expect(wrapper.get("[data-testid='refresh-eta-phase']").text()).toBe("Processing");
  });

  it("shows scheduling explanation when wait is unavailable", () => {
    const wrapper = mount(CharacterRefreshEta, {
      props: {
        refreshStatus: "QUEUED",
        job: job({
          status: "queued",
          queuePosition: 2,
          estimatedWaitSeconds: null,
          estimateConfidence: "LOW",
          schedulingState: "PAUSED",
          activeRefreshCount: 0,
          effectiveWorkerCapacity: 0,
        }),
      },
    });
    expect(wrapper.get("[data-testid='refresh-eta-explanation']").text()).toMatch(/paused/i);
  });

  it("shows failed distinctly", () => {
    const wrapper = mount(CharacterRefreshEta, {
      props: {
        failed: true,
        job: job({ status: "failed" }),
      },
    });
    expect(wrapper.get("[data-testid='refresh-eta-phase']").text()).toBe("Refresh failed");
  });
});

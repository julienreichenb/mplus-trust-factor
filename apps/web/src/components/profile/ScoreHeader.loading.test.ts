import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ScoreHeader from "../profile/ScoreHeader.vue";
import type { CharacterProfileView, JobStatusDTO } from "../../api/types";
import { routeDefs } from "../../routes";

const profile = {
  characterId: "c-1",
  displayName: "Newchar",
  realmSlug: "tarren-mill",
  region: "EU",
  classSlug: "mage",
  specSlug: "fire",
  role: "DPS",
  score: null,
  entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
  seasonSummary: { mythicRating: 2145.2 },
  equipment: {
    equippedItemLevel: 668,
    averageItemLevel: 667,
    items: [{ slot: "HEAD", name: "Test Helm", itemLevel: 668 }],
    keyItems: [],
  },
  talents: {
    summary: "Fire loadout",
    loadoutCode: "ABC",
    selectedTalents: [],
  },
} as unknown as CharacterProfileView;

async function mountHeader(
  props: Record<string, unknown> = {},
) {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/");
  await router.isReady();
  return mount(ScoreHeader, {
    props: {
      profile,
      scoreLoadPhase: "calculating",
      ...props,
    },
    global: {
      plugins: [router],
      stubs: { HeroGearPanel: true, HeroTalentPanel: true, TrustRadarChart: true },
    },
  });
}

describe("ScoreHeader first-score loading mode", () => {
  it("keeps ScoreHeader structure with score skeletons and real identity", async () => {
    const wrapper = await mountHeader();
    expect(wrapper.find("[data-testid='score-header']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-name']").text()).toContain("Newchar");
    expect(wrapper.find("[data-testid='score-loading-realm']").text()).toMatch(/tarren-mill/i);
    expect(wrapper.find("[data-testid='score-loading-class']").text()).toMatch(/Fire Mage/i);
    expect(wrapper.find("[data-testid='score-loading-role']").text()).toContain("DPS");
    expect(wrapper.find("[data-testid='insight-accordion']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-grade-skeleton']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-radar-skeleton']").exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/Grade unavailable/i);
    expect(wrapper.text()).not.toMatch(/\/\s*100/);
    expect(wrapper.find("[data-testid='overall-score']").exists()).toBe(false);
  });

  it("shows queue-wait ETA and jobs ahead when available", async () => {
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

    const wrapper = await mountHeader({ refreshJob: job });
    expect(wrapper.find("[data-testid='character-score-loading']").text()).toMatch(
      /queue wait about 2–5 min/i,
    );
    expect(wrapper.find("[data-testid='score-loading-jobs-ahead']").text()).toMatch(
      /Approximately 4 jobs ahead/i,
    );
  });

  it("omits duration when no reliable estimate exists", async () => {
    const job = {
      jobId: "j1",
      queue: "refresh-character",
      status: "active",
      dedupeKey: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      queuePosition: null,
      estimatedWaitSeconds: null,
      estimateConfidence: "LOW",
      schedulingState: "RUNNING",
    } as JobStatusDTO;

    const wrapper = await mountHeader({ refreshJob: job });
    expect(wrapper.text()).toContain("Trust Score in progress");
    expect(wrapper.text()).not.toMatch(/queue wait/i);
    expect(wrapper.find("[data-testid='score-loading-jobs-ahead']").exists()).toBe(false);
  });

  it("renders terminal failure with GET-only retry emit", async () => {
    const wrapper = await mountHeader({ scoreLoadPhase: "failed", refreshJob: null });
    expect(wrapper.text()).toContain("Calculation failed");
    await wrapper.get("[data-testid='character-score-loading-retry']").trigger("click");
    expect(wrapper.emitted("retryScoreLoad")).toBeTruthy();
  });
});

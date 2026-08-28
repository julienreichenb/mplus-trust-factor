import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminAbilityCatalogReviewPage from "./AdminAbilityCatalogReviewPage.vue";
import { routeDefs } from "../routes";
import { ApiClientError } from "../api/live-client";

const listBatches = vi.fn();
const listItems = vi.fn();
const getItem = vi.fn();
const decideItem = vi.fn();
const updateDraft = vi.fn();
const ensureDraft = vi.fn();
const validateDraft = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listAbilityCatalogReviewBatches: (...args: unknown[]) => listBatches(...args),
    listAbilityCatalogReviewItems: (...args: unknown[]) => listItems(...args),
    getAbilityCatalogReviewItem: (...args: unknown[]) => getItem(...args),
    decideAbilityCatalogReviewItem: (...args: unknown[]) => decideItem(...args),
    updateAbilityCatalogDraft: (...args: unknown[]) => updateDraft(...args),
    ensureAbilityCatalogDraft: (...args: unknown[]) => ensureDraft(...args),
    validateAbilityCatalogDraft: (...args: unknown[]) => validateDraft(...args),
  },
}));

const batch = {
  id: "44c440cb-e494-4624-8652-f573fb1e7c67",
  reportDigest: "abc",
  datasetKind: "PINNED",
  wowBuild: "69299",
  simcRevision: "a060a356e16fdf266cb8b93fa4a9c892f3e26af3",
  blizzardNamespace: "static-eu",
  status: "OPEN",
  summaryCounts: {
    newAbilityCandidates: 84,
    spellBindingReviews: 21,
    topologyReviews: 1,
    removalReviews: 0,
  },
  decisionCounts: {
    total: 106,
    pending: 106,
    decided: 0,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    draftsNeedsMetadata: 0,
    draftsReadyForPublishReview: 0,
  },
};

const veItem = {
  id: "item-ve",
  batchId: batch.id,
  kind: "NEW_ABILITY_CANDIDATE",
  name: "Vampiric Embrace",
  primarySpellId: 15286,
  classSlug: "priest",
  specSlugs: ["shadow"],
  raceSlugs: [],
  decisionAction: null,
  version: 1,
  reviewReason: "strong",
  eligibilityState: "STRONG_REVIEW_CANDIDATE",
  evidence: { cooldownSeconds: 120 },
  sourceProvenance: { source: "SIMULATIONCRAFT" },
  matchedCanonicalKey: null,
  draftRule: null,
  draftTopology: null,
  draftStatus: null,
  draftValidation: null,
  decisionEvents: [],
  wowheadUrl: "https://www.wowhead.com/spell=15286",
};

const haranirItem = {
  ...veItem,
  id: "item-haranir",
  kind: "TOPOLOGY_REVIEW",
  name: "haranir",
  primarySpellId: null,
  classSlug: null,
  specSlugs: [],
  raceSlugs: ["haranir"],
  wowheadUrl: null,
};

const raiseAllyItem = {
  ...veItem,
  id: "item-raise-ally",
  kind: "SPELL_BINDING_REVIEW",
  name: "Raise Ally",
  primarySpellId: 61999,
  matchedCanonicalKey: "death-knight.battle-rez.raise-ally",
  classSlug: "death-knight",
  specSlugs: [],
  raceSlugs: [],
  evidence: {
    bindingChanges: [
      {
        spellId: 61999,
        currentRoles: ["PRIMARY_ACTIVATION"],
        candidateRoles: ["PRIMARY_ACTIVATION", "SUMMON"],
      },
    ],
  },
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/ability-catalog/review");
  await router.isReady();
  const wrapper = mount(AdminAbilityCatalogReviewPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminAbilityCatalogReviewPage", () => {
  beforeEach(() => {
    listBatches.mockResolvedValue({ batches: [batch] });
    listItems.mockResolvedValue({ items: [veItem, haranirItem], total: 2, page: 1, pageSize: 200 });
    getItem.mockImplementation(async (id: string) =>
      id === haranirItem.id ? haranirItem : veItem,
    );
    decideItem.mockImplementation(async (_id: string, body: { action: string }) => ({
      ...veItem,
      decisionAction: body.action,
      version: 2,
      draftRule: {
        version: 1,
        status: "NEEDS_METADATA",
        name: "Vampiric Embrace",
        spellIds: [15286],
        bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
      },
      draftStatus: "NEEDS_METADATA",
      draftValidation: {
        status: "NEEDS_METADATA",
        readyForPublishReview: false,
        reasonCodes: ["MISSING_CATEGORY", "MISSING_PROVENANCE"],
        errors: [],
        warnings: [],
      },
      decisionEvents: [
        {
          id: "ev1",
          actorUserId: null,
          actorType: "admin_key",
          previousState: {},
          newState: { decisionAction: body.action },
          note: null,
          createdAt: "2026-08-16T20:00:00.000Z",
        },
      ],
    }));
    updateDraft.mockResolvedValue({
      ...veItem,
      draftStatus: "READY_FOR_PUBLISH_REVIEW",
      draftRule: { version: 2, status: "READY_FOR_PUBLISH_REVIEW" },
      draftValidation: {
        status: "READY_FOR_PUBLISH_REVIEW",
        readyForPublishReview: true,
        reasonCodes: [],
        errors: [],
        warnings: [],
      },
      decisionEvents: [],
    });
    validateDraft.mockResolvedValue({
      itemId: veItem.id,
      validation: {
        status: "NEEDS_METADATA",
        readyForPublishReview: false,
        reasonCodes: ["MISSING_CATEGORY"],
        errors: [],
        warnings: [],
      },
      draft: null,
    });
    ensureDraft.mockImplementation(async () => {
      const next = {
        ...veItem,
        draftRule: {
          version: 1,
          status: "NEEDS_METADATA",
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
        },
        draftStatus: "NEEDS_METADATA",
        draftValidation: {
          status: "NEEDS_METADATA",
          readyForPublishReview: false,
          reasonCodes: ["MISSING_CATEGORY"],
          errors: [],
          warnings: [],
        },
      };
      getItem.mockResolvedValue(next);
      return next;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders human-readable review chrome without raw JSON by default", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='ability-catalog-review-page']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='review-batch-selector']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='review-batch-progress']").text()).toContain("106");
    expect(wrapper.find("[data-testid='review-batch-progress']").text()).toMatch(/pending/i);
    expect(wrapper.find("[data-testid='review-filters']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='review-filters']").attributes("open")).toBeUndefined();
    expect(wrapper.find("[data-testid='more-filters']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='review-filters-more']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='draft-editor']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='panel-ability-details']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='panel-compare']").text()).toContain("Not present in catalog");
    expect(wrapper.find("[data-testid='panel-review']").text()).toContain("Review");
    expect(wrapper.find("[data-testid='panel-review']").text()).not.toMatch(/No draft yet/i);
    expect(wrapper.find("[data-testid='panel-why']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='panel-why']").text()).toContain("Why is this being reviewed?");
    const detailsEl = wrapper.get("[data-testid='panel-ability-details']").element;
    const whyEl = wrapper.get("[data-testid='panel-why']").element;
    expect(
      Boolean(detailsEl.compareDocumentPosition(whyEl) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(wrapper.text()).not.toContain("Current vs proposed");
    expect(wrapper.find("[data-testid='review-item-list']").text()).not.toContain("curated");
    expect(wrapper.find("[data-testid='review-item-list']").text()).not.toContain("READY_FOR_PUBLISH_REVIEW");
    expect(wrapper.find("[data-testid='review-item-list']").text()).toContain("New ability");
    expect(wrapper.find("[data-testid='review-item-detail']").text()).toContain("Strong evidence");
    expect(wrapper.find("[data-testid='review-spell-icon']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='review-item-detail']").text()).not.toContain("Wowhead");
    expect(wrapper.find("[data-testid='review-item-list']").text()).not.toContain(
      "NEW_ABILITY_CANDIDATE",
    );
    expect(wrapper.find("[data-testid='panel-why']").text()).not.toContain(
      "STRONG_REVIEW_CANDIDATE",
    );
    expect(wrapper.text()).not.toContain("Icy Veins");
    expect(wrapper.text()).not.toContain("Stormkeeper");
    expect(wrapper.find("[data-testid='panel-technical']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='panel-audit']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='save-review']").exists()).toBe(true);
  });

  it("shows compact current catalog rule and binding change for spell binding review", async () => {
    listItems.mockResolvedValue({
      items: [raiseAllyItem],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    getItem.mockResolvedValue(raiseAllyItem);
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='panel-binding-summary']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='panel-binding-current-rule']").text()).toContain(
      "Current catalog rule",
    );
    expect(wrapper.find("[data-testid='panel-binding-current-rule']").text()).toContain(
      "BATTLE_REZ",
    );
    expect(wrapper.find("[data-testid='panel-binding-current-rule']").text()).toContain(
      "Primary activation",
    );
    expect(wrapper.find("[data-testid='panel-binding-current-rule']").text()).not.toContain(
      "600s",
    );
    expect(wrapper.find("[data-testid='panel-binding-change']").text()).toContain("Binding change");
    expect(wrapper.find("[data-testid='panel-binding-change']").text()).toContain("Summon");
    expect(wrapper.find("[data-testid='panel-compare']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("binding KEEP_CURRENT does not send draft payload", async () => {
    listItems.mockResolvedValue({
      items: [raiseAllyItem],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    getItem.mockResolvedValue(raiseAllyItem);
    decideItem.mockImplementation(async (_id: string, body: { action: string; draft?: unknown }) => ({
      ...raiseAllyItem,
      decisionAction: body.action,
      version: 2,
    }));
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='decide-keep-current']").trigger("click");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-raise-ally",
      expect.objectContaining({
        action: "KEEP_CURRENT",
        expectedVersion: 1,
      }),
    );
    const call = decideItem.mock.calls.find((c) => c[1]?.action === "KEEP_CURRENT");
    expect(call?.[1]?.draft).toBeUndefined();
    wrapper.unmount();
  });

  it("shows editable review form immediately; Accept requires Category", async () => {
    listItems.mockResolvedValue({ items: [veItem], total: 1, page: 1, pageSize: 200 });
    getItem.mockResolvedValue(veItem);
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='draft-editor']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='category-required-hint']").exists()).toBe(true);
    expect((wrapper.get("[data-testid='draft-canonical-key']").element as HTMLInputElement).value).toContain(
      "priest.shadow.vampiric-embrace",
    );
    expect(validateDraft).toHaveBeenCalled();
    expect((wrapper.get("[data-testid='decide-accept']").element as HTMLButtonElement).disabled).toBe(true);

    decideItem.mockClear();
    await wrapper.get("[data-testid='decide-accept']").trigger("click");
    await flushPromises();
    expect(decideItem).not.toHaveBeenCalled();

    await wrapper.get("[data-testid='draft-category']").setValue("DEFENSIVE_MINOR");
    await wrapper.get("[data-testid='draft-availability']").setValue("BASELINE");
    await flushPromises();
    expect((wrapper.get("[data-testid='decide-accept']").element as HTMLButtonElement).disabled).toBe(false);

    decideItem.mockImplementation(async (_id: string, body: { action: string }) => {
      const next = {
        ...veItem,
        decisionAction: body.action,
        version: 2,
        draftRule: {
          version: 1,
          status: "READY_FOR_PUBLISH_REVIEW",
          category: "DEFENSIVE_MINOR",
        },
        draftStatus: "READY_FOR_PUBLISH_REVIEW",
      };
      getItem.mockResolvedValue(next);
      listItems.mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 200 });
      return next;
    });
    decideItem.mockClear();
    await wrapper.get("[data-testid='decide-accept']").trigger("click");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-ve",
      expect.objectContaining({ action: "ACCEPT" }),
    );
    wrapper.unmount();
  });

  it("blocks Accept when canonicalKey is cleared", async () => {
    listItems.mockResolvedValue({ items: [veItem], total: 1, page: 1, pageSize: 200 });
    getItem.mockResolvedValue(veItem);
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='draft-canonical-key']").setValue("");
    await wrapper.get("[data-testid='draft-category']").setValue("DEFENSIVE_MINOR");
    await wrapper.get("[data-testid='draft-availability']").setValue("BASELINE");
    await flushPromises();
    expect((wrapper.get("[data-testid='decide-accept']").element as HTMLButtonElement).disabled).toBe(true);
    decideItem.mockClear();
    await wrapper.get("[data-testid='decide-accept']").trigger("click");
    await flushPromises();
    expect(decideItem).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("Save persists incomplete work without accepting", async () => {
    listItems.mockResolvedValue({ items: [veItem], total: 1, page: 1, pageSize: 200 });
    getItem.mockResolvedValue(veItem);
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='save-review']").trigger("click");
    await flushPromises();
    expect(ensureDraft).toHaveBeenCalled();
    expect(decideItem).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("Change decision supports ACCEPTED → REJECTED and preserves audit via decide API", async () => {
    const acceptedItem = {
      ...veItem,
      decisionAction: "ACCEPT",
      version: 2,
      draftRule: {
        version: 2,
        status: "READY_FOR_PUBLISH_REVIEW",
        name: "Vampiric Embrace",
        spellIds: [15286],
        bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
        category: "DEFENSIVE_MINOR",
      },
      draftStatus: "READY_FOR_PUBLISH_REVIEW",
      decisionEvents: [
        {
          id: "ev-accept",
          actorUserId: null,
          actorType: "admin_key",
          previousState: { decisionAction: null },
          newState: { decisionAction: "ACCEPT" },
          note: null,
          createdAt: "2026-08-16T20:00:00.000Z",
        },
      ],
    };
    listItems.mockResolvedValue({ items: [acceptedItem], total: 1, page: 1, pageSize: 200 });
    getItem.mockResolvedValue(acceptedItem);
    decideItem.mockImplementation(async (_id: string, body: { action: string }) => {
      const next = {
        ...acceptedItem,
        decisionAction: body.action,
        version: 3,
        decisionEvents: [
          ...acceptedItem.decisionEvents,
          {
            id: "ev-reject",
            actorUserId: null,
            actorType: "admin_key",
            previousState: { decisionAction: "ACCEPT" },
            newState: { decisionAction: body.action },
            note: null,
            createdAt: "2026-08-16T21:00:00.000Z",
          },
        ],
      };
      getItem.mockResolvedValue(next);
      listItems.mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 200 });
      return next;
    });
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='change-decision']").exists()).toBe(true);
    await wrapper.get("[data-testid='change-decision']").trigger("click");
    await flushPromises();
    await wrapper.get("button.btn.danger").trigger("click");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-ve",
      expect.objectContaining({ action: "REJECT" }),
    );
  });

  it("supports Haranir topology accept and queue next pending", async () => {
    const wrapper = await mountPage();
    const cards = wrapper.findAll("[data-testid='review-item-list'] .item-card__select");
    await cards[1]!.trigger("click");
    await flushPromises();
    expect(getItem).toHaveBeenCalledWith("item-haranir");
    await wrapper.get("[data-testid='decide-topology-accept']").trigger("click");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-haranir",
      expect.objectContaining({ action: "ACCEPT" }),
    );
  });

  it("surfaces 409 concurrency conflicts explicitly on save", async () => {
    ensureDraft.mockRejectedValueOnce(
      new ApiClientError("stale", 409, "REVIEW_ITEM_VERSION_CONFLICT"),
    );
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='save-review']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Conflict (409)");
  });

  it("keeps all filters collapsed by default", async () => {
    const wrapper = await mountPage();
    const panel = wrapper.get("[data-testid='review-filters']");
    expect(panel.element.tagName).toBe("DETAILS");
    expect(panel.attributes("open")).toBeUndefined();
    expect(panel.text()).toContain("Search");
    expect(panel.text()).toContain("Spell ID");
    expect(panel.text()).toContain("Draft status");
  });

  it("does not hide distinct batches that share SimC/reportDigest", async () => {
    const peer = {
      ...batch,
      id: "113adb13-1ceb-42f5-b429-0ac9e9ef0063",
      reviewPlanDigest: "dcd66ef339ae9e5fea16b83239e6b7606faa6e15077e20c3a4239d5d9f1f3f2c",
      decisionCounts: { ...batch.decisionCounts, total: 87, pending: 87 },
      createdAt: "2026-08-27T12:00:00.000Z",
    };
    const older = {
      ...batch,
      id: "de3a1dd4-e931-443e-b3f3-9988f0245ac3",
      reportDigest: batch.reportDigest,
      simcRevision: batch.simcRevision,
      wowBuild: batch.wowBuild,
      reviewPlanDigest: "28b6c9176c1f46b623aea9e0dee6cc218a98851b584db47c172269b50908795c",
      decisionCounts: {
        total: 1,
        pending: 0,
        decided: 1,
        accepted: 0,
        rejected: 0,
        deferred: 1,
        draftsNeedsMetadata: 0,
        draftsReadyForPublishReview: 0,
      },
      createdAt: "2026-08-26T12:00:00.000Z",
    };
    listBatches.mockResolvedValue({ batches: [peer, older] });
    listItems.mockResolvedValue({ items: [veItem], total: 1, page: 1, pageSize: 200 });
    const wrapper = await mountPage();
    const options = wrapper.findAll("[data-testid='review-batch-selector'] option");
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.attributes("value"))).toEqual([peer.id, older.id]);
    expect(options[0]!.text()).toContain("plan dcd66ef3");
    expect(options[1]!.text()).toContain("plan 28b6c917");
  });

  it("runs CapsLock shortcuts for accept, reject, and defer", async () => {
    listItems.mockResolvedValue({ items: [veItem], total: 1, page: 1, pageSize: 200 });
    getItem.mockResolvedValue(veItem);
    decideItem.mockImplementation(async (_id: string, body: { action: string }) => {
      const next = { ...veItem, decisionAction: body.action, version: 2 };
      getItem.mockResolvedValue(next);
      listItems.mockResolvedValue({ items: [next], total: 1, page: 1, pageSize: 200 });
      return next;
    });
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='draft-category']").setValue("DEFENSIVE_MINOR");
    await wrapper.get("[data-testid='draft-availability']").setValue("BASELINE");
    await flushPromises();
    ensureDraft.mockClear();
    decideItem.mockClear();

    const dispatchCaps = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, "getModifierState", {
        value: (mod: string) => mod === "CapsLock",
      });
      window.dispatchEvent(event);
    };

    dispatchCaps("Enter");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-ve",
      expect.objectContaining({ action: "ACCEPT" }),
    );

    decideItem.mockClear();
    dispatchCaps("Backspace");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-ve",
      expect.objectContaining({ action: "REJECT" }),
    );

    decideItem.mockClear();
    dispatchCaps(" ");
    await flushPromises();
    expect(decideItem).toHaveBeenCalledWith(
      "item-ve",
      expect.objectContaining({ action: "DEFER" }),
    );
    wrapper.unmount();
  });
});

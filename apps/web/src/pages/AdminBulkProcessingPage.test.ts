import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminBulkProcessingPage from "./AdminBulkProcessingPage.vue";
import { routeDefs } from "../routes";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const sampleHit = {
  characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Aleria",
  realmSlug: "tarren-mill",
  realmName: "Tarren Mill",
  region: "EU",
  classSlug: "mage",
  avatarUrl: null,
  classIconUrl: "https://example.test/mage.jpg",
  mythicPlusScore: 3000,
};

const sampleOp = {
  id: "op-1",
  mode: "RECALCULATE_ONLY",
  status: "RUNNING",
  selectionMode: "COHORT",
  logicalKey: "bulk:x",
  minMythicPlusScore: null,
  dryRun: false,
  completionSemantics: "CHILD_DISPATCH_FINISHED",
  childOutcomesTracked: false,
  progress: {
    selectedCount: 2,
    skippedCount: 0,
    dispatchedCount: 1,
    enqueuedCount: 1,
    dispatchFailedCount: 0,
    estimatedWclCalls: null,
    consumedWclCalls: null,
    cursor: 1,
  },
  createdAt: "2026-07-30T12:00:00.000Z",
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/bulk-processing");
  await router.isReady();
  const wrapper = mount(AdminBulkProcessingPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("AdminBulkProcessingPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/admin/bulk-operations") && method === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse(
          {
            ...sampleOp,
            id: "op-created",
            dryRun: payload.dryRun === true,
            selectionMode: Array.isArray(payload.characterIds) && (payload.characterIds as string[]).length > 0
              ? "EXPLICIT"
              : "COHORT",
            progress: { ...sampleOp.progress, selectedCount: payload.characterIds ? (payload.characterIds as string[]).length : 2 },
          },
          201,
        );
      }
      if (url.includes("/admin/bulk-operations/op-1")) {
        return jsonResponse({
          ...sampleOp,
          items: [
            {
              id: "item-1",
              characterId: sampleHit.characterId,
              position: 0,
              status: "ENQUEUED",
              region: "EU",
              realmSlug: "tarren-mill",
              characterName: "Aleria",
              mythicPlusScore: 3000,
              skipReason: null,
              errorMessage: null,
              childJobType: "recalculate-score",
            },
            {
              id: "item-2",
              characterId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              position: 1,
              status: "SKIPPED_DRY_RUN",
              region: "EU",
              realmSlug: "twisting-nether",
              characterName: "Beta",
              mythicPlusScore: 2800,
              skipReason: "DRY_RUN",
              errorMessage: null,
              childJobType: null,
            },
          ],
          itemsTotal: 2,
          itemsLimit: 200,
          itemsTruncated: false,
        });
      }
      if (url.includes("/admin/bulk-operations")) {
        return jsonResponse({ operations: [sampleOp] });
      }
      if (url.includes("/admin/score-models")) {
        return jsonResponse({
          models: [
            {
              id: "model-1",
              key: "trust-v6",
              version: 3,
              name: "Active",
              status: "ACTIVE",
              config: {},
              createdAt: "2026-07-01T00:00:00.000Z",
              activatedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/admin/characters/search")) {
        return jsonResponse({ suggestions: [sampleHit] });
      }
      return jsonResponse({ error: { message: "not mocked", code: "NOT_MOCKED" } }, 500);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it("does not crash when max characters is 1 and submits a number", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-max-characters']").setValue(1);
    await wrapper.get("[data-testid='bulk-create']").trigger("submit");
    await flushPromises();

    const post = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/bulk-operations") && (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeTruthy();
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.maxCharacters).toBe(1);
    expect(body.minMythicPlusScore).toBeNull();
  });

  it("submits null for empty optional numeric inputs", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-create']").trigger("submit");
    await flushPromises();
    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.minMythicPlusScore).toBeNull();
    expect(body.maxCharacters).toBeNull();
  });

  it("blocks submission for invalid numeric input", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-min-score']").setValue("not-a-number");
    await wrapper.get("[data-testid='bulk-create-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toMatch(/finite number|validation/i);
    const posts = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(0);
  });

  it("loads score models and submits selected model id", async () => {
    const { wrapper } = await mountPage();
    const select = wrapper.get("[data-testid='bulk-score-model']");
    expect(select.html()).toContain("trust-v6");
    await select.setValue("model-1");
    await wrapper.get("[data-testid='bulk-create-form']").trigger("submit");
    await flushPromises();
    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.scoreModelId).toBe("model-1");
  });

  it("switches selection mode and hides incompatible controls", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='bulk-cohort-controls']").exists()).toBe(true);
    await wrapper.get("[data-testid='bulk-selection-explicit']").trigger("click");
    expect(wrapper.find("[data-testid='bulk-cohort-controls']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='bulk-explicit-controls']").exists()).toBe(true);
  });

  it("requires at least one character in explicit mode", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-selection-explicit']").trigger("click");
    await wrapper.get("[data-testid='bulk-create-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toMatch(/at least one character/i);
  });

  it("debounces character search and adds selected results", async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-selection-explicit']").trigger("click");
    await wrapper.get("[data-testid='admin-picker-search']").setValue("ale");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/characters/search"))).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/characters/search"))).toBe(true);
    expect(wrapper.find("[data-testid='admin-picker-suggestions']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Aleria");
    await wrapper.get("[data-testid='admin-picker-suggestions'] li").trigger("mousedown");
    await flushPromises();
    expect(wrapper.get("[data-testid='admin-picker-count']").text()).toContain("1 selected");
    await wrapper.get("[data-testid='bulk-create-form']").trigger("submit");
    await flushPromises();
    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body.characterIds).toEqual([sampleHit.characterId]);
    expect(body.minMythicPlusScore).toBeNull();
    expect(body.maxCharacters).toBeNull();
  });

  it("prevents duplicate selection and supports clear all", async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-selection-explicit']").trigger("click");
    await wrapper.get("[data-testid='admin-picker-search']").setValue("ale");
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    await wrapper.get("[data-testid='admin-picker-suggestions'] li").trigger("mousedown");
    await wrapper.get("[data-testid='admin-picker-search']").setValue("ale");
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    await wrapper.get("[data-testid='admin-picker-suggestions'] li").trigger("mousedown");
    expect(wrapper.get("[data-testid='admin-picker-count']").text()).toContain("1 selected");
    await wrapper.get("[data-testid='admin-picker-clear']").trigger("click");
    expect(wrapper.get("[data-testid='admin-picker-count']").text()).toContain("0 selected");
  });

  it("places Remove as a far-right destructive action and keeps dry-run tooltip", async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-selection-explicit']").trigger("click");
    await wrapper.get("[data-testid='admin-picker-search']").setValue("ale");
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    await wrapper.get("[data-testid='admin-picker-suggestions'] li").trigger("mousedown");
    await flushPromises();
    const row = wrapper.get(".admin-picker__row");
    expect(row.find("[data-testid='character-identity']").exists()).toBe(true);
    const remove = row.get("[data-testid='admin-picker-remove']");
    expect(remove.classes()).toContain("admin-picker__remove");
    const children = Array.from(row.element.children) as HTMLElement[];
    expect(children[children.length - 1]).toBe(remove.element);

    expect(wrapper.find("[data-testid='help-tooltip']").exists()).toBe(true);
    await wrapper.get("[data-testid='help-tooltip'] button").trigger("focus");
    expect(wrapper.get("[data-testid='help-tooltip']").text()).toMatch(/does not enqueue child/i);
    expect(wrapper.get("[data-testid='help-tooltip']").text()).toMatch(/persists the bulk operation/i);

    const createBtn = wrapper.get("[data-testid='bulk-create']");
    expect(createBtn.classes()).toContain("btn");
  });

  it("keeps operation cards collapsed by default and loads detail on expand", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='bulk-operation-detail']").exists()).toBe(false);
    await wrapper.get("[data-testid='bulk-op-summary']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='bulk-operation-detail']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='bulk-completion-semantics']").text()).toContain(
      "CHILD_DISPATCH_FINISHED",
    );
    expect(wrapper.find("[data-testid='bulk-pause']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='bulk-resume']").exists()).toBe(false);
  });

  it("shows scroll-constrained character list when expanded", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-op-summary']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='bulk-items-toggle']").trigger("click");
    const list = wrapper.get("[data-testid='bulk-items-list']");
    expect(list.classes()).toContain("op-items__list");
    expect(wrapper.findAll("[data-testid='bulk-item-status']").length).toBe(2);
  });

  it("explicitly shows truncation when the detail list is incomplete", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/admin/bulk-operations/op-1")) {
        return jsonResponse({
          ...sampleOp,
          items: [
            {
              id: "item-1",
              characterId: sampleHit.characterId,
              position: 0,
              status: "ENQUEUED",
              region: "EU",
              realmSlug: "tarren-mill",
              characterName: "Aleria",
              mythicPlusScore: 3000,
              skipReason: null,
              errorMessage: null,
              childJobType: "recalculate-score",
            },
          ],
          itemsTotal: 250,
          itemsLimit: 200,
          itemsTruncated: true,
        });
      }
      if (url.includes("/admin/bulk-operations") && method === "GET") {
        return jsonResponse({ operations: [sampleOp] });
      }
      if (url.includes("/admin/score-models")) {
        return jsonResponse({ models: [] });
      }
      return jsonResponse({ error: { message: "not mocked", code: "NOT_MOCKED" } }, 500);
    });

    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='bulk-op-summary']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='bulk-items-toggle']").trigger("click");
    const truncation = wrapper.get("[data-testid='bulk-items-truncated']");
    expect(truncation.text()).toMatch(/Showing 1 of 250/i);
    expect(truncation.text()).not.toMatch(/complete/i);
  });

  it("hides WCL budget unless full refresh mode", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='bulk-wcl-field']").exists()).toBe(false);
    await wrapper.get("[data-testid='bulk-mode-full']").trigger("click");
    expect(wrapper.find("[data-testid='bulk-wcl-field']").exists()).toBe(true);
  });
});

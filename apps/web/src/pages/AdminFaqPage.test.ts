import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { routeDefs } from "../routes";
import type { AdminFaqEntryDTO } from "@mplus/contracts";

const listAdminFaq = vi.fn();
const createFaq = vi.fn();
const updateFaq = vi.fn();
const moveFaq = vi.fn();
const deleteFaq = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listAdminFaq: (...args: unknown[]) => listAdminFaq(...args),
    createFaq: (...args: unknown[]) => createFaq(...args),
    updateFaq: (...args: unknown[]) => updateFaq(...args),
    moveFaq: (...args: unknown[]) => moveFaq(...args),
    deleteFaq: (...args: unknown[]) => deleteFaq(...args),
    getPublishedScoringContext: async () => ({
      available: false,
      unavailableReason: "Current Meta context is temporarily unavailable.",
      scoringSeason: null,
      revision: null,
      meta: null,
      key: null,
    }),
    listPublicScoreModels: async () => [],
  },
}));

import AdminFaqPage from "./AdminFaqPage.vue";

const now = "2026-08-15T00:00:00.000Z";

function entry(partial: Partial<AdminFaqEntryDTO> & Pick<AdminFaqEntryDTO, "id" | "title">): AdminFaqEntryDTO {
  return {
    description: "Body",
    position: 1,
    isPublished: false,
    embedType: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/admin/faq");
  await router.isReady();
  const wrapper = mount(AdminFaqPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("AdminFaqPage", () => {
  beforeEach(() => {
    listAdminFaq.mockReset();
    createFaq.mockReset();
    updateFaq.mockReset();
    moveFaq.mockReset();
    deleteFaq.mockReset();
    listAdminFaq.mockResolvedValue({ entries: [] });
  });

  it("shows an empty state with an add action", async () => {
    const wrapper = await mountPage();
    expect(wrapper.get("[data-testid='admin-faq-empty']").text()).toContain("No FAQ entries yet");
    expect(wrapper.get("[data-testid='admin-faq-add']").text()).toContain("Add FAQ entry");
  });

  it("creates, edits, publishes, orders and deletes entries", async () => {
    const created = entry({ id: "a", title: "First", position: 1 });
    const second = entry({ id: "b", title: "Second", position: 2, embedType: "SCORE_FLOW" });
    listAdminFaq.mockResolvedValueOnce({ entries: [] }).mockResolvedValue({ entries: [created, second] });
    createFaq.mockResolvedValue(created);
    updateFaq.mockImplementation(async (_id: string, patch: Partial<AdminFaqEntryDTO>) => ({
      ...created,
      ...patch,
      title: patch.title ?? created.title,
      isPublished: patch.isPublished ?? created.isPublished,
    }));
    moveFaq.mockResolvedValue(created);
    deleteFaq.mockResolvedValue({ id: "a" });

    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='admin-faq-editor-modal']").exists()).toBe(false);
    await wrapper.get("[data-testid='admin-faq-add']").trigger("click");
    expect(wrapper.find("[data-testid='admin-faq-editor-modal']").exists()).toBe(true);
    await wrapper.get("[data-testid='admin-faq-title']").setValue("First");
    await wrapper.get("[data-testid='admin-faq-description']").setValue("Body");
    expect(wrapper.get("[data-testid='admin-faq-embed-type']").element).toBeTruthy();
    const options = wrapper.findAll("[data-testid='admin-faq-embed-type'] option");
    expect(options).toHaveLength(6);
    await wrapper.get("[data-testid='admin-faq-form']").trigger("submit");
    await flushPromises();
    expect(createFaq).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='admin-faq-editor-modal']").exists()).toBe(false);

    expect(wrapper.findAll("[data-testid='admin-faq-row']")).toHaveLength(2);
    expect(wrapper.get("[data-testid='admin-faq-row']").text()).toContain("Body");
    expect(wrapper.get(".state-chip").classes()).toContain("state-chip--draft");
    expect(wrapper.find("[data-testid='admin-faq-embed-label']").text()).toBe("Trust Score calculation");
    await wrapper.get("[data-testid='admin-faq-edit']").trigger("click");
    await wrapper.get("[data-testid='admin-faq-embed-type']").setValue("SCORE_FLOW");
    await flushPromises();
    expect(wrapper.find("[data-testid='admin-faq-artifact-preview']").exists()).toBe(true);
    await wrapper.get("[data-testid='admin-faq-title']").setValue("First updated");
    await wrapper.get("[data-testid='admin-faq-form']").trigger("submit");
    await flushPromises();
    expect(updateFaq).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ title: "First updated", embedType: "SCORE_FLOW" }),
    );

    await wrapper.get("[data-testid='admin-faq-publish-toggle']").trigger("click");
    await flushPromises();
    expect(updateFaq).toHaveBeenCalledWith("a", { isPublished: true });

    await wrapper.get("[data-testid='admin-faq-move-down']").trigger("click");
    await flushPromises();
    expect(moveFaq).toHaveBeenCalledWith("a", { direction: "down" });

    await wrapper.get("[data-testid='admin-faq-delete']").trigger("click");
    await wrapper.get("[data-testid='confirm-delete']").trigger("click");
    await flushPromises();
    expect(deleteFaq).toHaveBeenCalledWith("a");
  });
});

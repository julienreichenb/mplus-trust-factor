import { describe, expect, it } from "vitest";
import {
  createFaqEntryRequestSchema,
  updateFaqEntryRequestSchema,
} from "./faq.js";

describe("FAQ contracts", () => {
  it("rejects empty trimmed title and description", () => {
    const created = createFaqEntryRequestSchema.safeParse({
      title: "   ",
      description: "  ",
    });
    expect(created.success).toBe(false);

    const updatedTitle = updateFaqEntryRequestSchema.safeParse({ title: "\n" });
    expect(updatedTitle.success).toBe(false);
  });

  it("trims title and description on create", () => {
    const parsed = createFaqEntryRequestSchema.parse({
      title: "  How scoring works  ",
      description: "  Trust Score uses four dimensions.  ",
      isPublished: false,
    });
    expect(parsed.title).toBe("How scoring works");
    expect(parsed.description).toBe("Trust Score uses four dimensions.");
    expect(parsed.isPublished).toBe(false);
  });

  it("accepts known embed types and null, rejects unknown values", () => {
    expect(
      createFaqEntryRequestSchema.parse({
        title: "Title",
        description: "Body",
        embedType: "META_TIER_TABLE",
      }).embedType,
    ).toBe("META_TIER_TABLE");
    expect(
      createFaqEntryRequestSchema.parse({
        title: "Title",
        description: "Body",
        embedType: null,
      }).embedType,
    ).toBeNull();
    expect(
      createFaqEntryRequestSchema.safeParse({
        title: "Title",
        description: "Body",
        embedType: "HTML_WIDGET",
      }).success,
    ).toBe(false);
    expect(updateFaqEntryRequestSchema.parse({ embedType: "TRUST_GRADE_LADDER" }).embedType).toBe(
      "TRUST_GRADE_LADDER",
    );
  });

  it("rejects non-integer position", () => {
    const parsed = createFaqEntryRequestSchema.safeParse({
      title: "Title",
      description: "Body",
      position: 1.5,
    });
    expect(parsed.success).toBe(false);
  });
});

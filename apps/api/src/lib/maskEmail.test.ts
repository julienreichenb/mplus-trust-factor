import { describe, expect, it } from "vitest";
import { maskEmail } from "./maskEmail.js";

describe("maskEmail (api)", () => {
  it("matches Account masking contract", () => {
    expect(maskEmail("test45@gmail.com")).toBe("te******45@gmail.com");
  });
});

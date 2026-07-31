import { describe, expect, it } from "vitest";
import { maskEmail } from "./maskEmail";

describe("maskEmail", () => {
  it("masks middle of local part with exactly six asterisks", () => {
    expect(maskEmail("test45@gmail.com")).toBe("te******45@gmail.com");
    expect(maskEmail("ab@x.com")).toBe("******@x.com");
    expect(maskEmail("abcde@x.com")).toBe("ab******de@x.com");
    expect(maskEmail("abcdef@x.com")).toBe("ab******ef@x.com");
  });

  it("handles null, empty and malformed safely", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
    expect(maskEmail("not-an-email")).toBe("******");
    expect(maskEmail("@nodomain")).toBe("******");
  });

  it("never returns the original full email", () => {
    const full = "sensitive.user@blizzard.com";
    const masked = maskEmail(full);
    expect(masked).not.toBe(full);
    expect(masked).not.toContain("sensitive.user");
  });
});

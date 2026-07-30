import { describe, expect, it } from "vitest";
import {
  isTechnicalPublicErrorMessage,
  toPublicJobErrorMessage,
  toPublicRefreshErrorMessage,
  PUBLIC_REFRESH_FAILED_MESSAGE,
  PUBLIC_GENERIC_UNAVAILABLE_MESSAGE,
} from "./public-error-sanitize.js";

describe("public error sanitization", () => {
  it("detects contract hash mismatch and raw hashes", () => {
    expect(
      isTechnicalPublicErrorMessage(
        "REFRESH_CONTRACT_HASH_MISMATCH: requested=2e8ff99743bee2aa68d8ab3fb80bf3cf136da5144ba521efeb24a8c01cccd997 computed=bff6e03d2fc5b4bd1f114ca49c872df25eaac33e8cc16c17952e894b9197adbd",
      ),
    ).toBe(true);
  });

  it("sanitizes account published-score failure to generic French warning", () => {
    const safe = toPublicRefreshErrorMessage(
      {
        code: "REFRESH_CONTRACT_HASH_MISMATCH",
        message:
          "REFRESH_CONTRACT_HASH_MISMATCH: requested=abc computed=def",
      },
      { hasPublishedScore: true },
    );
    expect(safe.errorCode).toBe("REFRESH_FAILED");
    expect(safe.errorMessage).toBe(PUBLIC_REFRESH_FAILED_MESSAGE);
    expect(JSON.stringify(safe)).not.toContain("REFRESH_CONTRACT_HASH_MISMATCH");
    expect(JSON.stringify(safe)).not.toMatch(/[a-f0-9]{64}/);
  });

  it("sanitizes no-score failure to generic unavailable copy", () => {
    const safe = toPublicRefreshErrorMessage(
      { message: "PrismaClientKnownRequestError: ..." },
      { hasPublishedScore: false },
    );
    expect(safe.errorMessage).toBe(PUBLIC_GENERIC_UNAVAILABLE_MESSAGE);
  });

  it("sanitizes job DTO error messages", () => {
    expect(
      toPublicJobErrorMessage(
        "REFRESH_CONTRACT_HASH_MISMATCH: requested=aaa computed=bbb",
      ),
    ).toBe(PUBLIC_REFRESH_FAILED_MESSAGE);
  });
});

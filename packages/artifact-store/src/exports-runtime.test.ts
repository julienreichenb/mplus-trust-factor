import { describe, expect, it } from "vitest";
import {
  prepareArtifactWrite,
  preparedWriteResult,
} from "@mplus/artifact-store";

describe("@mplus/artifact-store exports", () => {
  it("exports prepareArtifactWrite and preparedWriteResult for runtime", async () => {
    const prepared = await prepareArtifactWrite({
      bytes: Buffer.from("hello"),
      compression: "NONE",
    });

    const result = preparedWriteResult(
      prepared,
      `cas://sha256/${prepared.contentHash}.bin`,
      false,
    );

    expect(typeof prepareArtifactWrite).toBe("function");
    expect(typeof preparedWriteResult).toBe("function");
    expect(result.contentHash).toBe(prepared.contentHash);
  });
});

